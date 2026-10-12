/** Film-owned CLI transports. Account credentials stay with each installed CLI.
 * Workers wait for approved input; no daemon, foreign session, hook, MCP or job is borrowed.
 * Film's durable conversation is authoritative. Fresh provider sessions keep the exact
 * reviewed context bounded even when the user removes an attachment or changes providers.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const {spawn} = require('child_process');
const {StringDecoder} = require('string_decoder');
const {createCLIRunner, argumentsFor, parseEvent, binary, cliEnv} = require('./ai-cli-runner');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const cleanError = value => String(value || 'Provider connection failed')
    .replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/g, '[redacted]')
    .replace(/https?:\/\/\S+/g, '[provider URL]').slice(0, 1200);
function ownedEnv(bin) {
    const env = cliEnv(bin);
    // Never silently select metered API credentials inherited from a launcher.
    for (const key of Object.keys(env)) if (/^(FILM_AI_CAPABILITY$|ANTHROPIC_|OPENAI_API_KEY$|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|CLAUDE_CODE_RESUME_INTERRUPTED_TURN$)/.test(key)) delete env[key];
    return env;
}
function workerArguments(id, session) {
    return id === 'claude'
        ? [...argumentsFor(id, session), '--input-format', 'stream-json']
        : ['--no-daemon', ...argumentsFor(id, session)];
}
function signInURL(value) {
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        return ['auth.openai.com', 'chatgpt.com', 'claude.ai', 'console.anthropic.com'].includes(url.hostname) ? url.href : null;
    } catch { return null; }
}
function createAIConnections({spawnProcess = spawn, resolveBinary = binary,
    probe = null, readyDelay = 250, killDelay = 2000, readyTimeout = 12000,
    taskTimeout = 600000, leaseMs = 90000, reconnectDelays = [1000, 5000],
    temporaryRoot = os.tmpdir()} = {}) {
    const accountProbe = createCLIRunner({spawnProcess, resolveBinary, temporaryRoot});
    const inspect = probe || (() => accountProbe.providersAsync(true));
    const providers = new Map(['claude', 'codex'].map(id => [id, {
        id, label: id === 'claude' ? 'Claude Code' : 'OpenAI Codex',
        state: 'stopped', installed: false, connected: false, available: false,
        note: 'Film will prepare its own connection when opened.', inference_verified: false,
        worker: null, login: null, retry: null, attempts: 0, starting: null, auth_failed: false,
    }]));
    const owners = new Map();
    let probePromise;
    async function inspectAccount() {
        if (!probePromise) {probePromise = Promise.resolve().then(inspect);}
        try {return await probePromise;} finally {probePromise = null;}
    }
    let closing = null;
    const desired = () => owners.size > 0;
    function view(p) {
        return {id: p.id, label: p.label, state: p.state, installed: p.installed,
            connected: p.connected, available: p.available, note: p.note,
            inference_verified: p.inference_verified,
            session_policy: 'Fresh isolated provider session; resume from Film conversation history.',
            login: p.login ? {state: 'awaiting_browser', url: p.login.url || null, code: p.login.code || null} : null};
    }
    function set(p, state, note) {
        p.state = state; p.note = note;
        p.available = state === 'ready' && p.connected && !!p.worker;
    }
    function schedule(p) {
        if (!desired() || p.retry || p.login || p.starting || p.attempts >= reconnectDelays.length) return;
        const delay = reconnectDelays[p.attempts++];
        set(p, 'reconnecting', 'Film is reconnecting. Interrupted requests will not be sent again.');
        p.retry = setTimeout(() => {p.retry = null; prepare(p).catch(() => {});}, delay);
        p.retry.unref?.();
    }
    function makeWorker(p) {
        const bin = resolveBinary(p.id);
        const session = crypto.randomUUID();
        const dir = fs.mkdtempSync(path.join(temporaryRoot, 'film-owned-ai-'));
        const w = {session, dir, task: null, stopped: false, closed: false, failure: '', buffer: '', diagnostic: '', bytes: 0, decoder: new StringDecoder('utf8')};
        let resolveClosed, resolveReady, rejectReady;
        w.closedPromise = new Promise(resolve => {resolveClosed = resolve;});
        w.readyPromise = new Promise((resolve, reject) => {resolveReady = resolve; rejectReady = reject;});
        function ready() {
            if (w.closed || w.stopped) return;
            clearTimeout(w.readyTimer);
            resolveReady(w);
        }
        w.stop = (reason, cancelled = false) => {
            if (w.closed) return w.closedPromise;
            w.stopped = true; w.failure ||= reason;
            if (w.task && cancelled) w.task.cancelling = true;
            if (!w.killTimer) {
                w.child.kill('SIGTERM');
                w.killTimer = setTimeout(() => w.child.kill('SIGKILL'), killDelay);
                w.killTimer.unref?.();
            }
            return w.closedPromise;
        };
        function hookFailed(error) {
            const t = w.task;
            t.hookFailure ||= 'Task state could not be saved: ' + cleanError(error?.message || error);
            p.inference_verified = false;
            set(p, 'error', t.hookFailure + ' No request was resubmitted.');
            if (!w.closed) w.stop(t.hookFailure);
            return false;
        }
        w.hook = (name, ...args) => {
            const t = w.task;
            function invoke() {
                if (t.hookFailure) return false;
                try {
                    const result = t.hooks[name](...args);
                    return result && typeof result.then === 'function' ? Promise.resolve(result).then(() => true, hookFailed) : true;
                } catch (error) {return hookFailed(error);}
            }
            const result = t.hookTail ? t.hookTail.then(invoke) : invoke();
            if (result && typeof result.then === 'function') {
                t.hookTail = result;
                t.pendingHooks.push(result);
            }
            return result;
        };
        function close(code) {
            if (w.closed) return;
            w.closed = true;
            clearTimeout(w.readyTimer); clearTimeout(w.killTimer); clearTimeout(w.taskTimer); clearTimeout(w.livenessTimer); clearTimeout(w.resultTimer);
            rejectReady(Error(cleanError(w.failure || w.diagnostic || `Provider exited before readiness (${code})`)));
            try {fs.rmSync(dir, {recursive: true, force: true});} catch (error) {w.failure ||= cleanError(error.message);}
            if (p.worker === w) {p.worker = null; p.available = false;}
            const t = w.task;
            const authenticationFailed = /not logged in|please run \/login|authentication (?:failed|required)|unauthorized|invalid (?:oauth|access) token/i.test([t?.failure,w.failure,w.diagnostic].filter(Boolean).join(' '));
            if (authenticationFailed) {p.auth_failed = true; p.connected = false; p.inference_verified = false;}
            function settled(completed = false) {
                function done() {
                    try {
                        if (completed && !t.hookFailure) p.inference_verified = true;
                        if (!desired()) set(p, 'stopped', 'Film connection stopped. Saved conversations remain available.');
                        else if (t?.hookFailure) set(p, 'error', t.hookFailure + ' No request was resubmitted.');
                        else if (authenticationFailed) set(p, 'sign_in_required', 'The provider rejected its local authentication. Reconnect after checking the CLI account, or explicitly choose secure sign-in. No request was resubmitted.');
                        else if (!p.login) {
                            set(p, 'disconnected', t && !w.stopped && !t.failure && code === 0 ? 'Preparing the next isolated Film session…' : cleanError(w.failure || w.diagnostic || 'Provider connection ended.'));
                            // A successful task gets a fresh idle worker. Failures get bounded backoff.
                            if (completed && !w.failure && code === 0) {p.attempts = 0; queueMicrotask(() => prepare(p).catch(() => {}));}
                            else schedule(p);
                        }
                    } finally {resolveClosed();}
                }
                // Store bookkeeping must be released even when a persistence hook failed.
                // This independent callback performs no provider retry or inference replay.
                let result;
                try {result = t?.hooks.closed?.();} catch (error) {hookFailed(error);}
                if (result && typeof result.then === 'function') Promise.resolve(result).then(done, error => {hookFailed(error); done();});
                else done();
            }
            function finish() {
                let result, completed = false;
                try {
                    if (t && !t.finished) {
                        t.finished = true;
                        if (!t.hookFailure) {
                            if (t.cancelling) result = w.hook('cancelled');
                            else if (w.stopped) result = w.hook(t.hooks.interrupted ? 'interrupted' : 'error', cleanError(w.failure || 'Film connection closed. Preview again to continue.'));
                            else if (code !== 0 || t.failure) result = w.hook('error', cleanError(t.failure || w.diagnostic || `Provider exited (${code})`));
                            else if (!(t.final || t.text).trim()) result = w.hook('error', 'The provider returned no text result.');
                            else {completed = true; result = w.hook('complete', t.final || t.text, {session_id: t.session || session});}
                        }
                    }
                } finally {
                    if (result && typeof result.then === 'function') result.then(() => settled(completed), () => settled(false));
                    else settled(completed);
                }
            }
            if (t?.pendingHooks.length) Promise.all(t.pendingHooks).then(finish, finish); else finish();
        }
        function line(value) {
            if (w.closed || w.stopped || w.task?.finished || !value.trim()) return;
            let e;
            try {e = JSON.parse(value);} catch {w.stop('Unsupported provider event format.'); return;}
            if (p.id === 'claude' && e.type === 'system' && e.subtype === 'init' &&
                (e.session_id !== session || (e.tools || []).length || (e.mcp_servers || []).length)) {
                w.stop('Claude did not honor the isolated Film session contract.'); return;
            }
            if (!w.task) {
                if (e.type === 'film.worker.ready') {
                    w.livenessTimer = setTimeout(ready, readyDelay); w.livenessTimer.unref?.();
                    return;
                }
                if (p.id === 'claude' && e.type === 'system' && e.subtype === 'init') {
                    ready();
                } else if (['assistant', 'result', 'thread.started', 'turn.started', 'item.completed'].includes(e.type)) {
                    w.stop('Provider produced unsolicited task output before an approved request.');
                }
                return;
            }
            const t = w.task, out = parseEvent(p.id, e);
            if (out.session) {
                if (p.id === 'claude' && out.session !== session) {t.failure = 'Provider session identity changed.'; w.stop(t.failure); return;}
                t.session = out.session;
                if (w.hook('event', {kind: 'session', session_id: out.session}) === false) return;
            }
            if (out.progress && w.hook('event', {kind: 'progress', message: out.progress}) === false) return;
            if (out.text) t.text = out.text;
            if (out.final !== undefined) t.final = out.final;
            if (out.error) t.failure = out.error;
            if (p.id === 'claude' && e.type === 'result') {
                w.child.stdin.write(JSON.stringify({type: 'input', value: '', close: true}) + '\n');
                // A result is not proof that a process has exited. Reap it before completion.
                w.resultTimer = setTimeout(() => w.stop('Provider did not close after its result.'), killDelay);
                w.resultTimer.unref?.();
            }
        }
        try {
            w.child = spawnProcess(process.execPath, [path.join(__dirname, 'ai-cli-guardian.cjs'), JSON.stringify({bin, args: workerArguments(p.id, session)})], {cwd: dir, env: ownedEnv(bin), stdio: ['pipe', 'pipe', 'pipe'], shell: false});
        } catch (e) {fs.rmSync(dir, {recursive: true, force: true}); throw e;}
        w.child.stdout.on('data', chunk => {
            w.bytes += chunk.length;
            if (w.bytes > 2000000) {w.stop('Provider output exceeded the 2 MB limit.'); return;}
            w.buffer += w.decoder.write(chunk);
            const lines = w.buffer.split('\n'); w.buffer = lines.pop();
            for (const s of lines) line(s);
        });
        w.child.stderr.on('data', chunk => {w.diagnostic = cleanError((w.diagnostic + chunk.toString()).slice(-2000));});
        w.child.stdin.on('error', e => w.stop(e.message));
        w.child.on('error', e => {w.failure = e.message; close(1);});
        w.child.on('close', code => {w.buffer += w.decoder.end(); if (w.buffer.trim()) line(w.buffer); close(code);});
        w.readyTimer = setTimeout(() => w.stop('Provider did not become ready within 12 seconds.'), readyTimeout);
        w.readyTimer.unref?.();
        // Both minimal CLIs may defer session-init until the first prompt. The guardian
        // confirms an owned child is alive; account status verifies local sign-in.
        // Model/network success remains unverified until a reviewed request completes.
        return w;
    }
    async function prepare(p) {
        if (p.starting) return p.starting;
        if (!desired() || p.worker || p.login) return;
        if (p.auth_failed) {set(p, 'sign_in_required', 'The last request failed authentication. Check the local CLI account, then explicitly reconnect.'); return;}
        p.starting = (async () => {
            set(p, 'starting', 'Film is verifying the installed CLI account and preparing its own worker.');
            const found = (await inspectAccount()).find(x => x.id === p.id) || {};
            p.installed = !!found.installed; p.connected = !!found.connected;
            if (!desired()) return;
            if (!found.available) {
                set(p, p.installed ? (p.connected ? 'error' : 'sign_in_required') : 'not_installed', p.installed
                    ? (p.connected ? 'Installed CLI does not support the required isolated options.' : 'Sign in securely from AI connections to use this provider.')
                    : 'Install this provider CLI separately, then reconnect. Film does not install software.');
                return;
            }
            const w = makeWorker(p); p.worker = w;
            try {
                await w.readyPromise;
                if (p.worker === w && desired() && !w.stopped && !w.closed) {
                    p.attempts = 0;
                    set(p, 'ready', 'Film-owned local worker ready · account verified. Model response is checked on your next approved request.');
                }
            } catch (e) {
                if (p.worker === w) {await w.stop(e.message); p.worker = null;}
                set(p, desired() ? 'error' : 'stopped', cleanError(e.message));
            }
        })().catch(e => {set(p, desired() ? 'error' : 'stopped', cleanError(e.message));});
        try {await p.starting;} finally {p.starting = null; if (p.state === 'error' || p.state === 'disconnected') schedule(p);}
    }
    async function attach(owner) {
        if (!uuid(owner)) throw Object.assign(Error('A Film application owner is required.'), {status: 400});
        if (closing) await closing;
        owners.set(owner, Date.now());
        await Promise.all([...providers.values()].map(p => prepare(p)));
        return status();
    }
    async function detach(owner) {
        owners.delete(owner);
        if (!desired()) await shutdown();
        return status();
    }
    function status() {return {application: 'film-engine-v2', owned: true, opened: desired(), providers: [...providers.values()].map(view)};}
    async function reconnect(id) {
        const p = providers.get(id);
        if (!p) throw Object.assign(Error('Unknown Film provider.'), {status: 400});
        if (!desired()) throw Object.assign(Error('Open Film before connecting.'), {status: 409});
        if (p.worker?.task || p.login) throw Object.assign(Error('Stop the active task or sign-in before reconnecting.'), {status: 409});
        clearTimeout(p.retry); p.retry = null; p.attempts = 0; p.auth_failed = false;
        if (p.worker) await p.worker.stop('Connection restart requested.');
        await p.starting; await prepare(p);
        return status();
    }
    function start(input, hooks) {
        const p = providers.get(input.provider);
        if (!p?.available || !p.worker || !desired()) throw Error('Film provider connection is not ready. Open AI connections.');
        const application = input.scope === 'application' && input.project_id === undefined && input.owner?.scope === 'application' && input.owner?.application_id === 'film-engine-v2';
        const project = (input.scope === undefined || input.scope === 'project') && uuid(input.project_id) && !input.owner;
        if ((!application && !project) || ![input.conversation_id,input.task_id].every(uuid) || input.session_id || input.resume) throw Error('Only a Film-owned project or application conversation may dispatch this task.');
        if (typeof input.payload !== 'string' || !input.payload.trim() || input.payload.length > 100000) throw Error('Invalid reviewed Film request.');
        const w = p.worker;
        if (w.task || w.stopped || w.closed) throw Error('This Film provider is busy or reconnecting.');
        w.task = {input, hooks, text: '', final: '', session: p.id === 'claude' ? w.session : '', failure: '', hookFailure: '', pendingHooks: [], cancelling: false, finished: false};
        set(p, 'busy', 'A reviewed Film request is running.');
        const notified = w.hook('event', {kind: 'progress', message: 'Using Film’s owned worker. Saved conversation/context came from the approved preview.'});
        const value = p.id === 'claude' ? JSON.stringify({type: 'user', session_id: w.session,
            message: {role: 'user', content: input.payload}, parent_tool_use_id: null}) + '\n' : input.payload;
        function send() {
            if (w.stopped || w.closed || w.task.hookFailure) return;
            w.child.stdin.write(JSON.stringify({type: 'input', value, close: p.id === 'codex'}) + '\n');
            w.taskTimer = setTimeout(() => w.stop('Film request exceeded the 10 minute limit.'), taskTimeout);
            w.taskTimer.unref?.();
        }
        if (notified && typeof notified.then === 'function') notified.then(ok => {if (ok) send();});
        else if (notified) send();
        return {closed: w.closedPromise, cancel() {if (w.closed || w.task.finished) return false; set(p, 'cancelling', 'Stop requested; waiting for Film’s worker to exit.'); w.stop('Stop requested by the user.', true); return true;}};
    }
    async function signIn(id, confirmed) {
        if (confirmed !== true) throw Object.assign(Error('Confirm secure provider sign-in first. Film never accepts passwords or API keys.'), {status: 400});
        const p = providers.get(id);
        if (!p || !desired()) throw Object.assign(Error('Open Film and select an installed provider.'), {status: 409});
        if (p.worker?.task || p.login) throw Object.assign(Error('This provider already has an active task or sign-in.'), {status: 409});
        const bin = resolveBinary(id);
        if (!bin) throw Object.assign(Error('Provider CLI is not installed.'), {status: 503});
        clearTimeout(p.retry); p.retry = null;
        if (p.worker) await p.worker.stop('Preparing secure sign-in.');
        await p.starting;
        clearTimeout(p.retry); p.retry = null;
        const dir = fs.mkdtempSync(path.join(temporaryRoot, 'film-owned-login-'));
        const login = {url: null, code: null, buffer: '', cancelled: false};
        let resolveDone; login.done = new Promise(resolve => {resolveDone = resolve;});
        p.login = login; p.connected = false; set(p, 'signing_in', 'Complete the provider’s secure browser sign-in. Credentials remain with its CLI.');
        function read(b) {
            login.buffer = (login.buffer + b.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-8000);
            for (const candidate of login.buffer.match(/https:\/\/[^\s\x1b]+/g) || []) {
                const safe = signInURL(candidate); if (safe) login.url = safe;
            }
            const code = login.buffer.match(/\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\b/);
            if (id === 'codex' && code) login.code = code[1];
        }
        let done = false;
        async function finish(code) {
            if (done) return; done = true;
            clearTimeout(login.timer); clearTimeout(login.killTimer);
            fs.rmSync(dir, {recursive: true, force: true});
            if (p.login === login) p.login = null;
            login.buffer = ''; login.code = null; login.url = null;
            set(p, 'disconnected', login.cancelled ? 'Sign-in stopped after its owned process exited.' : code === 0 ? 'Checking the signed-in account…' : 'Provider sign-in did not complete. Try secure sign-in again.');
            resolveDone();
            if (code === 0 && !login.cancelled) p.auth_failed = false;
            if (desired() && !login.cancelled) await prepare(p);
        }
        try {
            login.child = spawnProcess(process.execPath, [path.join(__dirname, 'ai-cli-guardian.cjs'), JSON.stringify({bin,
                args: id === 'claude' ? ['auth', 'login', '--claudeai'] : ['login', '--device-auth']})],
                {cwd: dir, env: ownedEnv(bin), stdio: ['pipe', 'pipe', 'pipe'], shell: false});
            login.child.stdout.on('data', read); login.child.stderr.on('data', read);
            login.child.stdin.on('error', () => {});
            login.child.on('error', () => finish(1)); login.child.on('close', finish);
            login.timer = setTimeout(() => cancelSignIn(id).catch(() => {}), 300000); login.timer.unref?.();
        } catch (e) {await finish(1); throw e;}
        return status();
    }
    async function cancelSignIn(id) {
        const p = providers.get(id), login = p?.login;
        if (!login) return status();
        login.cancelled = true; set(p, 'cancelling_sign_in', 'Stopping the owned sign-in process…');
        login.child.kill('SIGTERM');
        login.killTimer = setTimeout(() => login.child.kill('SIGKILL'), killDelay); login.killTimer.unref?.();
        await login.done;
        return status();
    }
    async function shutdown() {
        if (closing) return closing;
        owners.clear();
        closing = (async () => {
            for (const p of providers.values()) {clearTimeout(p.retry); p.retry = null;}
            await Promise.all([...providers.values()].map(async p => {
                if (p.login) await cancelSignIn(p.id);
                if (p.worker) await p.worker.stop('Film closed. This request was interrupted and will not be sent again.');
                if (p.starting) await p.starting;
                p.inference_verified = false;
                set(p, 'stopped', 'Film connection stopped. Saved conversations remain available.');
            }));
        })();
        try {await closing;} finally {closing = null;}
    }
    const leaseTimer = setInterval(() => {
        const cutoff = Date.now() - leaseMs;
        for (const [owner, timestamp] of owners) if (timestamp < cutoff) owners.delete(owner);
        if (!desired()) shutdown().catch(() => {});
    }, Math.min(15000, leaseMs)); leaseTimer.unref?.();
    return {attach, detach, status, providers: () => [...providers.values()].map(view), reconnect,
        start, signIn, cancelSignIn, shutdown, async dispose() {clearInterval(leaseTimer); await shutdown();}};
}
let instance;
function connections() {return instance || (instance = createAIConnections());}
module.exports = {createAIConnections, connections, workerArguments, ownedEnv, signInURL};
