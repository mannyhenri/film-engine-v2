'use strict';
/**
 * Higgsfield, SIGNED IN: Film Engine as an app on the person's own Higgsfield
 * account, the way Claude's Higgsfield connector is.
 *
 *   https://mcp.higgsfield.ai/mcp     MCP over Streamable HTTP (JSON-RPC 2.0)
 *   OAuth 2.1 + PKCE, discovered from the server and registered dynamically
 *   (routes/providers.js runs the flow; this adapter only spends the token).
 *
 * Not lib/providers/higgsfield.js. That one is the developer API: an API key,
 * a pay-as-you-go balance, and only the image and video models Higgsfield
 * publishes there. This one is the person's PLAN — its credits and the whole
 * app catalogue (Nano Banana Pro, GPT Image 2.5, Veo, Seedance 2.5, Kling,
 * Soul, speech, upscale, 3D) — which is what they were generating by hand.
 *
 * What it serves, and what it does not:
 *   image   generate_image      video   generate_video     voice  generate_audio
 *   post    upscale_video       model3d generate_3d
 *   NOT sfx / ambient: Higgsfield's only sound-effect and music models
 *   (mirelo_text_to_audio, sonilo_music) are marked "Game pipeline only", and
 *   its own tool instructions say they must not be used for standalone audio.
 *   NOT lipsync / world: there is no Higgsfield tool for either.
 *
 * The final review freezes the TOOL ARGUMENTS (`{ model, prompt, medias, … }`),
 * the thing a person reads and edits. The JSON-RPC envelope around them is
 * fixed and added at dispatch, so the transport still proves it sent exactly
 * what was approved. Pictures travel as Higgsfield media ids: each reference is
 * uploaded (media_upload → presigned PUT → media_confirm) and its id replaces
 * its bytes on the wire, recorded as an adapter upload of those approved bytes.
 *
 * Asynchronous: a generate call answers with job ids, written down before
 * polling (jobs_wait, ≤15 s per call) so an abandoned call can still collect.
 */

const fs = require('fs');
const path = require('path');
const oauth = require('./oauth');
const secrets = require('../secret-store');

const PROVIDER = 'higgsfield-mcp';
const MCP_URL = (process.env.HIGGSFIELD_MCP_BASE_URL || 'https://mcp.higgsfield.ai/mcp').replace(/\/+$/, '');
const PROTOCOL = '2025-06-18';
const PROMPT_LIMIT = 4000;
const POLL_TIMEOUT_MS = Number(process.env.HIGGSFIELD_MCP_POLL_TIMEOUT_MS || 1800000);
const TERMINAL_OK = new Set(['completed', 'succeeded', 'success', 'done']);
const TERMINAL_BAD = new Set(['failed', 'nsfw', 'canceled', 'cancelled', 'lookup_failed', 'error']);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── the catalogue ──────────────────────────────────────────────────────── */

/*
 * Image models, from models_explore on 2026-10-24. `role` is the media role the
 * model reads references under; `max` how many it takes; `res` its resolution
 * parameter. Credits are Higgsfield's own get_cost quotes (16:9, default size).
 */
const ASPECT_WIDE = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '9:16', '16:9', '21:9'];
const IMAGE_MODELS = Object.freeze({
    nano_banana_pro: { label: 'Nano Banana Pro', role: 'image_references', max: 8, aspects: ASPECT_WIDE, res: { param: 'resolution', options: ['1k', '2k', '4k'], default: '2k' }, credits: { '1k': 2, '2k': 2, '4k': 4 } },
    nano_banana_2: { label: 'Nano Banana 2', role: 'image_references', max: 8, aspects: ASPECT_WIDE, res: { param: 'resolution', options: ['1k', '2k', '4k'], default: '1k' }, credits: { '1k': 1.5 } },
    nano_banana_2_lite: { label: 'Nano Banana 2 Lite', role: 'image_references', max: 8, aspects: ASPECT_WIDE, res: { param: 'resolution', options: ['1k'], default: '1k' }, credits: { '1k': 1 } },
    gpt_image_2_5: { label: 'GPT Image 2.5', role: 'image_references', max: 8, aspects: ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '4:5', '5:4'], res: { param: 'resolution', options: ['1k', '2k', '4k'], default: '1k' }, credits: { '1k': 0.25 } },
    seedream_v5_pro: { label: 'Seedream 5.0 Pro', role: 'image_references', max: 8, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], res: { param: 'resolution', options: ['1k', '1.5k', '2k'], default: '2k' }, credits: { '2k': 2.5 } },
    soul_2: { label: 'Higgsfield Soul 2.0', role: 'image', max: 1, aspects: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'], res: { param: 'quality', options: ['1.5k', '2k'], default: '2k' }, credits: { '2k': 1 } },
    soul_cinematic: { label: 'Soul Cinema', role: 'image', max: 1, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], res: { param: 'quality', options: ['1.5k', '2k'], default: '2k' }, credits: { '2k': 1 } },
    soul_location: { label: 'Soul Location', role: null, max: 0, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'], res: null, credits: {} },
    cinematic_studio_2_5: { label: 'Cinema Studio Image 2.5', role: 'image', max: 8, aspects: ASPECT_WIDE, res: { param: 'resolution', options: ['1k', '2k', '4k'], default: '1k' }, credits: {} },
    flux_2: { label: 'FLUX.2', role: 'image_references', max: 8, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], res: { param: 'resolution', options: ['1k', '2k'], default: '1k' }, credits: {} },
    flux_kontext: { label: 'Flux Kontext', role: 'image_references', max: 8, aspects: ['1:1', '4:3', '3:4', '16:9', '9:16'], res: null, credits: {} },
    kling_omni_image: { label: 'Kling O1 Image', role: 'image_references', max: 8, aspects: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'], res: { param: 'resolution', options: ['1k', '2k'], default: '1k' }, credits: {} },
});
const DEFAULT_IMAGE_MODEL = process.env.HIGGSFIELD_MCP_IMAGE_MODEL || 'nano_banana_pro';

/* Video: the app catalogue already kept for Production › Generate (roles, lengths, sizes, credits). */
const appCatalog = () => require('../higgsfield-app-catalog');
const DEFAULT_VIDEO_MODEL = process.env.HIGGSFIELD_MCP_VIDEO_MODEL || 'seedance_2_5';

