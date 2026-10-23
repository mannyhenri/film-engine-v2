/**
 * PRODUCTION STUDIO: the routes behind the Generate and Assemble tabs.
 *
 *   GET  /film/production-studio/higgsfield-models          every Higgsfield video model, with its derived facts (free)
 *   GET  /film/production-studio/runway-models               every Runway video model, the Higgsfield model it is, its credits (free)
 *   GET  /film/production-studio/assemble-kinds             what Assemble takes in and the folder each lands in (free)
 *   POST /film/production-studio/recommend                  rank every model for a brief by the rules (free)
 *   POST /film/projects/:id/production-studio/recommend     the same, then an AI judgement when `ai` is true
 *   POST /film/projects/:id/production-studio/optimize-prompt   rewrite the composed prompt for the chosen model
 *   POST /film/projects/:id/production-studio/seedance-prompt   the final Seedance 2.5 prompt by ChatGPT, from the sheets,
 *        storyboard frames, dialogue (black-screen MP4) and the stored guide; writes the hand-off folder (lib/seedance-prompt.js).
 *        With { async: true }: 202 { job }, then GET …/seedance-prompt/jobs/:id → { job: { status, stage_label, elapsed_s, result } }
 *   POST /film/projects/:id/production-studio/send-to-resolve   write the Resolve package, open Resolve, import it
 *   GET|PUT|DELETE /film/projects/:id/production-studio/direction[/…]   the Direct studio's saved choices (free)
 *
 * Generation itself is NOT here: the page saves a Production draft (provider,
 * model, prompt, references) and posts it to the routes that already run, file
 * and review every paid request. This module only advises and hands over.
 */
const path = require('path');
const { db } = require('../db/database');
const { callProjectLLM } = require('../lib/llm-client');
const connectedAI = require('../lib/connected-ai');
const { fallbackNotice } = require('../lib/agent-presence');
const rec = require('../lib/model-recommender');
const { allFacts, factsFor } = require('../lib/video-model-facts');
const { assembleKinds } = require('../lib/assemble-kinds');

/** What replaces the AI calls here when an agent host is attached (tests/mcp-first-writing.test.js). */
const MCP_ALTERNATIVE = [
    {
        route: 'POST /film/projects/:id/production-studio/recommend (ai: true)',
        does: 'an AI judgement that re-ranks the eligible Higgsfield models for a shot',
        mcp_alternative: 'production_graph_get, then the connected model ranks the models itself from GET /film/production-studio/higgsfield-models',
        why: 'the connected model already reads the shot; the rules-only ranking is free and needs no key',
    },
    {
        route: 'POST /film/projects/:id/production-studio/optimize-prompt',
        does: 'rewrite a shot or sequence prompt for the chosen video model',
        mcp_alternative: 'production_graph_get, then the connected model writes the prompt and the director pastes it into Prompt',
        why: 'nothing is relayed: the model in the conversation writes the prompt with the whole film in context',
    },
];

function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}
async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    return new Promise(resolve => {
        let raw = '';
        req.on('data', c => { raw += c; });
        req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } });
    });
}
function briefOf(body) {
    const b = body || {};
    return { prompt: String(b.prompt || ''), duration_s: Number(b.duration_s) || 5, aspect: b.aspect || '16:9',
        resolution: b.resolution || undefined, shot_count: Math.max(1, Number(b.shot_count) || 1),
        reference_count: Math.max(0, Number(b.reference_count) || 0), has_start_frame: !!b.has_start_frame, dialogue: !!b.dialogue };
}
function projectOf(id) { return id ? db.prepare('SELECT * FROM film_projects WHERE id = ?').get(id) : null; }
/** The first JSON value in a model's answer, or null. */
function jsonIn(text, open) {
    const s = String(text || ''), i = s.indexOf(open), close = open === '[' ? ']' : '}';
    const j = s.lastIndexOf(close);
    if (i < 0 || j <= i) return null;
    try { return JSON.parse(s.slice(i, j + 1)); } catch (_) { return null; }
}

/**
 * How each family wants a prompt written, from its docs and from creators'
 * reports (docs/research/video-model-selection.md). Read by the rewrite.
 */
