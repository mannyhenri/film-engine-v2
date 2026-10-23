'use strict';
/**
 * THE CHARACTER SHEET, the director's way: one MAIN picture per character, used for every generation.
 *
 * The main is a finished three-panel character sheet (headless front, back, face close-up), made by the director in an
 * image generator from two prompts written here by ChatGPT:
 *   1. the main picture prompt: a mid-gray studio, medium-shot face lock, from the character's description and the
 *      stored guide prompt-guides/character-main-picture.md;
 *   2. the character sheet prompt: from that studio picture (uploaded) and prompt-guides/character-sheet.md.
 * The finished sheet is uploaded; the first becomes the main, later ones (other wardrobe, other passes) are variations,
 * and any of them can be made the main. The main is one flag, metadata.main_sheet, on one of the character's pictures;
 * every selector that picks a character's picture for generation puts it first (mainFirstSql) and so sends it alone.
 * Nothing is demoted: the older views stay as they were, and choosing one of them as main works the same way.
 */
const fs = require('fs');
const path = require('path');
const { db, generateId } = require('../db/database');
const { saveFile } = require('./file-storage');
const { loadGallery } = require('./subject-gallery');

const GUIDES = path.join(__dirname, '..', 'prompt-guides');
const MAIN_GUIDE = path.join(GUIDES, 'character-main-picture.md');
const SHEET_GUIDE = path.join(GUIDES, 'character-sheet.md');

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function parse(s, d) { try { const v = typeof s === 'string' ? JSON.parse(s) : s; return v ?? d; } catch (_) { return d; } }

/** SQL: the main sheet sorts before everything else (use first in an ORDER BY over a character's pictures). */
function mainFirstSql(alias = '') {
    const m = alias ? `${alias}.metadata` : 'metadata';
    return `(CASE WHEN json_valid(${m}) AND json_extract(${m}, '$.main_sheet') = 1 THEN 0 ELSE 1 END)`;
}
const isMain = row => !!parse(row && row.metadata, {}).main_sheet;

function characterOf(id) {
    const c = db.prepare('SELECT * FROM film_characters WHERE id = ?').get(id);
    if (!c) fail(404, 'no such character');
    return c;
}

/** The sheet as the page draws it: the main, the variations (finished sheets and pictures), the studio portraits. */
function sheetOf(characterId) {
    const c = characterOf(characterId);
    const items = loadGallery(db, 'character', characterId).filter(r => r.project_id === c.project_id && r.role !== 'expression');
    const view = r => ({ asset_id: r.id, file_name: r.file_name, image_url: r.image_url, created_at: r.created_at,
        main: isMain(r), kind: r.metadata.sheet_variation ? 'sheet' : r.metadata.medium_shot ? 'studio portrait' : r.view ? `${r.view} view` : 'picture',
        sendable: r.sendable });
    const main = items.find(isMain) || null;
    return {
        character: { id: c.id, name: c.name, description: c.description || '', appearance_prompt: c.appearance_prompt || '',
            age_range: c.age_range || '', gender: c.gender || '', personality_notes: c.personality_notes || '' },
        main: main ? view(main) : null,
        // The finished sheets first, then every other picture the character has that could take the stage.
        variations: items.filter(r => !isMain(r) && r.role !== 'inspiration' && !r.metadata.medium_shot)
            .sort((a, b) => (b.metadata.sheet_variation ? 1 : 0) - (a.metadata.sheet_variation ? 1 : 0) || String(b.created_at).localeCompare(String(a.created_at))).map(view),
        studio_portraits: items.filter(r => r.metadata.medium_shot).map(view),
        prompts: promptsOf(characterId),
    };
}

/** Make one of the character's pictures the main: the only one generation sends. */
function setMain(characterId, assetId) {
    const c = characterOf(characterId);
    const row = db.prepare("SELECT * FROM film_assets WHERE id = ? AND character_id = ? AND asset_type IN ('character_sheet', 'reference_image')").get(assetId, characterId);
    if (!row) fail(404, 'that picture is not one of this character\'s');
    const meta = parse(row.metadata, {});
    if (meta.reference_role === 'expression') fail(400, 'an expression study cannot be the main picture');
    db.transaction(() => {
        for (const r of db.prepare("SELECT id, metadata FROM film_assets WHERE character_id = ? AND json_valid(metadata) AND json_extract(metadata, '$.main_sheet') = 1").all(characterId)) {
            const m = parse(r.metadata, {}); delete m.main_sheet;
            db.prepare('UPDATE film_assets SET metadata = ? WHERE id = ?').run(JSON.stringify(m), r.id);
        }
        // The main is sent, so it is a reference plate whatever it was filed as (a concept, an older superseded view).
        db.prepare('UPDATE film_assets SET metadata = ? WHERE id = ?').run(JSON.stringify({ ...meta, main_sheet: true, plate_role: 'reference' }), assetId);
    })();
    return sheetOf(characterId);
}