const VOICE_MODELS = Object.freeze({
    seed_audio: { label: 'Seed Audio 1.0 (Higgsfield default)' },
    text2speech_v2: { label: 'Text to Speech V2 (ElevenLabs engine)', variant: 'elevenlabs' },
});
const POST_MODELS = Object.freeze({
    topaz: { label: 'Topaz Video (1080p / 2160p)', resolutions: ['1080p', '2160p'] },
    bytedance: { label: 'ByteDance upscale (1080p / 2K / 4K)', resolutions: ['1080p', '2k', '4k'] },
});
const MODEL3D_MODELS = Object.freeze({
    image_to_3d: { label: 'Image to 3D (Meshy, one picture)' },
    multi_image_to_3d: { label: 'Multi-Image to 3D (Meshy, 2-4 views)' },
    meshy_v7_image_to_3d: { label: 'Meshy 7 Image to 3D' },
    meshy_v6_text_to_3d: { label: 'Meshy 6 Text to 3D' },
});
const TOOLS = Object.freeze({ image: 'generate_image', video: 'generate_video', voice: 'generate_audio', post: 'upscale_video', model3d: 'generate_3d' });
const CAPABILITIES = Object.keys(TOOLS);

/* ── the sign-in ────────────────────────────────────────────────────────── */

function meta() {
    try { return require('./credentials').getCredential(PROVIDER).meta || {}; } catch (_) { return {}; }
}
function tokens() { try { return secrets.get(PROVIDER) || {}; } catch (_) { return {}; } }
function isConnected() { return !!tokens().access_token; }

const notConnected = () => ({ ok: false, status: 401, error: 'higgsfield: not signed in. Settings › Providers › Connect Higgsfield signs Film Engine in to your Higgsfield account.' });

/** A live access token, refreshed when it is within a minute of expiring (or when asked to). */
async function accessToken({ force = false } = {}) {
    const t = tokens();
    if (!t.access_token) return null;
    const expiring = t.expires_at && Date.now() > Number(t.expires_at) - 60000;
    if (!force && !expiring) return t.access_token;
    const m = meta();
    if (!t.refresh_token || !m.token_endpoint || !m.client_id) return force ? null : t.access_token;
    try {
        const fresh = await oauth.refreshToken({ token_endpoint: m.token_endpoint }, { clientId: m.client_id, clientSecret: m.client_secret, refresh_token: t.refresh_token });
        secrets.merge(PROVIDER, {
            access_token: fresh.access_token,
            refresh_token: fresh.refresh_token || t.refresh_token,
            expires_at: fresh.expires_in ? Date.now() + fresh.expires_in * 1000 : '',
        });
        return fresh.access_token;
    } catch (_) {
        return null;
    }
}

/* ── MCP over Streamable HTTP ───────────────────────────────────────────── */

let session = null;   // { id, token }
let nextId = 2;       // 1 is the id every creative call carries in its frozen envelope

/** One JSON-RPC message out of a JSON or an SSE answer. */
async function readMessage(res, id) {
    const type = String(res.headers.get('content-type') || '');
    const text = await res.text();
    if (!text.trim()) return null;
    if (type.includes('text/event-stream')) {
        let found = null;
        for (const block of text.split(/\r?\n\r?\n/)) {
            const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            try { const msg = JSON.parse(data); if (id === undefined || msg.id === id) found = msg; } catch (_) { /* a keep-alive */ }
        }
        return found;
    }
    try { return JSON.parse(text); } catch (_) { return { error: { message: text.slice(0, 300) } }; }
}

function headersFor(token) {
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': PROTOCOL };
    if (session && session.id) h['Mcp-Session-Id'] = session.id;
    return h;
}

async function initialize(token) {
    session = null;
    const res = await fetch(MCP_URL, { method: 'POST', headers: headersFor(token), body: JSON.stringify({
        jsonrpc: '2.0', id: nextId++, method: 'initialize',
        params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'Film Engine', version: '2' } },
    }) });
    if (res.status === 401) return { ok: false, status: 401 };
    const msg = await readMessage(res);
    if (!res.ok || !msg || msg.error) return { ok: false, status: res.status || 502, error: `higgsfield: the MCP server refused to start a session — ${(msg && msg.error && msg.error.message) || res.status}` };
    session = { id: res.headers.get('mcp-session-id') || null, token };
    await fetch(MCP_URL, { method: 'POST', headers: headersFor(token), body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => null);
    return { ok: true };
}

/** A session on a live token: refreshed once on a 401, restarted once when the server forgot it. */
async function ready() {
    let token = await accessToken();
    if (!token) return notConnected();
    if (session && session.token === token) return { ok: true, token };
    let init = await initialize(token);
    if (!init.ok && init.status === 401) {
        token = await accessToken({ force: true });
        if (!token) return notConnected();
        init = await initialize(token);
    }
    if (!init.ok) return init.status === 401 ? notConnected() : init;
    return { ok: true, token };
}

/** The tool's own answer: structured content, else the JSON in its first text block, else the text. */
function toolResult(result) {
    if (!result) return null;
    if (result.structuredContent) return result.structuredContent;
    const text = (result.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { return JSON.parse(text); } catch (_) { return text; }
}

/** Call a non-creative tool (balance, uploads, polling). Creative calls go through the transport instead. */
async function callTool(name, args, { retried = false } = {}) {
    const r = await ready();
    if (!r.ok) return r;
    let res, msg;
    const id = nextId++;
    try {
        res = await fetch(MCP_URL, { method: 'POST', headers: headersFor(r.token), body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args || {} } }) });
        msg = await readMessage(res, id);
    } catch (err) { return { ok: false, status: 502, error: `higgsfield: could not reach ${MCP_URL} — ${err.message}` }; }
    if ((res.status === 401 || res.status === 404) && !retried) { session = null; if (res.status === 401) await accessToken({ force: true }); return callTool(name, args, { retried: true }); }
    if (res.status === 401) return notConnected();
    if (!res.ok || !msg) return { ok: false, status: res.status || 502, error: `higgsfield: ${name} answered HTTP ${res.status}` };
    if (msg.error) return { ok: false, status: 502, error: `higgsfield: ${name} — ${msg.error.message || JSON.stringify(msg.error).slice(0, 300)}` };
    const value = toolResult(msg.result);
    if (msg.result && msg.result.isError) return { ok: false, status: 422, error: `higgsfield: ${name} — ${typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400)}` };
    return { ok: true, value };
}

/* ── the request (pure: the preview and the paid call read the same function) ── */

const first = (...vs) => vs.find(v => v !== undefined && v !== null && v !== '');
const uriOf = v => (typeof v === 'string' ? v : (v && (v.uri || v.url || v.image_url || v.src || v.image || v.file_path))) || null;
function selectedUri(value, role) {
    const uri = uriOf(value);
    if (typeof uri !== 'string' || !uri.trim()) throw new Error(`higgsfield: selected ${role} has no supported reference source`);
    return uri;
}