const PROMPT_TIPS = {
    'seedance-2-5': 'Lead with shot size, lens and camera move. Refer to attached pictures as @image1, @image2 in order. Keep beats few: it crams action when a prompt has many. Add "no subtitles, no on-screen text".',
    'seedance-2': 'Lead with shot size, lens and camera move. Refer to pictures as @image1… in order. Quote dialogue exactly and name the speaker. Add "no subtitles, no on-screen text".',
    'kling-3': 'For several shots write labelled shots ("Shot 1: … Shot 2: …", up to six, each under 512 characters). Tag speakers before quoted lines. Never ask for on-screen text.',
    'kling-o3': 'Describe the subject from the references; labelled shots for multi-shot. Tag speakers before quoted lines. Never ask for on-screen text.',
    'kling-omni': 'Describe the subject from the references; one clear action and camera move. Never ask for on-screen text.',
    'minimax-h3': 'Rich visual description, camera move stated plainly. It makes no sound: leave dialogue out of the prompt. Keep to one continuous scene; it splits multi-scene prompts.',
    'wan-3': 'State "one continuous take, no cuts" unless cuts are wanted. Few beats per take. Add "no music" unless music is asked for.',
    'wan-3-prime': 'State "one continuous take, no cuts" unless cuts are wanted. Few beats per take. Add "no music" unless music is asked for.',
    'cinema-studio-4': 'Describe action and light; lens, camera and grade are settings, not prose. Refer to pictures as <<<image_1>>>.',
    'grok-video-1-5': 'Keep it short. Do not include spoken lines: it burns them in as captions.',
};
const DEFAULT_TIPS = 'Lead with shot size, lens and camera move, then subject and action, then light and mood. One idea per clip. Refer to attached pictures as @image1, @image2 in order.';

/**
 * Ask an AI: the director's connected account first (Claude or Codex under AI connections, what Ask AI uses), the
 * project's API provider only when none is connected. The API adapters sit behind the final request review and
 * refuse ("Exact final request review is not supported for Anthropic yet"), so they cannot be the first resort.
 */
async function askAI(project, question) {
    const connected = await connectedAI.askConnectedAI(question);
    if (connected.ok) return { ok: true, answer: connected.answer, by: connected.provider === 'claude' ? 'Claude (your connected account)' : 'Codex (your connected account)' };
    const r = await callProjectLLM(project, { question, stream: false });
    if (r.ok) return { ok: true, answer: r.answer, by: r.provider_model || r.provider };
    return { ok: false, error: `${connected.error}; the project provider answered: ${r.error || 'no answer'}` };
}

async function judge(project, out) {
    const eligible = out.cards.slice(0, 10).map(c => ({ id: c.id, label: c.label, rule_fit: c.fit, reasons: c.reasons, facts: c.facts,
        note: (rec.FAMILY_PROFILES[c.family] || {}).note }));
    const question = 'You choose AI video models for a film director. Rank these Higgsfield models for the shot below. '
        + 'They have already passed the hard limits (length, shape, frames). Use the notes and facts; prefer quality, then consistency, then cost.\n\n'
        + `SHOT: ${JSON.stringify(out.brief)}\nDETECTED: ${out.traits.join(', ') || 'nothing special'}\nMODELS: ${JSON.stringify(eligible)}\n\n`
        + 'Answer ONLY with a JSON array: [{"id": "<model id>", "fit": <0-100>, "reason": "<one sentence for the director, specific to this shot>"}] covering every model above.';
    const r = await askAI(project, question);
    if (!r.ok) return { ...out, judge_error: r.error || 'the AI did not answer' };
    const list = jsonIn(r.answer, '[');
    if (!Array.isArray(list)) return { ...out, judge_error: 'the AI answer was not a list of models' };
    return { ...rec.mergeJudgement(out, list), judged_by: r.by };
}