function saveImage(c, data, name, metadata, assetType) {
    const { bytesFrom } = require('./media-imports');
    const { mime, bytes } = bytesFrom({ data });
    if (!/^image\/(png|jpe?g|webp)$/.test(mime)) fail(400, 'a PNG, JPEG or WebP picture is needed');
    const id = generateId();
    const stem = `${String(c.name || 'character').replace(/[^a-zA-Z0-9_-]/g, '_')}_${metadata.medium_shot ? 'studio' : 'sheet'}_${id.slice(0, 8)}`;
    const fileName = `${stem}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
    const filePath = saveFile(c.project_id, 'refsheets', fileName, bytes);
    db.prepare(`INSERT INTO film_assets (id, project_id, character_id, asset_type, file_path, file_name, format, mime_type, size_bytes, version, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(id, c.project_id, c.id, assetType, filePath, fileName, fileName.split('.').pop(), mime, bytes.length,
        JSON.stringify({ ...metadata, source: 'upload', original_name: name ? String(name).slice(0, 200) : null }));
    return { id, filePath };
}

/** A finished character sheet: the main if the character has none yet, else a variation (click it to make it main). */
function uploadSheet(characterId, { data, name } = {}) {
    const c = characterOf(characterId);
    const had = db.prepare("SELECT 1 FROM film_assets WHERE character_id = ? AND json_valid(metadata) AND json_extract(metadata, '$.main_sheet') = 1").get(characterId);
    const { id } = saveImage(c, data, name, { sheet_variation: true, plate_role: had ? 'concept' : 'reference', ref_category: 'costume' }, 'character_sheet');
    if (!had) return setMain(characterId, id);
    return sheetOf(characterId);
}

/*
 * The description the prompts start from: EVERY field of the character that describes them, as edited on the sheet.
 * It read five and missed the rest: a height (JUNE's 1.68 m), and build, hair, distinguishing features and ethnicity
 * when a character has them. A placeholder the screenplay import writes ("Detected from screenplay (37 mentions)") is
 * not a description and is left out.
 */
const PLACEHOLDER = /^detected from screenplay\b/i;
function descriptionOf(c) {
    const f = (label, v) => { const t = String(v == null ? '' : v).trim(); return t && !PLACEHOLDER.test(t) ? `${label}: ${t}` : null; };
    const height = Number(c.height_m) > 0 ? `${Number(c.height_m).toFixed(2)} m (${Math.floor(c.height_m * 39.37 / 12)}'${Math.round(c.height_m * 39.37 % 12)}")` : '';
    return [f('Appearance', c.appearance_prompt), f('Description', c.description), f('Age', c.age_range), f('Gender', c.gender),
        f('Ethnicity', c.ethnicity), f('Height', height), f('Build', c.build), f('Hair', c.hair), f('Distinguishing features', c.distinguishing),
        f('Personality (for the default expression only)', c.personality_notes)].filter(Boolean).join('\n');
}

function cleanPrompt(text) {
    // One copy-ready block: no fence, no heading, no lead-in line the guide forbids.
    return String(text || '').replace(/^```[a-z]*\n?|```$/gim, '').replace(/^\s*(here(?:'s| is)[^\n]*:)\s*\n/i, '').trim();
}

/** Step 1: the main (studio, medium shot) picture prompt, from the description and the stored guide. */
async function mainPicturePrompt(characterId, { ask = require('./codex-astra').ask } = {}) {
    const c = characterOf(characterId);
    const desc = descriptionOf(c);
    if (!desc.trim()) fail(400, 'this character has no description yet: write one on the sheet first');
    const guide = fs.readFileSync(MAIN_GUIDE, 'utf8');
    const q = [guide, '',
        'THIS REQUEST: the character below is already locked and approved, so skip the confirmation bullets (rule 7) and deliver the final face-lock prompt now.',
        'Frame it as a medium shot (waist-up) studio photograph that will be the master picture of this character. Follow every rule above.',
        'Output ONLY the prompt, as one continuous block. No introduction, no notes, no bullets, no heading.',
        '', `CHARACTER: ${c.name}`, desc].join('\n');
    const r = await ask({ prompt: q, images: [] });
    return { prompt: cleanPrompt(r.text), model: r.model, guide: path.basename(MAIN_GUIDE) };
}

/** Step 2: the character sheet prompt, from the studio picture (uploaded now, or one uploaded before) and the guide. */
async function sheetPrompt(characterId, { data, name, asset_id } = {}, { ask = require('./codex-astra').ask } = {}) {
    const c = characterOf(characterId);
    let file, portraitId = asset_id || null;
    if (data) { const saved = saveImage(c, data, name, { medium_shot: true, plate_role: 'concept', ref_category: 'face' }, 'reference_image'); file = saved.filePath; portraitId = saved.id; }
    else if (asset_id) {
        const row = db.prepare('SELECT file_path FROM film_assets WHERE id = ? AND character_id = ?').get(asset_id, characterId);
        if (!row) fail(404, 'that picture is not one of this character\'s');
        file = row.file_path;
    } else fail(400, 'the medium shot studio picture is needed: upload it first');
    if (!file || !fs.existsSync(file)) fail(404, 'the studio picture is missing on disk');
    const guide = fs.readFileSync(SHEET_GUIDE, 'utf8');
    const desc = descriptionOf(c);
    const q = [guide, '',
        `THE ATTACHED IMAGE is the identity reference: the approved studio picture of ${c.name}. Use it for identity: face, hair, skin, build.`,
        // The studio picture is a face lock in a plain black camisole (step 1's guide), so the costume comes from the notes.
        'WARDROBE: the picture shows a plain studio top, NOT the costume. Take the wardrobe from the WARDROBE (or costume) part of my notes below and describe it in full in the Wardrobe paragraph and in every panel. Only if my notes give no wardrobe, describe what the picture shows.',
        desc ? `MY WRITTEN NOTES about the character (they override the image where they differ):\n${desc}` : '',
        'Output ONLY the finished prompt, as the template\'s plain paragraphs.'].filter(Boolean).join('\n');
    const r = await ask({ prompt: q, images: [file] });
    return { prompt: cleanPrompt(r.text), model: r.model, guide: path.basename(SHEET_GUIDE), studio_portrait_id: portraitId };
}

/*
 * The prompts as jobs (film_character_sheet_prompts): started here, written in the background, kept per character.
 * The sheet reads them from GET …/sheet, so a prompt shows wherever the director is when ChatGPT finishes.
 */
let interruptedSwept = false;
function promptsOf(characterId) {
    if (!interruptedSwept) {   // one running when the app stopped will never finish: say so rather than spin forever
        interruptedSwept = true;
        db.prepare("UPDATE film_character_sheet_prompts SET status = 'interrupted', error = 'Film Engine restarted while ChatGPT was writing it', finished_at = datetime('now') WHERE status = 'writing'").run();
    }
    const out = {};
    for (const r of db.prepare('SELECT * FROM film_character_sheet_prompts WHERE character_id = ?').all(characterId)) {
        out[r.kind] = { status: r.status, prompt: r.prompt || '', model: r.model || null, error: r.error || null, started_at: r.started_at, finished_at: r.finished_at,
            studio_portrait_id: r.studio_portrait_id || null };
    }
    return out;
}
const running = new Set();
function startPrompt(characterId, kind, body = {}, opts = {}) {
    characterOf(characterId);
    if (!['main', 'sheet'].includes(kind)) fail(404, 'no such prompt');
    if (running.has(`${characterId}:${kind}`)) fail(409, 'ChatGPT is already writing this prompt');
    promptsOf(characterId);   // sweep first, so this job is not taken for a leftover
    // Check what can be checked now (no description, no picture), so the director hears it at once, not later.
    if (kind === 'main' && !descriptionOf(characterOf(characterId)).trim()) fail(400, 'this character has no description yet: write one on the sheet first');
    if (kind === 'sheet' && !body.data && !body.asset_id) fail(400, 'the medium shot studio picture is needed: upload it first');
    let pre = body;
    if (kind === 'sheet' && body.data) {   // keep the picture now, so the job reads it from disk
        const c = characterOf(characterId);
        const saved = saveImage(c, body.data, body.name, { medium_shot: true, plate_role: 'concept', ref_category: 'face' }, 'reference_image');
        pre = { asset_id: saved.id };
    }
    db.prepare(`INSERT INTO film_character_sheet_prompts (character_id, kind, status, prompt, model, error, studio_portrait_id, started_at, finished_at)
        VALUES (?, ?, 'writing', NULL, NULL, NULL, ?, datetime('now'), NULL)
        ON CONFLICT(character_id, kind) DO UPDATE SET status = 'writing', error = NULL, studio_portrait_id = excluded.studio_portrait_id, started_at = datetime('now'), finished_at = NULL`)
        .run(characterId, kind, pre.asset_id || null);
    const key = `${characterId}:${kind}`;
    running.add(key);
    const job = kind === 'main' ? mainPicturePrompt(characterId, opts) : sheetPrompt(characterId, pre, opts);
    const done = job.then(r => db.prepare("UPDATE film_character_sheet_prompts SET status = 'done', prompt = ?, model = ?, finished_at = datetime('now') WHERE character_id = ? AND kind = ?")
        .run(r.prompt, r.model || null, characterId, kind))
        .catch(err => db.prepare("UPDATE film_character_sheet_prompts SET status = 'failed', error = ?, finished_at = datetime('now') WHERE character_id = ? AND kind = ?")
            .run(String(err.message || err).slice(0, 500), characterId, kind))
        .finally(() => running.delete(key));
    return { prompts: promptsOf(characterId), done };
}

module.exports = { sheetOf, setMain, uploadSheet, mainPicturePrompt, sheetPrompt, startPrompt, promptsOf, mainFirstSql, isMain, MAIN_GUIDE, SHEET_GUIDE };