/** Keyframes in order, then references, exactly as the payload carries them (the review binds them by order). */
function picturesOf(p) {
    for (const field of ['keyframes', 'reference_images', 'audio_references']) if (p[field] != null && !Array.isArray(p[field])) throw new Error(`higgsfield: ${field} must be an array`);
    const initial = [p.init_image, p.image_url].filter(v => v != null && v !== '').map(v => selectedUri(v, 'init_image'))[0];
    const last = [p.last_frame, p.end_image].filter(v => v != null && v !== '').map(v => selectedUri(v, 'last_frame'))[0];
    const frames = (p.keyframes || []).map(k => selectedUri(k, 'keyframe'));
    const ends = [initial, last].filter(Boolean);
    const aliases = ends.length && frames.length === ends.length && frames.every((uri, i) => uri === ends[i]);
    const keys = aliases ? frames : [...(initial ? [initial] : []), ...frames, ...(last ? [last] : [])];
    const refs = (p.reference_images || []).map(ref => selectedUri(ref, 'image'));
    const audio = (p.audio_references || []).map(ref => selectedUri(ref, 'audio'));
    return { keys, refs, audio, hasLast: !!last && !aliases ? true : (aliases && frames.length > 1) };
}

function ratioOf(p) {
    const declared = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(p.aspect_ratio || ''));
    if (declared) return Number(declared[1]) / Number(declared[2]);
    const m = /^(\d+)\s*[x:]\s*(\d+)$/.exec(String(p.target_resolution || '')) || (p.width && p.height ? [0, p.width, p.height] : null);
    return m ? Number(m[1]) / Number(m[2]) : 16 / 9;
}
function nearestAspect(allowed, p) {
    if (allowed.includes(String(p.aspect_ratio || ''))) return String(p.aspect_ratio);
    const want = ratioOf(p);
    let best = null, err = Infinity;
    for (const a of allowed) {
        const r = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(a);
        if (!r) continue;
        const e = Math.abs(Number(r[1]) / Number(r[2]) - want);
        if (e < err) { best = a; err = e; }
    }
    return best;
}
/** "1k" / "2k" / "4k" from the long edge the project asks for, on the options this model offers. */
function imageTier(options, p) {
    if (options.includes(String(p.resolution || ''))) return String(p.resolution);
    const m = /^(\d+)\s*[x:]\s*(\d+)$/.exec(String(p.target_resolution || ''));
    const long = m ? Math.max(Number(m[1]), Number(m[2])) : Math.max(Number(p.width) || 0, Number(p.height) || 0) || 2048;
    const size = o => ({ '768sq': 768, '1k': 1024, '1.5k': 1536, '2k': 2048, '4k': 4096 }[o] || 0);
    const fit = [...options].sort((a, b) => size(a) - size(b)).find(o => size(o) >= long * 0.95);
    return fit || options[options.length - 1];
}

const media = (role, value) => ({ role, value });

function buildImage(p) {
    const substituted = p.model && !IMAGE_MODELS[p.model] ? p.model : null;
    const model = IMAGE_MODELS[p.model] ? p.model : DEFAULT_IMAGE_MODEL;
    const m = IMAGE_MODELS[model];
    const { keys, refs } = picturesOf(p);
    if (p.audio_references && p.audio_references.length) throw new Error('higgsfield: image generation takes no audio references');
    const pictures = [...keys, ...refs];
    if (pictures.length && !m.role) throw new Error(`higgsfield: ${model} takes no reference images`);
    if (pictures.length > m.max) throw new Error(`higgsfield: ${model} accepts at most ${m.max} reference images; remove the excess selected images`);
    const body = { model, prompt: String(first(p.prompt, '')).trim().slice(0, PROMPT_LIMIT) };
    const aspect = nearestAspect(m.aspects, p);
    if (aspect) body.aspect_ratio = aspect;
    if (m.res) body[m.res.param] = imageTier(m.res.options, p);
    if (pictures.length) body.medias = pictures.map(uri => media(m.role, uri));
    if (p.soul_id && /^soul/.test(model)) body.soul_id = String(p.soul_id);
    body.use_unlim = false;
    const notes = [];
    if (substituted) notes.push(`${substituted} is not a Higgsfield image model; ${m.label} is used instead.`);
    if (p.negative_prompt) notes.push('Higgsfield image models take no negative prompt; it is not sent.');
    if (p.seed !== undefined && p.seed !== null) notes.push('This model takes no seed; it is not sent.');
    return { tool: 'generate_image', model, body, notes };
}

/*
 * Editing footage (a background replacement): Seedance 2.5's video_edit mode,
 * the one Higgsfield model that takes a clip and changes it. Billed by the
 * length of the clip handed in, so it is priced from the measured source.
 */
const EDIT_MODELS = Object.freeze(['seedance_2_5']);
function buildVideoEdit(p, source) {
    const { MODELS, priceFor } = appCatalog();
    const model = p.model && EDIT_MODELS.includes(p.model) ? p.model : EDIT_MODELS[0];
    if (p.model && !EDIT_MODELS.includes(p.model)) throw new Error(`higgsfield: ${p.model} cannot edit footage; ${EDIT_MODELS.join(', ')} can`);
    const prompt = String(first(p.promptText, p.prompt, p.motion_prompt, '')).trim();
    if (!prompt) throw new Error('higgsfield: say what to change in the clip');
    const m = MODELS[model];
    const body = { model, prompt, mode: 'video_edit', medias: [media('video_references', selectedUri(source, 'source_video'))] };
    if (m.resolution && m.resolution.values) body[m.resolution.param] = m.resolution.values[String(p.resolution || '')] || m.resolution.values['720p'] || Object.values(m.resolution.values)[0];
    if (m.audio && m.audio.param) body[m.audio.param] = m.audio.off;
    body.use_unlim = false;
    const seconds = Math.max(1, Math.round(Number(p.sourceSeconds || p.source_seconds) || 5));
    const price = priceFor(model, { duration_s: seconds, resolution: body.resolution, audio: false });
    return { tool: 'generate_video', model, body, notes: ['Billed by the length of the clip handed in; duration and aspect follow the source.'],
        credits: price && price.credits, estimated_usd: price && price.usd, durationSeconds: seconds };
}

