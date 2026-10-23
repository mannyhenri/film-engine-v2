/**
 * ASTRA: the Codex model that guides Blender builds (lib/astra-build.js).
 *
 * "With Astra 6 or higher, for guiding Blender in 3D modeling": the newest `gpt-<N>[.<M>]-astra` with N >= 6
 * that the user's Codex lists in ~/.codex/models_cache.json (GPT-6-Astra on 2026-10-23). It runs through the
 * user's own Codex CLI and ChatGPT sign-in, so it spends their plan, not an API key.
 *
 * Codex here only TALKS: it is given the reference pictures and review renders as images and answers with a
 * Blender script in a fenced block. Every tool is off (no shell, no apps, no browser, no web search), the
 * sandbox is read-only and nothing is persisted; Film Engine checks the script and runs it itself.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { binary, cliEnv } = require('./ai-cli-runner');

const DISABLED = ['shell_tool', 'unified_exec', 'apps', 'hooks', 'plugins', 'remote_plugin', 'browser_use',
    'browser_use_external', 'computer_use', 'in_app_browser', 'multi_agent', 'multi_agent_v2', 'code_mode_host',
    'image_generation', 'view_image'];
const MIN_MAJOR = 6;

function codexHome() { return process.env.CODEX_HOME || path.join(os.homedir(), '.codex'); }

/** The codex binary: CODEX_PATH, else where the app's AI connections find it, else the Codex app's own copy. */
function resolveCodex() {
    const tried = [process.env.CODEX_PATH, binary('codex'), '/Applications/Codex.app/Contents/Resources/codex',
        path.join(codexHome(), 'bin', 'codex')].filter(Boolean);
    const bin = tried.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile(); } catch (_) { return false; } });
    return bin ? { available: true, bin } : { available: false, reason: 'Codex is not installed (or not found). Install the Codex CLI and sign in with ChatGPT.' };
}

/** "gpt-6-astra" -> [6, 0]; "gpt-6.1-astra" -> [6, 1]; anything else -> null. */
function astraVersion(slug) {
    const m = /^gpt-(\d+)(?:\.(\d+))?-astra$/i.exec(String(slug || ''));
    return m ? [Number(m[1]), Number(m[2] || 0)] : null;
}

/** The newest Astra 6 or later in a model list, or null. */
function pickAstra(slugs) {
    return (slugs || []).map(s => ({ s, v: astraVersion(s) }))
        .filter(x => x.v && x.v[0] >= MIN_MAJOR)
        .sort((a, b) => b.v[0] - a.v[0] || b.v[1] - a.v[1])[0]?.s || null;
}

/** The model to use, from the user's Codex model list. Throws with a clear message when there is none. */
function astraModel(cacheFile) {
    const file = cacheFile || process.env.FILM_ASTRA_MODELS_CACHE || path.join(codexHome(), 'models_cache.json');
    let models = [];
    try {
        const d = JSON.parse(fs.readFileSync(file, 'utf8'));
        models = (Array.isArray(d) ? d : d.models || []).map(m => (typeof m === 'string' ? m : m.slug || m.id)).filter(Boolean);
    } catch (_) { models = []; }
    const pick = pickAstra(models);
    if (!pick) {
        const e = new Error(`No Astra 6 or newer model in Codex (it lists ${models.length ? models.join(', ') : 'no models'}). Open Codex once to refresh its model list, or update Codex.`);
        e.status = 503; e.code = 'NO_ASTRA';
        throw e;
    }
    return pick;
}

/** The argv for one isolated, tool-less `codex exec` turn with images. The prompt goes on stdin. */
function execArgs(model, images, lastMessagePath) {
    return ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--color', 'never', '-m', model, '-o', lastMessagePath,
        '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', '-c', 'features.skip_host_skill_discovery=true',
        ...DISABLED.flatMap(f => ['--disable', f]),
        ...(images || []).flatMap(p => ['-i', p]), '-'];
}

/**
 * Ask Astra once. Resolves { text, model }. `signal` (an AbortSignal) kills it; timeoutMs bounds it.
 * The working directory is an empty temp folder, so even a read-only sandbox has nothing of ours to read.
 */
function ask({ prompt, images, timeoutMs = 600000, signal, onSpawn } = {}) {
    const codex = resolveCodex();
    if (!codex.available) return Promise.reject(Object.assign(new Error(codex.reason), { status: 503, code: 'NO_CODEX' }));
    let model;
    try { model = astraModel(); } catch (e) { return Promise.reject(e); }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-astra-'));
    const last = path.join(dir, 'last.txt');
    return new Promise((resolve, reject) => {
        const child = spawn(codex.bin, execArgs(model, images, last), { cwd: dir, env: cliEnv(codex.bin), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        if (onSpawn) onSpawn(child);
        let err = '', settled = false;
        const kill = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch (_) { try { child.kill('SIGTERM'); } catch (_) { /* gone */ } } };
        const timer = setTimeout(() => { kill(); finish(new Error(`Astra did not answer within ${Math.round(timeoutMs / 1000)} s`)); }, timeoutMs);
        const onAbort = () => { kill(); finish(Object.assign(new Error('cancelled'), { code: 'CANCELLED' })); };
        if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
        function finish(error, text) {
            if (settled) return; settled = true;
            clearTimeout(timer);
            if (signal) signal.removeEventListener('abort', onAbort);
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* temp */ }
            error ? reject(error) : resolve({ text, model });
        }
        child.stdout.on('data', () => {});
        child.stderr.on('data', b => { err = (err + b).slice(-4000); });
        child.on('error', e => finish(e));
        child.on('close', code => {
            let text = '';
            try { text = fs.readFileSync(last, 'utf8'); } catch (_) { text = ''; }
            if (code === 0 && text.trim()) return finish(null, text);
            const why = err.split('\n').map(l => l.trim()).filter(l => /error|denied|not|limit|unauthor/i.test(l)).slice(-3).join(' ').slice(0, 600);
            finish(new Error(`Astra (Codex) failed${code !== null ? ` (exit ${code})` : ''}${why ? ': ' + why : ''}`));
        });
        child.stdin.end(prompt);
    });
}

/** The Blender script in an answer: the last ```python block, else the only fenced block. */
function extractScript(text) {
    const blocks = [...String(text || '').matchAll(/```(?:python|py)?[ \t]*\n([\s\S]*?)```/g)].map(m => m[1]);
    const py = blocks.filter(b => /\bimport\s+bpy\b|\bbpy\./.test(b));
    return (py.length ? py[py.length - 1] : blocks[blocks.length - 1] || '').trim() || null;
}

module.exports = { resolveCodex, astraVersion, pickAstra, astraModel, execArgs, ask, extractScript, MIN_MAJOR };