async function optimize(project, body) {
    const f = body.model_id ? factsFor(body.model_id) : null;
    if (body.model_id && !f) return { status: 400, body: { error: `no Higgsfield video model ${body.model_id}` } };
    const original = String(body.prompt || '').trim();
    if (!original) return { status: 400, body: { error: 'nothing to optimize: the prompt is empty' } };
    const tips = (f && PROMPT_TIPS[f.family]) || DEFAULT_TIPS;
    const refs = Array.isArray(body.references) ? body.references.slice(0, 30) : [];
    const question = 'Rewrite this video-generation prompt for the model named below. Keep every story fact, every spoken line verbatim, '
        + 'and the order of shots. Do not invent characters, places or props.\n\n'
        + `MODEL: ${f ? `${f.label} (${f.duration.min}–${f.duration.max}s, ${f.native_audio ? 'makes sound' : 'no sound'}${f.multi_shot ? ', multi-shot' : ''})` : 'any'}\n`
        + `HOW THIS MODEL WANTS PROMPTS: ${tips}\n`
        + `LENGTH: ${Number(body.duration_s) || 5}s, ${body.aspect || '16:9'}${f && f.prompt_max ? `, at most ${f.prompt_max} characters` : ''}\n`
        + `ATTACHED PICTURES, IN ORDER: ${refs.length ? refs.map((r, i) => `@image${i + 1} = ${r.role || 'reference'}: ${r.name || ''}`).join('; ') : 'none'}\n\n`
        + `PROMPT:\n${original}\n\n`
        + 'Answer ONLY with JSON: {"prompt": "<the rewritten prompt>", "changes": ["<each change, one short sentence>"]}';
    const r = await askAI(project, question);
    const notice = fallbackNotice(MCP_ALTERNATIVE[1].mcp_alternative);
    if (!r.ok) return { status: 502, body: { error: r.error || 'the AI did not answer', path: notice } };
    const parsed = jsonIn(r.answer, '{');
    if (!parsed || typeof parsed.prompt !== 'string' || !parsed.prompt.trim()) return { status: 502, body: { error: 'the AI answer had no prompt in it', path: notice } };
    let prompt = parsed.prompt.trim();
    if (f && f.prompt_max && prompt.length > f.prompt_max) prompt = prompt.slice(0, f.prompt_max);
    return { status: 200, body: { prompt, original, model_id: body.model_id || null,
        changes: (Array.isArray(parsed.changes) ? parsed.changes : []).map(String).slice(0, 8), tips, by: r.by, path: notice } };
}