/** A tier's short edge: "720p" → 720, "2K" → 1440, "4K" → 2160. */
function tierShort(t) {
    const s = String(t).toLowerCase();
    if (/^\d+p$/.test(s)) return Number(s.slice(0, -1));
    if (/^\d+k$/.test(s)) return { 1: 1080, 2: 1440, 4: 2160 }[Number(s.slice(0, -1))] || null;
    return null;
}

/**
 * The frame a clip really comes back at: the model's largest tier at or below
 * the ask's short edge, in the ask's shape; its smallest when every tier is
 * above it. A model that publishes no tier is taken at 1080p and says so.
 */
function deliverableFrame(payload) {
    const p = payload || {};
    const { MODELS } = appCatalog();
    const model = MODELS[p.model] ? p.model : DEFAULT_VIDEO_MODEL;
    const m = MODELS[model];
    const mm = /^(\d+)\s*[x:]\s*(\d+)$/.exec(String(p.target_resolution || ''));
    const w = Number(p.width) || (mm ? Number(mm[1]) : 1920), h = Number(p.height) || (mm ? Number(mm[2]) : 1080);
    const askShort = Math.min(w, h), ratio = Math.max(w, h) / askShort;
    const tiers = (m.resolution && m.resolution.values ? Object.keys(m.resolution.values) : []).map(t => ({ t, n: tierShort(t) })).filter(x => x.n).sort((a, b) => a.n - b.n);
    const pick = tiers.length ? (tiers.filter(x => x.n <= askShort).pop() || tiers[0]) : { t: '1080p', n: 1080 };
    const long = Math.round(pick.n * ratio / 2) * 2;
    const frame = w >= h ? { width: long, height: pick.n } : { width: pick.n, height: long };
    const downgraded = Math.max(frame.width, frame.height) < Math.max(w, h);
    const offered = tiers.length ? tiers.map(x => x.t).join(', ') : 'no resolution tiers (taken as 1080p)';
    return { ...frame, tier: pick.t, downgraded, why: downgraded ? `Higgsfield ${m.label} offers ${offered}; ${pick.t} is its largest at or below ${w}x${h}.` : null };
}

