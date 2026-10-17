'use strict';
/**
 * WHICH HIGGSFIELD VIDEO MODEL FOR THIS SHOT, AND WHY.
 *
 * Three layers, in the order they can be trusted:
 *   1. HARD RULES from each model's own schema (lib/video-model-facts.js): a
 *      25-second take cannot go to a model that stops at 15, a vertical clip
 *      cannot go to one with no 9:16, an image-only endpoint needs a start
 *      frame. These refuse, and say which limit.
 *   2. FIT from what the prompt asks for (TRAITS) against what each model family
 *      is good and bad at (FAMILY_PROFILES), plus what its facts imply:
 *      dialogue wants generated sound, six references on a model that takes
 *      one means five are not sent. Every number added carries the sentence
 *      that explains it.
 *   3. AN AI JUDGEMENT (routes/production-studio.js) may re-rank the eligible
 *      cards with its own reasons. It sees only what passed layer 1, so it can
 *      never put a refused model back.
 *
 * FAMILY_PROFILES is the editorial part: base quality and per-scenario weights,
 * compiled from the models' documentation, creators' reports and comparison
 * runs (docs/research/video-model-selection.md says what each rests on). Every
 * family in the Higgsfield snapshot must have one, with a weight for every
 * trait; tests/production-studio.test.js fails on a gap.
 *
 * Pure: no database, no network.
 */
const hf = require('./providers/higgsfield');
const CONTRACT = require('./providers/higgsfield-models.json');
const { factsFor, resRank } = require('./video-model-facts');
const { videoChoices } = require('./higgsfield-catalog');

const STRONG_FIT = 75;

const has = (re) => (b) => re.test(b.prompt || '');
/**
 * What a brief can ask for. `good` / `bad` are what a card says when a model's
 * weight for the trait is clearly positive / negative.
 */