/** Write the Resolve package (the whole film, or one cut of it when `cut` is given), open Resolve and import it. */
async function sendToResolve(projectId, cut) {
    const project = projectOf(projectId);
    if (!project) return { status: 404, body: { error: 'Project not found' } };
    const rx = require('../lib/resolve-export');
    const { ensureDir } = require('../lib/file-storage');
    const safeTitle = (cut ? `${project.title || 'film'}_${cut.name}_v${cut.version}` : (project.title || 'timeline')).replace(/[^a-zA-Z0-9_-]/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(ensureDir(projectId, 'exports'), `${safeTitle}_Resolve_${stamp}`);
    let written;
    try { const { video, lanes, ...out } = rx.writeResolve(db, projectId, { dest, cut }); written = out; }
    catch (err) { return { status: err.code ? 409 : 500, body: { error: err.code || 'RESOLVE_EXPORT_FAILED', message: err.message } }; }
    const lua = require('../lib/resolve-lua');
    // Free Resolve takes the cut through its Scripts menu: install this package's script there (tests never reach here
    // with a real Resolve: FILM_RESOLVE_LAUNCH=0, or FILM_RESOLVE_SCRIPTS_DIR points elsewhere).
    const menu = lua.isFreeResolve() && process.env.FILM_RESOLVE_LAUNCH !== '0' ? lua.installLuaScript(dest) : null;
    if (menu) written.lua = { ...written.lua, ...menu };
    const launch = await require('../lib/resolve-launch').launchResolve(dest, { free: !!(menu && menu.installed), menu: menu && menu.menu });
    // The package folder in Finder only when Resolve could not take it at all (the menu script is the way in otherwise).
    if (!launch.imported && !launch.needs_click && process.platform === 'darwin' && process.env.FILM_RESOLVE_LAUNCH !== '0') {
        require('child_process').spawn('open', [dest], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    }
    return { status: 200, body: { ...written, imported_into_resolve: launch.imported, launch } };
}

/**
 * The Direct studio's saved choices (lib/production-direction.js):
 *   GET    …/production-studio/direction                 cards, saved direction, cast and settings for the film
 *   PUT    …/production-studio/direction/studio          { data, expected_revision? }  picked shots, sequence, sound bed
 *   PUT    …/production-studio/direction/shots/:shotId   { data, expected_revision? }  one shot's direction
 *   DELETE …/production-studio/direction/shots/:shotId   back to what the scene card says
 */
async function direction(req, res, projectId, rest) {
    const dir = require('../lib/production-direction');
    try {
        if (!rest.length && req.method === 'GET') return json(res, 200, dir.getDirection(db, projectId));
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readBody(req);
        if (rest[0] === 'studio' && !rest[1] && req.method === 'PUT') return json(res, 200, dir.saveStudio(db, projectId, body.data, body.expected_revision));
        if (rest[0] === 'shots' && rest[1] && !rest[2]) {
            if (req.method === 'PUT') return json(res, 200, dir.saveShot(db, projectId, rest[1], body.data, body.expected_revision));
            if (req.method === 'DELETE') return json(res, 200, dir.clearShot(db, projectId, rest[1]));
        }
        return json(res, 405, { error: 'Method not allowed' });
    } catch (err) {
        return json(res, err.status || 500, { error: err.message, ...(err.code ? { code: err.code } : {}) });
    }
}

async function handleProductionStudio(req, res, parts) {
    // parts: ['film','production-studio', sub] or ['film','projects',:id,'production-studio', sub]
    const scoped = parts[1] === 'projects';
    const projectId = scoped ? parts[2] : null;
    const sub = scoped ? parts[4] : parts[2];
    if (sub === 'higgsfield-models' && req.method === 'GET') {
        const cred = require('../lib/providers/higgsfield').credential();
        const catalog = require('../lib/higgsfield-catalog');
        const {websiteCost} = require('../lib/higgsfield-cost');
        return json(res, 200, { models: allFacts(), website_models:catalog.websiteModels().map(m=>({...m,cost:websiteCost(m.id)})),
            api_modes:catalog.apiModes(), connected: cred.ok, connect: cred.ok ? null : cred.error,
            traits: rec.TRAITS.map(t => ({ id: t.id, label: t.label })) });
    }
    if (sub === 'assemble-kinds' && req.method === 'GET') return json(res, 200, { kinds: assembleKinds() });
    if (sub === 'runway-models' && req.method === 'GET') {
        const rw = require('../lib/runway-catalog');
        return json(res, 200, { models: rw.runwayModels(), connected: rw.connected(), usd_per_credit: rw.USD_PER_CREDIT });
    }
    if (scoped && sub === 'direction') return direction(req, res, projectId, parts.slice(5));
    if (scoped && sub === 'seedance-prompt' && parts[5] === 'jobs' && parts[6] && req.method === 'GET') {
        try { return json(res, 200, { job: require('../lib/seedance-prompt').getJob(parts[6]) }); }
        catch (err) { return json(res, err.status || 500, { error: err.message }); }
    }
    if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
    const body = await readBody(req);
    if (sub === 'recommend') {
        const out = rec.recommend(briefOf(body));
        if (!body.ai || !out.cards.length) return json(res, 200, out);
        const project = projectOf(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });
        const judged = await judge(project, out);
        return json(res, 200, { ...judged, path: fallbackNotice(MCP_ALTERNATIVE[0].mcp_alternative) });
    }
    if (!scoped) return json(res, 404, { error: 'Not found' });
    if (sub === 'optimize-prompt') {
        const project = projectOf(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });
        const r = await optimize(project, body);
        return json(res, r.status, r.body);
    }
    if (sub === 'seedance-prompt') {
        // { async: true } starts it as a job (202, then GET …/seedance-prompt/jobs/:id for the stage); else it answers when done.
        const sp = require('../lib/seedance-prompt');
        try { return body.async ? json(res, 202, { job: sp.startJob(projectId, body) }) : json(res, 200, await sp.writeSeedancePrompt(projectId, body)); }
        catch (err) { return json(res, err.status || 500, { error: err.message }); }
    }
    if (sub === 'send-to-resolve') { const r = await sendToResolve(projectId); return json(res, r.status, r.body); }
    return json(res, 404, { error: 'Not found' });
}

module.exports = { handleProductionStudio, sendToResolve, MCP_ALTERNATIVE, PROMPT_TIPS, useConnectedAI: connectedAI.useRunner };