function buildVideo(p) {
    const source =first(p.videoUri, p.video_uri, p.source_video, p.video_url);
    if (source) return buildVideoEdit(p, source);
    const { MODELS, priceFor } = appCatalog();
    const notes = [];
    // A model Higgsfield does not carry (a local gateway name, a retired id) runs on the default, and says so;
    // the final review refuses an unknown model outright before anything is approved.
    if (p.model && !MODELS[p.model]) notes.push(`${p.model} is not a Higgsfield video model; ${MODELS[DEFAULT_VIDEO_MODEL].label} is used instead.`);
    const model = MODELS[p.model] ? p.model : DEFAULT_VIDEO_MODEL;
    const m = MODELS[model];
    const { keys, refs, audio } = picturesOf(p);
    const roles = new Set(m.roles || []);
    const medias = [];
    if (keys.length) {
        if (!roles.has('start_image') && !roles.has('image_references')) throw new Error(`higgsfield: ${model} takes no keyframe images`);
        if (keys.length > 2 || (keys.length === 2 && !roles.has('end_image'))) throw new Error(`higgsfield: ${model} accepts at most ${roles.has('end_image') ? 2 : 1} keyframe image(s); remove the excess selected keyframes`);
        medias.push(media(roles.has('start_image') ? 'start_image' : 'image_references', keys[0]));
        if (keys[1]) medias.push(media('end_image', keys[1]));
    }
    if (refs.length) {
        if (!roles.has('image_references')) throw new Error(`higgsfield: ${model} takes no reference images`);
        const cap = Number(m.max_images) || refs.length;
        if (refs.length > cap) throw new Error(`higgsfield: ${model} accepts at most ${cap} reference images; remove the excess selected images`);
        for (const r of refs) medias.push(media('image_references', r));
    }
    if (audio.length) {
        if (!roles.has('audio_references')) throw new Error(`higgsfield: ${model} takes no audio references`);
        for (const a of audio) medias.push(media('audio_references', a));
    }
    const asked = Number(first(p.duration_s, p.duration, p.duration_ms ? p.duration_ms / 1000 : undefined, 5));
    let prompt = String(first(p.motion_prompt, p.prompt, '')).trim();
    // The prompt arrives compiled to this adapter's ceiling (motion-prompt.compileFor); this only guarantees it.
    if (prompt.length > PROMPT_LIMIT) { prompt = prompt.slice(0, PROMPT_LIMIT); notes.push(`The prompt was cut to Higgsfield's ${PROMPT_LIMIT} characters.`); }
    const body = { model, prompt };
    const d = m.duration || {};
    body.duration = d.values ? (d.values.find(v => v >= asked) || d.max) : Math.max(d.min || 1, Math.min(Math.round(asked), d.max || 30));
    if (body.duration !== Math.round(asked)) notes.push(`Length: ${asked}s is outside what ${m.label} takes — it will generate ${body.duration}s.`);
    const aspect = nearestAspect(m.aspects || ['16:9'], p);
    if (aspect) body.aspect_ratio = aspect;
    if (m.resolution && m.resolution.values) {
        const tiers = Object.keys(m.resolution.values);
        const mm = /^(\d+)\s*[x:]\s*(\d+)$/.exec(String(p.target_resolution || ''));
        const short = mm ? Math.min(Number(mm[1]), Number(mm[2])) : 1080;
        // The same choice deliverableFrame reports: the largest tier at or below the ask, else the smallest.
        const sorted = tiers.filter(t => tierShort(t)).sort((a, b) => tierShort(a) - tierShort(b));
        const want = tiers.includes(String(p.resolution || '')) ? String(p.resolution)
            : (sorted.filter(t => tierShort(t) <= short).pop() || sorted[0] || tiers[0]);
        body[m.resolution.param] = m.resolution.values[want];
    }
    // Silent by default: Film Engine owns the sound, as on every other video adapter.
    if (m.audio && m.audio.param) body[m.audio.param] = first(p.generate_audio, p.audio, false) ? m.audio.on : m.audio.off;
    // Seedance 2.5 reads pictures only in its omni-reference mode.
    if (/^seedance_2_5/.test(model) && medias.length) body.mode = 'omni_reference';
    if (medias.length) body.medias = medias;
    body.use_unlim = false;
    if (p.negative_prompt) notes.push('Higgsfield video models take no negative prompt; it is not sent.');
    const price = priceFor(model, { duration_s: body.duration, resolution: body.resolution, audio: m.audio ? body[m.audio.param] === m.audio.on : undefined });
    return { tool: 'generate_video', model, body, notes, credits: price && price.credits, estimated_usd: price && price.usd };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function buildVoice(p) {
    if (p.model && !VOICE_MODELS[p.model]) throw new Error(`higgsfield: unknown voice model ${p.model}`);
    const model = p.model || 'seed_audio';
    const text = String(first(p.text, p.prompt, '')).trim();
    if (!text) throw new Error('higgsfield: a line of dialogue is needed');
    const body = { model, prompt: text };
    const notes = [];
    // A Higgsfield voice is a UUID (list_voices); an ElevenLabs voice id is not one, so it is never passed on as if it were.
    const voice = first(p.higgsfield_voice_id, UUID_RE.test(String(p.voice_id || '')) ? p.voice_id : undefined);
    if (voice) { body.voice_type = p.higgsfield_voice_type === 'element' ? 'element' : 'preset'; body.voice_id = String(voice); }
    else notes.push('No Higgsfield voice is cast for this character yet, so Higgsfield picks its default voice. Cast one from Higgsfield’s voice list to keep the character consistent.');
    if (model === 'text2speech_v2') {
        if (!voice) throw new Error('higgsfield: Text to Speech V2 needs a cast Higgsfield voice');
        body.variant = VOICE_MODELS.text2speech_v2.variant;
    }
    body.use_unlim = false;
    return { tool: 'generate_audio', model, body, notes };
}

function buildPost(p) {
    const type = String(p.type || p.job_type || 'upscale');
    if (type !== 'upscale') throw new Error(`higgsfield: ${type.replace('_', ' ')} is not a Higgsfield tool; only upscaling is`);
    // Another vendor's upscaler name (a MuAPI or Topaz-API model) runs on Higgsfield's Topaz Video.
    const model = POST_MODELS[p.model] ? p.model : 'topaz';
    const source = first(p.source_video, p.video_url, p.input_video, p.input_url);
    if (!source) throw new Error('higgsfield: a source video is required');
    const m = /^(\d+)\s*[x:]\s*(\d+)$/.exec(String(p.target_resolution || ''));
    const short = m ? Math.min(Number(m[1]), Number(m[2])) : 2160;
    const body = { provider: model, medias: [media('video', selectedUri(source, 'source_video'))] };
    if (model === 'topaz') { body.resolution = short > 1080 ? '2160p' : '1080p'; body.aspect_ratio = 'auto'; }
    else {
        body.resolution = short > 1440 ? '4k' : short > 1080 ? '2k' : '1080p';
        const w = Number(p.source_width || p.width), h = Number(p.source_height || p.height);
        if (!(w > 0 && h > 0)) throw new Error('higgsfield: the ByteDance upscaler needs the source video width and height');
        body.width = Math.round(w); body.height = Math.round(h);
        if ([24, 30, 60].includes(Number(p.source_fps))) body.fps = Number(p.source_fps);
    }
    return { tool: 'upscale_video', model, body, notes: [] };
}

const MESH_FIELDS = ['should_texture', 'enable_pbr', 'pose_mode', 'target_polycount', 'topology', 'symmetry_mode', 'should_remesh', 'texture_prompt', 'seed'];
function buildModel3d(p) {
    if (p.model && !MODEL3D_MODELS[p.model]) throw new Error(`higgsfield: unknown 3D model ${p.model}`);
    const op = String(p.operation || '');
    if (/rig|animat|retexture|remesh|refine/.test(op)) {
        return { refused: `higgsfield: ${op} works on a model already on Higgsfield; a Film Engine model is not. Generate the mesh on Higgsfield with rigging switched on instead.` };
    }
    const images = [...(Array.isArray(p.image_urls) ? p.image_urls : []), p.image_url, p.image].filter(Boolean).map(v => selectedUri(v, 'image'));
    const prompt = String(first(p.prompt, '')).trim();
    let model = p.model;
    if (!model) model = images.length > 1 ? 'multi_image_to_3d' : images.length ? 'image_to_3d' : 'meshy_v6_text_to_3d';
    if (model === 'meshy_v6_text_to_3d' && !prompt) throw new Error('higgsfield: text to 3D needs a description');
    if (model !== 'meshy_v6_text_to_3d' && !images.length) throw new Error(`higgsfield: ${model} needs a picture of the subject`);
    if (model === 'multi_image_to_3d' && images.length > 4) throw new Error('higgsfield: Multi-Image to 3D takes at most 4 views; remove the excess selected images');
    if ((model === 'image_to_3d' || model === 'meshy_v7_image_to_3d') && images.length > 1) throw new Error(`higgsfield: ${model} takes one picture; choose Multi-Image to 3D for several views`);
    const body = { model };
    if (model === 'meshy_v6_text_to_3d') { body.prompt = prompt; body.mode = 'full'; }
    else body.medias = images.map(uri => media(model === 'meshy_v7_image_to_3d' ? 'image_references' : 'image', uri));
    for (const f of MESH_FIELDS) if (p[f] !== undefined && p[f] !== null && p[f] !== '') body[f] = p[f];
    if (body.should_texture === undefined && model !== 'meshy_v6_text_to_3d') body.should_texture = true;
    return { tool: 'generate_3d', model, body, notes: [] };
}

const BUILDERS = { image: buildImage, video: buildVideo, voice: buildVoice, post: buildPost, model3d: buildModel3d };

/**
 * The request a generation would send: the tool, and its arguments as the
 * final review shows them. `url` names the server and the tool, so a review of
 * one tool can never authorize another.
 */
function buildRequest(capability, payload) {
    const build = BUILDERS[capability];
    if (!build) throw Object.assign(new Error(`higgsfield: ${capability} is not served by Higgsfield`), { status: 400 });
    const req = build(payload || {});
    if (req.refused) return { refused: req.refused, url: `${MCP_URL}#${TOOLS[capability]}` };
    return { url: `${MCP_URL}#${req.tool}`, ...req, dropped: [], missing: [] };
}

function describeRequest(capability, payload) {
    const req = buildRequest(capability, payload);
    if (req.refused) return req;
    const short = v => (typeof v === 'string' && v.startsWith('data:') ? `(a ${Math.round(v.length * 0.75 / 1024)} KB file, uploaded to Higgsfield first)` : v);
    const body = { ...req.body };
    if (Array.isArray(body.medias)) body.medias = body.medias.map(x => ({ ...x, value: short(x.value) }));
    return { ...req, body };
}

/**
 * What a clip would be sent and cost, in the shape every video preview reads:
 * the model, the length, whether the keyframe travels, the credits, the notes.
 */
function describeVideoRequest(payload) {
    const req = describeRequest('video', payload || {});
    if (req.refused) return { provider: PROVIDER, refused: req.refused, notes: [req.refused] };
    const b = req.body;
    const credits = creditsFor('video', buildRequest('video', payload || {}).body, req);
    const usd = Number.isFinite(credits) ? Math.round(credits * appCatalog().SNAPSHOT.credit_usd.usd_per_credit * 100) / 100 : null;
    const roles = (b.medias || []).map(m => m.role);
    const notes = [...(req.notes || [])];
    if (!roles.length) notes.push('No image is attached, so this generates from words alone.');
    if (Number.isFinite(credits)) notes.push(`${credits} Higgsfield credits (≈$${usd.toFixed(2)} on the plan).`);
    return { provider: PROVIDER, mode: b.mode || (roles.includes('start_image') ? 'image-to-video' : roles.length ? 'reference' : 'text-to-video'),
        model: req.model, duration_s: b.duration || req.durationSeconds || null, aspect_ratio: b.aspect_ratio || null, ratio: b.aspect_ratio || null,
        resolution: b.resolution || null, prompt: b.prompt || '', prompt_length: String(b.prompt || '').length,
        has_image: roles.includes('start_image'), estimated_credits: credits, estimated_usd: usd, outbound: b, body: b, notes };
}

/** The tool arguments a creative body travels as (upscale names its one clip; the rest keep `medias`). */
function toolArguments(tool, body) {
    if (tool === 'upscale_video') {
        const { medias, ...rest } = body;
        return { params: { ...rest, video_id: medias && medias[0] && medias[0].value } };
    }
    return { params: body };
}

/* ── uploads, polling, download ─────────────────────────────────────────── */

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'video/mp4': 'mp4', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3' };
const MIME_OF_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

function bytesOf(uri) {
    const m = /^data:([^;,]+);base64,(.+)$/is.exec(uri);
    if (m) return { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64') };
    if (fs.existsSync(uri)) return { mime: MIME_OF_EXT[path.extname(uri).toLowerCase()], bytes: fs.readFileSync(uri) };
    return null;
}

/** Every object anywhere in a tool answer, depth first. */
function* objects(v) {
    if (Array.isArray(v)) for (const x of v) yield* objects(x);
    else if (v && typeof v === 'object') { yield v; for (const x of Object.values(v)) yield* objects(x); }
}

/** media_upload → PUT → media_confirm. Returns the Higgsfield media id for these bytes. */
async function uploadOne(uri, index) {
    const file = bytesOf(uri);
    if (!file || !EXT[file.mime]) return { ok: false, error: `cannot upload ${file ? file.mime : 'a missing file'} to Higgsfield` };
    const filename = `film-engine-${index + 1}.${EXT[file.mime]}`;
    const up = await callTool('media_upload', { filename, content_type: file.mime });
    if (!up.ok) return up;
    const slot = [...objects(up.value)].find(o => o.upload_url);
    const mediaId = slot && (slot.media_id || slot.id);
    if (!slot || !mediaId) return { ok: false, error: 'Higgsfield gave no upload URL' };
    // The presigned PUT carries the headers it was signed with, never the sign-in token.
    const put = await fetch(slot.upload_url, { method: 'PUT', headers: { 'Content-Type': file.mime, ...(slot.upload_headers || slot.headers || {}) }, body: file.bytes }).catch(err => ({ ok: false, status: err.message }));
    if (!put.ok) return { ok: false, error: `the upload URL refused the file (${put.status})` };
    const kind = file.mime.split('/')[0];
    const confirmed = await callTool('media_confirm', { media_id: mediaId, type: kind });
    if (!confirmed.ok) return confirmed;
    return { ok: true, id: String(mediaId) };
}

/** The job ids a generate call answered with. */
function jobIdsOf(value) {
    const ids = [];
    for (const o of objects(value)) {
        const id = o.job_id || (o.id && (o.status || o.type) ? o.id : null);
        if (typeof id === 'string' && UUID_RE.test(id) && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

const WANT_EXT = { image: /\.(png|jpe?g|webp)(\?|$)/i, video: /\.(mp4|mov|webm)(\?|$)/i, post: /\.(mp4|mov|webm)(\?|$)/i, voice: /\.(mp3|wav|ogg|m4a)(\?|$)/i, model3d: /\.(glb|gltf|fbx)(\?|$)/i };
function resultUrl(job, capability) {
    const urls = [];
    for (const o of objects(job)) for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && /^https:\/\//i.test(v) && !/thumb|preview|poster|logo/i.test(k)) urls.push(v);
        if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' && /^https:\/\//i.test(x)) urls.push(x);
    }
    return urls.find(u => WANT_EXT[capability] && WANT_EXT[capability].test(u)) || urls[0] || null;
}

/** Wait for one job with jobs_wait (≤15 s a call) until it ends or the budget runs out. */
async function awaitJob(jobId, capability, deadline, opts) {
    const { emit } = require('../generation-progress');
    let failures = 0;
    while (Date.now() < deadline) {
        const r = await callTool('jobs_wait', { jobs: [{ index: 0, job_id: jobId }], timeout_seconds: Math.max(0, Math.min(15, Math.floor((deadline - Date.now()) / 1000))) });
        if (!r.ok) { if (++failures > 5) return r; await sleep(2000); continue; }
        failures = 0;
        const job = (r.value && Array.isArray(r.value.jobs) && r.value.jobs[0]) || {};
        const status = String(job.status || '').toLowerCase();
        if (TERMINAL_OK.has(status)) {
            const url = resultUrl(job, capability);
            if (!url) return { ok: false, status: 502, error: 'higgsfield: completed with no output URL' };
            let file;
            try { file = await fetch(url); } catch (err) { return { ok: false, status: 502, error: `higgsfield: downloading the result failed — ${err.message}` }; }
            if (!file.ok) return { ok: false, status: 502, error: `higgsfield: the result URL returned ${file.status}` };
            return { ok: true, data: Buffer.from(await file.arrayBuffer()), url };
        }
        if (status === 'nsfw') return { ok: false, status: 422, error: 'higgsfield: refused by content moderation (nsfw) — not charged' };
        if (TERMINAL_BAD.has(status)) return { ok: false, status: 422, error: `higgsfield: generation ${status}${job.error ? ' — ' + job.error : ''}` };
        emit(opts, { phase: status === 'queued' || status === 'pending' ? 'queued' : 'generating' });
        const after = Number(r.value && r.value.poll_after_seconds);
        if (after > 0) await sleep(Math.min(after, 10) * 1000);
    }
    return { ok: false, status: 504, error: 'higgsfield: timed out waiting for the result' };
}

/* ── generate ───────────────────────────────────────────────────────────── */

async function generate(capability, payload, opts) { return require('../final-provider-request').finishGeneration(opts, () => generateApproved(capability, payload, opts)); }
async function generateApproved(capability, payload, opts) {
    if (!TOOLS[capability]) return { ok: false, status: 400, error: `higgsfield: ${capability} is not served by Higgsfield` };
    let req;
    try { req = await require('../final-provider-request').approvedRequest(PROVIDER, capability, opts); }
    catch (err) { return { ok: false, status: err.status || 400, error: err.message }; }
    const tool = String(req.url).split('#')[1];

    /*
     * TEST MODE: the approved request is written down here, where it would leave the machine —
     * before any upload, any sign-in, any network at all.
     */
    const testMode = require('../generation-test-mode');
    if (testMode.appliesTo(PROVIDER)) {
        let reviewed = null;
        try { reviewed = require('../final-request-review').store().get(opts.finalRequest.id); } catch (_) { reviewed = null; }
        const projectId = (opts && opts.jobMeta && opts.jobMeta.project_id) || (reviewed && reviewed.editable && reviewed.editable.provenance && reviewed.editable.provenance.project_id) || null;
        const credits = creditsFor(capability, req.body, req);
        const saved = testMode.writeRequest({ provider: PROVIDER, capability, request: req, snapshot: reviewed && reviewed.snapshot, projectId,
            reviewId: opts.finalRequest.id, credits, usdPerCredit: appCatalog().SNAPSHOT.credit_usd.usd_per_credit,
            wire: { jsonrpc: '2.0', method: 'tools/call', params: { name: tool, arguments: '(the arguments above, each file replaced by its Higgsfield media id)' } } });
        return testMode.result(saved);
    }

    const r = await ready();
    if (!r.ok) return r;

    // Each approved file goes up once; its media id replaces its bytes on the wire.
    const body = req.body;
    if (Array.isArray(body.medias) && body.medias.length) {
        require('../generation-progress').emit(opts, { phase: 'uploading' });
        for (let i = 0; i < body.medias.length; i++) {
            const source = body.medias[i].value;
            const up = await uploadOne(source, i);
            if (!up.ok) return { ok: false, status: 422, error: `higgsfield: reference ${i + 1}: ${up.error}` };
            require('../generation-transport').hosted(req, source, up.id);
            body.medias[i] = { ...body.medias[i], value: up.id };
        }
    }

    const ses = await ready();
    if (!ses.ok) return ses;
    let res, msg;
    try {
        res = await require('../generation-transport').dispatch(req, req.url, {
            method: 'POST', headers: headersFor(ses.token), body: JSON.stringify(body),
        }, { envelope: creative => JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: toolArguments(tool, JSON.parse(creative)) } }) });
        msg = await readMessage(res, 1);
    } catch (err) { return { ok: false, status: 502, error: `higgsfield: ${err.message}` }; }
    if (!res.ok || !msg || msg.error) return { ok: false, status: res.status === 401 ? 401 : 502, error: `higgsfield: ${tool} — ${(msg && msg.error && msg.error.message) || 'HTTP ' + res.status}` };
    const value = toolResult(msg.result);
    if (msg.result && msg.result.isError) return { ok: false, status: 422, error: `higgsfield: ${tool} — ${typeof value === 'string' ? value : JSON.stringify(value).slice(0, 400)}` };
    if (value && value.unlim_choice) return { ok: false, status: 409, error: 'higgsfield: the account asked whether to spend free generations; nothing was submitted' };
    const jobId = jobIdsOf(value)[0];
    if (!jobId) return { ok: false, status: 502, error: `higgsfield: ${tool} answered with no job id` };
    // Written down before polling: an abandoned call can still collect it.
    if (opts && typeof opts.onHandle === 'function') {
        try { opts.onHandle(jobId, { capability, model: req.model }); } catch (_) { /* never blocks a paid call */ }
    }
    require('../generation-progress').emit(opts, { phase: 'queued' });
    const timeout = require('../generation-jobs').budgetFor((opts && opts.timeout) || POLL_TIMEOUT_MS);
    const out = await awaitJob(jobId, capability, Date.now() + timeout, opts);
    if (!out.ok && out.status === 504 && opts && opts.onTimeout) return opts.onTimeout(jobId, timeout);
    if (!out.ok) return out;
    return { ok: true, data: out.data, provider: PROVIDER, provider_model: req.model, provider_job_id: jobId };
}

/** Finish a job from its id, with the same wait. Free: it was already paid for. */
async function collect(handle, opts) {
    const capability = (opts && opts.capability) || 'image';
    const budget = require('../generation-jobs').budgetFor((opts && opts.timeout) || POLL_TIMEOUT_MS);
    return awaitJob(String(handle), capability, Date.now() + budget, opts);
}

/* ── account ────────────────────────────────────────────────────────────── */

/** Credits and plan. Free. */
async function balance() {
    const r = await callTool('balance', {});
    if (!r.ok) return r;
    const v = r.value || {};
    return { ok: true, credits: v.credits ?? null, plan: v.subscription_plan_type || v.plan || null };
}

/** Is the sign-in good? Free: reads the balance. */
async function checkCredential() {
    const b = await balance();
    if (!b.ok) return { ok: false, status: b.status, error: b.error };
    return { ok: true, note: `Signed in to Higgsfield${b.plan ? ` (${b.plan} plan)` : ''}: ${b.credits} credits.` };
}

/** The tool catalogue, recorded after sign-in. */
async function listTools() {
    const r = await ready();
    if (!r.ok) return r;
    const res = await fetch(MCP_URL, { method: 'POST', headers: headersFor(r.token), body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method: 'tools/list', params: {} }) });
    const msg = await readMessage(res, nextId++);
    return msg && msg.result ? { ok: true, tools: msg.result.tools || [] } : { ok: false, error: 'tools/list failed' };
}