const TRAITS = [
    { id: 'dialogue', label: 'Dialogue', good: 'Strong at spoken lines with lip sync', bad: 'Weak lip sync on spoken lines',
        detect: b => !!b.dialogue || /"[^"]{2,}"|“[^”]{2,}”|\b(says|said|speaks|whispers|shouts|asks|replies|line of dialogue|talks? (to|into) (the )?camera)\b/i.test(b.prompt || ''),
        example: { prompt: 'She leans in and says "You came back."', brief: { duration_s: 5, aspect: '16:9', shot_count: 1 } } },
    { id: 'fast_motion', label: 'Fast motion', good: 'Handles fast action and quick camera moves', bad: 'Fast action tends to smear or warp',
        detect: has(/\b(whip[- ]?pan\w*|chas(e|es|ing)|drift\w*|fight\w*|sprint\w*|rac(e|es|ing)|speeding|crash\w*|explod\w*|action|dynamic camera|parkour|stunt\w*|fast)\b/i),
        example: { prompt: 'A car drifts around a corner, whip pan to follow.', brief: { duration_s: 8, aspect: '16:9', shot_count: 1 } } },
    { id: 'multi_shot', label: 'Several shots', good: 'Keeps characters consistent across cuts in one clip', bad: 'Cuts inside one clip lose continuity',
        detect: b => (b.shot_count || 1) > 1 || /\b(cut to|cuts? between|multi[- ]?shot|three shots|two shots|shot \d)\b/i.test(b.prompt || ''),
        example: { prompt: 'Wide of the room, cut to a close-up of her face.', brief: { duration_s: 10, aspect: '16:9', shot_count: 2 } } },
    { id: 'long_take', label: 'Long take', good: 'Holds a long continuous take', bad: 'Long takes drift or loop',
        detect: b => Number(b.duration_s) > 15,
        example: { prompt: 'One continuous take through the house.', brief: { duration_s: 20, aspect: '16:9', shot_count: 1 } } },
    { id: 'text_on_screen', label: 'Legible text', good: 'Renders legible text and logos', bad: 'Text and logos come out garbled',
        detect: has(/\b(logo|legible|engraved|signage|sign (that )?reads|title card|lettering|headline|written|text on)\b/i),
        example: { prompt: 'A bottle with the brand name engraved and legible.', brief: { duration_s: 6, aspect: '1:1', shot_count: 1 } } },
    { id: 'stylized', label: 'Stylized', good: 'Strong at anime and stylized looks', bad: 'Leans photoreal; stylized looks drift',
        detect: has(/\b(anime|cartoon|pixar|claymation|stop[- ]motion|cel[- ]shaded|watercolou?r|comic|manga|stylized|2d animation|3d animation)\b/i),
        example: { prompt: 'Anime-style sword fight on a rooftop.', brief: { duration_s: 6, aspect: '16:9', shot_count: 1 } } },
    { id: 'physics', label: 'Physics', good: 'Believable physics: liquid, cloth, impacts', bad: 'Physics (liquid, impacts) often breaks',
        detect: has(/\b(water|splash\w*|liquid|pour\w*|shatter\w*|smoke|fire|flames|explo\w+|cloth|fabric|waves|collid\w+|collision|impact\w*|debris|rain\w*)\b/i),
        example: { prompt: 'A wine glass shatters on stone, wine splashing.', brief: { duration_s: 5, aspect: '16:9', shot_count: 1 } } },
    { id: 'human_closeup', label: 'Faces up close', good: 'Natural faces and skin up close', bad: 'Faces up close look plastic',
        detect: has(/\b(close[- ]?up|extreme close|portrait|her face|his face|their face|skin|eyes)\b/i),
        example: { prompt: 'Close-up of her face as she smiles.', brief: { duration_s: 5, aspect: '16:9', shot_count: 1 } } },
    { id: 'crowd', label: 'Crowds', good: 'Keeps crowds coherent', bad: 'Crowds melt together',
        detect: has(/\b(crowd(ed|s)?|stadium|festival|busy street|hundreds of|protest|audience)\b/i),
        example: { prompt: 'A crowded stadium cheers as the goal goes in.', brief: { duration_s: 6, aspect: '16:9', shot_count: 1 } } },
    { id: 'vertical_social', label: 'Vertical / UGC', good: 'Good at vertical, talk-to-camera social clips', bad: 'Vertical talk-to-camera clips look staged',
        detect: b => b.aspect === '9:16' || /\b(selfie|ugc|tiktok|reels?|talking (excitedly |directly )?to (the )?camera|vlog)\b/i.test(b.prompt || ''),
        example: { prompt: 'Selfie video, he talks to camera about his day.', brief: { duration_s: 10, aspect: '9:16', shot_count: 1 } } },
    { id: 'establishing', label: 'Establishing / aerial', good: 'Rich, stable establishing and aerial shots', bad: 'Wide landscapes lose detail',
        detect: has(/\b(aerial|drone|establishing|landscape|vista|skyline|bird'?s[- ]eye)\b/i),
        example: { prompt: 'Aerial establishing shot over a city at dusk.', brief: { duration_s: 8, aspect: '16:9', shot_count: 1 } } },
    { id: 'product', label: 'Product shot', good: 'Clean, controlled product shots', bad: 'Products deform between frames',
        detect: has(/\b(product shot|packshot|bottle|packaging|commercial|on (black |white )?marble|turntable|perfume|sneaker)\b/i),
        example: { prompt: 'Product shot of a perfume bottle on black marble.', brief: { duration_s: 6, aspect: '1:1', shot_count: 1 } } },
    { id: 'character_refs', label: 'Character references', good: 'Holds identity from reference images', bad: 'Identity drifts from the references',
        detect: b => (b.reference_count || 0) >= 2 || /@image\d/.test(b.prompt || ''),
        example: { prompt: '@image1 walks toward @image2.', brief: { duration_s: 6, aspect: '16:9', shot_count: 1, reference_count: 2 } } },
    { id: 'camera_control', label: 'Directed camera', good: 'Follows written camera moves closely', bad: 'Ignores precise camera directions',
        detect: has(/\b(dolly|crane|orbit(s|ing)?|push(es)? in|pull(s)? (back|out)|tracking shot|rack focus|handheld|steadicam|tilt (up|down)|pan (left|right))\b/i),
        example: { prompt: 'Slow dolly push in on the door.', brief: { duration_s: 5, aspect: '16:9', shot_count: 1 } } },
];

/**
 * Per family: `base` (general quality, 0–100) and a weight per trait (−15…+15).
 * `note` is the one line a card shows when nothing more specific applies.
 */
const P = (base, note, w) => ({ base, note, traits: Object.fromEntries(TRAITS.map(t => [t.id, w[t.id] || 0])) });
const FAMILY_PROFILES = {
    // Bases follow the blind-vote arena (Artificial Analysis, Sept 2026): Wan 3.0, Seedance 2.5 and MiniMax H3
    // tied at the top, Seedance 2.0 just behind, Kling 3.0 / Omni clearly lower on overall quality.
    'seedance-2-5': P(85, 'Reference-led and long (to 30s); costs the most and queues longest',
        { dialogue: 6, fast_motion: 4, multi_shot: 8, long_take: 12, text_on_screen: 3, stylized: 3, physics: -8, human_closeup: 6, crowd: 3, vertical_social: 3, establishing: 6, product: -2, character_refs: 8, camera_control: 6 }),
    'seedance-2': P(83, 'Best single-speaker dialogue; strong references and liquids, to 15s',
        { dialogue: 10, fast_motion: 4, multi_shot: 6, long_take: 0, text_on_screen: 6, stylized: 3, physics: 7, human_closeup: 6, crowd: 2, vertical_social: 4, establishing: 4, product: 3, character_refs: 8, camera_control: 5 }),
    'kling-3': P(78, 'Strong motion and faces, up to six labelled shots; garbles on-screen text',
        { dialogue: 6, fast_motion: 10, multi_shot: 12, long_take: -4, text_on_screen: -14, stylized: 2, physics: -8, human_closeup: 8, crowd: 4, vertical_social: 6, establishing: 3, product: 2, character_refs: -6, camera_control: 7 }),
    'kling-o3': P(78, 'Holds a face from references best, with multi-shot and sound',
        { dialogue: 5, fast_motion: 8, multi_shot: 12, long_take: -4, text_on_screen: -14, stylized: 2, physics: -6, human_closeup: 8, crowd: 3, vertical_social: 4, establishing: 3, product: 2, character_refs: 12, camera_control: 5 }),
    'kling-omni': P(75, 'Reference-led Kling (O1) without a required start frame; no sound',
        { dialogue: -6, fast_motion: 7, multi_shot: 6, long_take: -6, text_on_screen: -14, stylized: 2, physics: -6, human_closeup: 6, crowd: 2, vertical_social: 3, establishing: 3, product: 2, character_refs: 12, camera_control: 4 }),
    'kling-2-6': P(72, 'Previous Kling, cheaper, solid motion',
        { dialogue: 2, fast_motion: 8, multi_shot: -6, long_take: -8, text_on_screen: -14, stylized: 1, physics: -4, human_closeup: 6, crowd: 2, vertical_social: 4, establishing: 2, product: 1, character_refs: -8, camera_control: 4 }),
    'kling-2-5-turbo': P(66, 'Cheapest motion drafts',
        { dialogue: -6, fast_motion: 6, multi_shot: -8, long_take: -8, text_on_screen: -14, stylized: 0, physics: -4, human_closeup: 3, crowd: 0, vertical_social: 2, establishing: 1, product: 1, character_refs: -8, camera_control: 2 }),
    'minimax-h3': P(85, 'Top-tier quality at a low price, 2K; spells text; no generated sound',
        { dialogue: -8, fast_motion: 6, multi_shot: -4, long_take: 0, text_on_screen: 6, stylized: 12, physics: 8, human_closeup: 6, crowd: 4, vertical_social: 2, establishing: 7, product: 7, character_refs: 7, camera_control: 5 }),
    'hailuo-2-3': P(70, 'Cheap and good with motion; spells text; no sound, fails liquids',
        { dialogue: -10, fast_motion: 7, multi_shot: -8, long_take: -8, text_on_screen: 5, stylized: 4, physics: -6, human_closeup: 3, crowd: 1, vertical_social: 2, establishing: 2, product: 3, character_refs: -8, camera_control: 4 }),
    'wan-3': P(85, 'Top arena score: long takes, liquids, references and sound; may insert cuts',
        { dialogue: 4, fast_motion: 3, multi_shot: -2, long_take: 9, text_on_screen: 2, stylized: 5, physics: 8, human_closeup: 4, crowd: 3, vertical_social: 3, establishing: 7, product: 4, character_refs: 7, camera_control: 4 }),
    'wan-3-prime': P(86, 'Wan 3.0 at its higher quality setting',
        { dialogue: 4, fast_motion: 4, multi_shot: -2, long_take: 9, text_on_screen: 3, stylized: 5, physics: 8, human_closeup: 5, crowd: 3, vertical_social: 3, establishing: 8, product: 4, character_refs: 7, camera_control: 4 }),
    'wan-2-7': P(70, 'Older Wan with references, budget option; fails liquids',
        { dialogue: -6, fast_motion: 1, multi_shot: 0, long_take: -4, text_on_screen: 0, stylized: 4, physics: -6, human_closeup: 1, crowd: 1, vertical_social: 2, establishing: 3, product: 2, character_refs: 4, camera_control: 2 }),
    'wan-2-6': P(66, 'Older Wan with multi-shot, budget option',
        { dialogue: -6, fast_motion: 0, multi_shot: 3, long_take: -2, text_on_screen: -2, stylized: 4, physics: 1, human_closeup: 0, crowd: 0, vertical_social: 1, establishing: 2, product: 1, character_refs: -6, camera_control: 1 }),
    'happy-horse-1-1': P(70, 'Alibaba model with references; almost no independent track record',
        { dialogue: -6, fast_motion: 3, multi_shot: 0, long_take: -2, text_on_screen: 1, stylized: 3, physics: 2, human_closeup: 3, crowd: 2, vertical_social: 3, establishing: 3, product: 3, character_refs: 4, camera_control: 2 }),
    'happy-horse-1': P(67, 'Earlier Happy Horse; prefer 1.1',
        { dialogue: -6, fast_motion: 2, multi_shot: 0, long_take: -2, text_on_screen: 0, stylized: 3, physics: 1, human_closeup: 2, crowd: 1, vertical_social: 3, establishing: 2, product: 2, character_refs: 3, camera_control: 1 }),
    'cinema-studio-4': P(79, 'Higgsfield\'s cinematic studio: lens, camera and grade as settings; 720p max',
        { dialogue: 4, fast_motion: 3, multi_shot: 2, long_take: 6, text_on_screen: 1, stylized: 0, physics: 3, human_closeup: 5, crowd: 3, vertical_social: -4, establishing: 7, product: 5, character_refs: 8, camera_control: 12 }),
    'ltx-2-5': P(66, 'Fast and cheap drafts, with audio and camera presets',
        { dialogue: 0, fast_motion: 2, multi_shot: -6, long_take: -6, text_on_screen: 0, stylized: 3, physics: 1, human_closeup: 1, crowd: 0, vertical_social: 4, establishing: 3, product: 3, character_refs: -8, camera_control: 6 }),
    'pixverse-v6': P(70, 'Punchy social clips and effects, with sound',
        { dialogue: 2, fast_motion: 5, multi_shot: -6, long_take: -4, text_on_screen: 0, stylized: 4, physics: 2, human_closeup: 2, crowd: 1, vertical_social: 8, establishing: 1, product: 3, character_refs: -8, camera_control: 3 }),
    'grok-video-1-5': P(68, 'Quick reference-led clips; burns spoken lines in as captions',
        { dialogue: -10, fast_motion: 3, multi_shot: -4, long_take: -4, text_on_screen: -4, stylized: 6, physics: 1, human_closeup: 1, crowd: 0, vertical_social: 5, establishing: 1, product: 1, character_refs: 3, camera_control: 1 }),
};

/** Trait ids the brief asks for, in TRAITS order. */
function detectTraits(brief) {
    const b = brief || {};
    return TRAITS.filter(t => t.detect(b)).map(t => t.id);
}

/** Does this endpoint need pictures before it can run? Read off its schema. */
function requiredOf(endpoint) { return ((CONTRACT.models[endpoint] || {}).schema || {}).required || []; }

/**
 * Points to a fit percentage on a curve, not a clamp: a sequence that asks for
 * five things a strong model is good at must not tie it with three others at
 * 100%. 76 points (a decent model, nothing special asked) reads 50%; each 9
 * points either way moves it along the curve; it never quite reaches 100.
 */
const fitOf = raw => Math.max(1, Math.min(99, Math.round(100 / (1 + Math.exp(-(raw - 76) / 9)))));

const TIER_ADJUST = { turbo: -4, fast: -4, standard: -3, std: -3, pro: 0, '4k': 2 };

function billedSeconds(f, d) {
    if (f.duration.values) return f.duration.values.find(v => v >= d) || f.duration.max;
    return Math.max(f.duration.min, Math.min(d, f.duration.max));
}

/** Rank every Higgsfield video model for one brief. Pure. */
function recommend(brief) {
    const b = { aspect: '16:9', shot_count: 1, reference_count: 0, has_start_frame: false, ...(brief || {}) };
    const d = Math.max(1, Math.round(Number(b.duration_s) || 5));
    const traits = detectTraits(b);
    const cards = [], blocked = [];
    for (const model of videoChoices()) {
        const id = model.id, f = factsFor(id);
        const label = f.label;
        // ── 1. hard rules ──────────────────────────────────────────────
        let why = null;
        const refsOrFrame = b.has_start_frame || b.reference_count > 0;
        if (!f.duration) why = 'Specialized video tool: requires its own source media and settings on Higgsfield';
        else if (model.external && f.required_parameters?.length) why = `Requires ${f.required_parameters.join(', ')} on Higgsfield`;
        else if (model.external && f.requires_media && !refsOrFrame) why = 'Needs reference media on Higgsfield; this request has none';
        else if (d > f.duration.max) why = `Up to ${f.duration.max}s; this request is ${d}s`;
        else if (b.aspect && !f.aspects.includes(b.aspect)) why = `No ${b.aspect}: makes ${f.aspects.join(', ')}`;
        else if (!model.external && !model.endpoints.text && !model.endpoints.reference && !b.has_start_frame) why = 'Needs a start frame (an approved keyframe); this request has none';
        else if (!model.external && !model.endpoints.text && model.endpoints.reference && !refsOrFrame && requiredOf(model.endpoints.reference).some(r => /image/.test(r))) why = 'Needs at least one reference image; this request has none';
        if (why) { blocked.push({ id, label, why }); continue; }
        // ── 2. fit ──────────────────────────────────────────────────────
        const prof = FAMILY_PROFILES[f.family] || P(60, f.description || 'Additional model without a comparative quality profile', {});
        const parts = [];   // [points, sentence]
        // Several asks are scaled together (by √n): six things a model is good at is a stronger case than one,
        // not six times stronger, and summing them flatly pins every capable model at the ceiling.
        const scale = 1 / Math.sqrt(Math.max(1, traits.length));
        for (const t of traits) {
            const w = (prof.traits[t] || 0) * scale, def = TRAITS.find(x => x.id === t);
            const said = prof.traits[t] || 0;
            if (said >= 6) parts.push([w, def.good]);
            else if (said <= -6) parts.push([w, def.bad]);
            else if (w) parts.push([w, null]);
        }
        if (traits.includes('dialogue')) parts.push(f.native_audio ? [4, 'Generates synced sound for the line'] : [-18, 'No generated sound: the dialogue needs a separate voice pass']);
        const refs = Number(b.reference_count) || 0;
        const dropped = f.max_images===null?0:Math.max(0, refs - f.max_images);
        if (dropped) parts.push([-Math.min(15, 3 * dropped), f.max_images ? `Takes ${f.max_images} reference image${f.max_images === 1 ? '' : 's'}; ${dropped} of yours would not be sent` : `Takes no reference images; ${dropped} would not be sent`]);
        else if (refs && f.max_images===null) parts.push([0,'Reference limit is not published; confirm the attachments on Higgsfield']);
        else if (refs >= 2) parts.push([3, `Uses all ${refs} of your reference images`]);
        if (b.shot_count > 1) parts.push(f.multi_shot ? [5, 'Cuts between shots inside one generation'] : f.max_images >= 3 ? [0, null] : [-6, 'No multi-shot: one clip per shot will hold up better']);
        if (b.resolution && f.resolutions.length && resRank(b.resolution) > resRank(f.resolutions[f.resolutions.length - 1])) parts.push([-8, `Tops out at ${f.resolutions[f.resolutions.length - 1]}`]);
        if (b.has_start_frame && !f.start_frame) parts.push([-3, f.max_images ? 'Takes no first frame: the keyframe goes as a reference picture' : 'Takes no first frame or pictures: the keyframe is not sent']);
        const billed = billedSeconds(f, d);
        if (billed > d) parts.push([-2, `Renders ${billed}s; trim to ${d}s in the edit`]);
        parts.push([TIER_ADJUST[f.tier] || 0, null]);
        const raw = prof.base + parts.reduce((a, [p]) => a + p, 0);
        const preference = selectorPreference(f.family, b, traits);
        const fit = preference ? preference.score * 10 : Math.min(60, fitOf(raw));
        const reasons = parts.filter(([, s]) => s).sort((x, y) => Math.abs(y[0]) - Math.abs(x[0])).map(([, s]) => s);
        if (!reasons.length) reasons.push(prof.note);
        if (preference) reasons.unshift(preference.reason);
        const cost = require('./higgsfield-cost').quoteVideo(model, b, billed);
        cards.push({ id, label, family: f.family, fit, reasons: reasons.slice(0, 4),
            noAdvantage:preference ? !!preference.noAdvantage : true,
            selector:!!preference, external:!!model.external, url:model.url || null, cost,
            facts: { duration: f.duration, resolutions: f.resolutions, max_images: f.max_images, native_audio: f.native_audio, multi_shot: f.multi_shot },
            billed_seconds: billed, est_usd: cost.usd, price_exact: cost.exact,
            dropped_refs: dropped, top: false, budget: false });
    }
    return finish({ brief: { ...b, duration_s: d }, traits, cards, blocked, judged: false });
}

/** Sort, and mark the top pick and the budget pick. */
function finish(out) {
    out.cards.sort((a, b) => Number(a.noAdvantage)-Number(b.noAdvantage) || b.fit - a.fit || (a.est_usd ?? Infinity) - (b.est_usd ?? Infinity));
    out.cards.forEach((c, i) => { c.top = i === 0; c.budget = false; });
    const best = Math.max(...out.cards.filter(c=>!c.noAdvantage).map(c=>c.fit));
    const strong = out.cards.filter(c=>!c.noAdvantage && c.fit >= Math.max(70,best-20) && Number.isFinite(c.cost?.credits) && c.cost.credits > 0);
    for (const c of strong.slice().sort((a,b)=>a.cost.credits-b.cost.credits)) {
        const others = strong.filter(o=>o!==c && o.billed_seconds===c.billed_seconds);
        if (others.length && c.cost.credits <= .75*Math.min(...others.map(o=>o.cost.credits))) {c.budget=true;break;}
    }
    recommendationShares(out.cards);
    return out;
}

// Inferred from 20 observed evaluations, including 12 fresh runs. This follows Jev's choices;
// it does not represent independent model quality measurements or copy his private classifier.
function selectorPreference(family, brief, traits) {
    const anime = /\b(anime|manga|cartoon|hand[- ]drawn|cel[- ]shaded|2d animation)\b/i.test(brief.prompt||'');
    const realistic = /\b(photo[- ]?realistic|realistic|photoreal)\b/i.test(brief.prompt||'');
    const heavy = traits.includes('dialogue') && /\b(talking|talks|monologue|speech|explains)\b/i.test(brief.prompt||'');
    const profiles = {
        'seedance-2-5': [anime?9:10, false, anime?'Strong alternative for drawn animation':'Jev-style default quality choice for this scene'],
        'seedance-2': [anime?7:9,false,'Closest Seedance alternative to the preferred quality choice'],
        'wan-3': [anime?7:8, realistic||heavy, realistic||heavy?'Lower priority for realism or sustained dialogue in the observed selector':'Strong lower-cost alternative for cinematic movement'],
        'kling-o3': [anime?5:7,false,'Reference-led continuity and multi-shot alternative'],
        'minimax-h3': [anime?10:6,!anime,anime?'Preferred specialist for drawn 2D character animation':'No observed advantage over Seedance for this scene'],
        'website:flux_3_video': [7,!traits.includes('dialogue')&&!traits.includes('establishing'),traits.includes('dialogue')?'Strong voice-acting alternative for delivery and emotion':'Alternative for supporting shots and simple movement'],
        'website:gemini_omni_flash_1_1': [6,true,'No observed advantage over the stronger choices for this scene'],
    };
    const p=profiles[family]; return p && {score:p[0],noAdvantage:p[1],reason:p[2]};
}

// Same adaptive exponent and largest-remainder rounding observed in the public selector UI.
// Extra catalog entries remain visible, but do not dilute the reference model comparison.
function recommendationShares(cards) {
    cards.forEach(c=>{c.share=0;});
    const compared=cards.filter(c=>c.selector), active=compared.filter(c=>!c.noAdvantage), others=compared.filter(c=>c.noAdvantage);
    if (!active.length) active.push(...cards.slice(0,1));
    const scores=active.map(c=>c.fit/10).sort((a,b)=>b-a);
    const exponent=1+Math.min(3,scores.length>1?scores[0]-scores[1]:0);
    const total=active.reduce((n,c)=>n+Math.pow(c.fit/10,exponent),0);
    const available=100-others.length;
    const shares=active.map((c,i)=>{const exact=total?Math.pow(c.fit/10,exponent)/total*available:available/active.length;return {c,i,value:Math.floor(exact),remainder:exact-Math.floor(exact)};});
    let left=available-shares.reduce((n,x)=>n+x.value,0);
    for(const x of shares.slice().sort((a,b)=>b.remainder-a.remainder||a.i-b.i)) if(left-->0) x.value++;
    shares.forEach(x=>{x.c.share=x.value;}); others.forEach(c=>{c.share=1;});
}

/**
 * Fold an AI judgement into a rules result. Only eligible cards can be judged:
 * an id that was refused, or not in the list, is ignored.
 */
function mergeJudgement(base, judgements) {
    const out = { ...base, cards: base.cards.map(c => ({ ...c, reasons: [...c.reasons] })), judged: true };
    for (const j of judgements || []) {
        const card = out.cards.find(c => c.id === j.id);
        if (!card || !Number.isFinite(Number(j.fit))) continue;
        card.rule_fit = card.fit;
        card.fit = Math.max(0, Math.min(100, Math.round(Number(j.fit))));
        if (j.reason && String(j.reason).trim()) card.reasons = [String(j.reason).trim(), ...card.reasons].slice(0, 4);
        card.ai = true;
        card.noAdvantage = false;
    }
    return finish(out);
}

module.exports = { TRAITS, FAMILY_PROFILES, STRONG_FIT, detectTraits, recommend, mergeJudgement };