/** Forget the session (on disconnect). */
function reset() { session = null; }

/* ── metering ───────────────────────────────────────────────────────────── */

/*
 * THE CREDITS ONE REQUEST COSTS, from Higgsfield's own quotes. The final
 * review shows this before anything is sent, the meter records it as the
 * generation's charge, and Budget reports it in credits beside the dollars.
 * Null where Higgsfield publishes no price before a run (upscale, 3D).
 */
const VOICE_CREDITS_PER_LINE = 0.4;
function creditsFor(capability, body, metadata) {
    const b = body || {}, meta = metadata || {};
    if (capability === 'image') {
        const m = IMAGE_MODELS[b.model];
        if (!m) return null;
        const tier = m.res ? b[m.res.param] : null;
        const c = m.credits[tier] ?? (Object.keys(m.credits).length === 1 && tier === m.res?.default ? Object.values(m.credits)[0] : null);
        return Number.isFinite(c) ? c : null;
    }
    if (capability === 'video') {
        if (Number.isFinite(meta.credits)) return meta.credits;
        const m = appCatalog().MODELS[b.model];
        if (!m) return null;
        const seconds = b.mode === 'video_edit' ? (meta.durationSeconds || 5) : (Number(b.duration) || 5);
        const audio = m.audio && m.audio.param ? b[m.audio.param] === m.audio.on : undefined;
        const price = appCatalog().priceFor(b.model, { duration_s: seconds, resolution: b.resolution, audio });
        return price && Number.isFinite(price.credits) ? price.credits : null;
    }
    if (capability === 'voice') return b.model === 'seed_audio' ? VOICE_CREDITS_PER_LINE : null;
    return null;
}

function meterHiggsfieldMcp(capability, payload, result) {
    let req;
    try { req = buildRequest(capability, { ...payload, model: (result && result.provider_model) || (payload && payload.model) || undefined }); } catch (_) { return null; }
    if (req.refused) return null;
    const credits = creditsFor(capability, req.body, req);
    const charged = Number.isFinite(credits) ? { native_charged: credits } : {};
    if (capability === 'image') return { unit: 'image', quantity: 1, model: req.model, ...charged };
    if (capability === 'video') return { unit: 'second', quantity: Number(req.body.duration) || req.durationSeconds || 5, model: req.model, ...charged };
    return { unit: 'call', quantity: 1, model: req.model, ...charged };
}

const list = table => Object.fromEntries(Object.entries(table).map(([id, m]) => [id, { label: m.label }]));
const videoList = () => Object.fromEntries(Object.entries(appCatalog().MODELS).map(([id, m]) => [id, { label: m.label }]));

const higgsfieldMcpAdapter = {
    id: PROVIDER,
    kind: 'mcp',
    label: 'Higgsfield (signed in, plan credits)',
    account: 'Higgsfield account',
    // Nothing to paste. Always available: the hand-over and test mode need no sign-in, and a real
    // send without one is refused by the call itself with "Connect Higgsfield".
    requiresKey: false,
    available: () => ({ ok: true, signed_in: isConnected() }),
    capabilities: CAPABILITIES,
    supports: capability => CAPABILITIES.includes(capability),
    notServed: {
        sfx: 'Higgsfield’s sound-effect model is for its game pipeline only.',
        ambient: 'Higgsfield’s sound-effect model is for its game pipeline only.',
        lipsync: 'Higgsfield has no lip-sync tool.',
        world: 'Higgsfield has no navigable-world tool.',
    },
    get modelsByCapability() {
        return { image: list(IMAGE_MODELS), video: videoList(), voice: list(VOICE_MODELS), post: list(POST_MODELS), model3d: list(MODEL3D_MODELS) };
    },
    get models() { return { ...list(IMAGE_MODELS), ...videoList(), ...list(VOICE_MODELS), ...list(POST_MODELS), ...list(MODEL3D_MODELS) }; },
    defaultModel: DEFAULT_VIDEO_MODEL,
    defaultImageModel: DEFAULT_IMAGE_MODEL,
    deliverableFrame,
    // What a clip carries beside its keyframe depends on the MODEL (Seedance 2.5 takes thirty pictures,
    // Veo takes the keyframe alone), so the contract is asked per model rather than fixed per adapter.
    referenceContractFor: model => require('../video-reference').contractFor(model || DEFAULT_VIDEO_MODEL),
    // Its post tool upscales one clip; it cannot join a film (lib/conform.js asks).
    stitchesFilm: false,
    // The models that EDIT footage rather than generate it (background replacement reads this).
    videoToVideoModels: EDIT_MODELS,
    editModel: EDIT_MODELS[0],
    /** What editing a clip of this length costs, before anything is sent. */
    quoteEdit({ seconds, resolution } = {}) {
        const price = appCatalog().priceFor(EDIT_MODELS[0], { duration_s: Math.max(1, Math.round(Number(seconds) || 5)), resolution: resolution || '720p', audio: false });
        return { known: !!(price && price.credits !== null), credits: price ? price.credits : null, usd: price ? price.usd : null, unit: 'credits' };
    },
    meter: meterHiggsfieldMcp,
    creditsFor,
    asyncGeneration: true,
    reportsProgress: 'phase',
    // jobs_wait reports; there is no cancel tool, so the honest stop is to stop waiting.
    cancel: 'stop_waiting',

    sizeControl: 'snapped',
    sizeControlReason: 'Higgsfield image models take an aspect ratio and a size tier (1k / 2k / 4k); the pixel size is the tier’s.',
    promptLimit: PROMPT_LIMIT,
    supportsNegativePrompt: false,
    negativePromptReason: 'Higgsfield’s app models take no negative prompt.',
    supportsSeed: false,
    referenceMode: 'condition',
    maxReferenceImages: 8,
    supportsReferenceImages: true,
    supportsReferenceTags: false,
    maxImagePixels: 4096 * 4096,
    maxKeyframes: 2,
    keyframeNote: 'Video models take a start frame and, where the model has one, an end frame.',

    buildRequest,
    buildImageRequest: p => buildRequest('image', p),
    describeRequest,
    describeImageRequest: p => describeRequest('image', p),
    describeVideoRequest,
    generate,
    collect,
    checkCredential,
    balance,
    listTools,
    isConnected,
    reset,
    connection: {
        instructions: 'Sign Film Engine in to your Higgsfield account. Generations spend your plan credits, the same ones the Higgsfield app uses. Your sign-in is kept in the macOS Keychain.',
        helpUrl: 'https://higgsfield.ai',
        oauth: { mcpUrl: MCP_URL, external: true, secureTokens: true },
    },
};

module.exports = { adapter: higgsfieldMcpAdapter, higgsfieldMcpAdapter, creditsFor, IMAGE_MODELS, VOICE_MODELS, POST_MODELS, MODEL3D_MODELS, TOOLS,
    buildRequest, describeRequest, toolArguments, readMessage, jobIdsOf, resultUrl, generate, collect, balance, checkCredential, isConnected, accessToken, MCP_URL };
