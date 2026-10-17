/**
 * DIRECTION: the Direct studio's saved choices (migration 155), and what it
 * reads to start from. Free; nothing here generates or rewrites a scene card.
 *
 * A shot's direction starts empty: the page seeds it from the card (lines,
 * framing, lens, camera move, light) the first time it is shown, and saves only
 * what the director has touched since. The card itself goes back unchanged,
 * so a line changed here can always be compared with the screenplay's.
 */
const MAX_BYTES = 256 * 1024;

function fail(message, status = 400) { const e = new Error(message); e.status = status; throw e; }
function parse(s, fallback) { try { const v = JSON.parse(s); return v ?? fallback; } catch (_) { return fallback; } }

/** "Ray Mercer, 57. Left his wife…" → 57; an age range like "50s" is kept as written. */
function ageOf(ch) {
    const m = /^[^.,]*,\s*(\d{1,3})\b/.exec(ch.description || '');
    if (m) return m[1];
    return String(ch.age_range || '').trim();
}

function rowsFor(db, projectId) {
    const map = new Map();
    for (const r of db.prepare('SELECT owner, data_json, revision, updated_at FROM production_directions WHERE project_id = ?').all(projectId)) {
        map.set(r.owner, { data: parse(r.data_json, {}), revision: r.revision, updated_at: r.updated_at });
    }
    return map;
}

/** Everything the studio reads for one film: each shot's card and saved direction, the cast, each scene's setting. */
function getDirection(db, projectId) {
    if (!db.prepare('SELECT 1 FROM film_projects WHERE id = ?').get(projectId)) fail('Project not found', 404);
    const saved = rowsFor(db, projectId);
    const shots = {};
    const rows = db.prepare(`SELECT s.id, s.shot_code, s.scene_id, s.scene_card_yaml, s.duration_ms FROM film_shots s
        JOIN film_scenes c ON c.id = s.scene_id WHERE c.project_id = ? AND c.status != 'removed'`).all(projectId);
    for (const r of rows) {
        const card = parse(r.scene_card_yaml, {}) || {};
        const d = saved.get(`shot:${r.id}`);
        shots[r.id] = {
            card: {
                description: card.description || card.action || '', direction: card.direction || '', notes: card.notes || '',
                dialogue: Array.isArray(card.dialogue) ? card.dialogue.map(l => ({ character: String(l.character || ''), line: String(l.line || ''),
                    ...(l.parenthetical ? { parenthetical: String(l.parenthetical) } : {}) })) : [],
                characters: Array.isArray(card.characters) ? card.characters.map(String) : [],
                camera: card.camera && typeof card.camera === 'object' ? card.camera : {},
                lighting: card.lighting && typeof card.lighting === 'object' ? card.lighting : {},
                sfx_cues: Array.isArray(card.sfx_cues) ? card.sfx_cues : [],
                end_state: card.end_state || '',
                duration_s: Number(card.duration_seconds) || Math.round((Number(r.duration_ms) || 0) / 1000) || 0,
            },
            direction: d ? d.data : null, revision: d ? d.revision : 0,
            // What Previz decided for this shot, in prompt words (lib/previs-direction.js); null when never blocked.
            previs: require('./previs-direction').previsForShot(db, r.id),
        };
    }
    const cast = db.prepare('SELECT id, name, description, age_range FROM film_characters WHERE project_id = ? ORDER BY name').all(projectId)
        .map(c => ({ id: c.id, name: c.name, age: ageOf(c) }));
    const scenes = {};
    for (const s of db.prepare("SELECT id, scene_number, int_ext, location, time_of_day FROM film_scenes WHERE project_id = ? AND status != 'removed'").all(projectId)) {
        const loc = db.prepare('SELECT name, reference_prompt, lighting_default, atmosphere_notes, sound_notes FROM film_locations WHERE project_id = ? AND name = ?').get(projectId, s.location);
        scenes[s.id] = { number: s.scene_number, heading: [s.int_ext, s.location].filter(Boolean).join('. '), time_of_day: s.time_of_day || '',
            setting: (loc && loc.reference_prompt) || '', light: (loc && loc.lighting_default) || '', atmosphere: (loc && loc.atmosphere_notes) || '',
            sound: (loc && loc.sound_notes) || '' };
    }
    // Which character a reference picture shows, so the prompt can say "Ray (@image1)": the starter sends plates by asset.
    const ref_owners = Object.fromEntries(db.prepare(`SELECT a.id, c.name FROM film_assets a JOIN film_characters c ON c.id = a.character_id
        WHERE c.project_id = ?`).all(projectId).map(r => [r.id, r.name]));
    const studio = saved.get('studio');
    return { shots, cast, scenes, ref_owners, studio: studio ? studio.data : null, studio_revision: studio ? studio.revision : 0 };
}

function save(db, projectId, owner, data, expected) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Direction must be an object');
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_BYTES) fail('Direction is too large (256 KB at most)', 413);
    const cur = db.prepare('SELECT revision FROM production_directions WHERE project_id = ? AND owner = ?').get(projectId, owner);
    if (expected !== undefined && expected !== null && Number(expected) !== (cur ? cur.revision : 0)) {
        const e = new Error('Direction changed elsewhere; reload to see it'); e.status = 409; e.code = 'DIRECTION_CONFLICT'; throw e;
    }
    if (cur) db.prepare("UPDATE production_directions SET data_json = ?, revision = revision + 1, updated_at = datetime('now') WHERE project_id = ? AND owner = ?").run(text, projectId, owner);
    else db.prepare('INSERT INTO production_directions (project_id, owner, data_json) VALUES (?, ?, ?)').run(projectId, owner, text);
    return { revision: cur ? cur.revision + 1 : 1 };
}

function saveShot(db, projectId, shotId, data, expected) {
    const ok = db.prepare('SELECT 1 FROM film_shots s JOIN film_scenes c ON c.id = s.scene_id WHERE s.id = ? AND c.project_id = ?').get(shotId, projectId);
    if (!ok) fail('Shot not found in this project', 404);
    return save(db, projectId, `shot:${shotId}`, data, expected);
}
function saveStudio(db, projectId, data, expected) {
    if (!db.prepare('SELECT 1 FROM film_projects WHERE id = ?').get(projectId)) fail('Project not found', 404);
    return save(db, projectId, 'studio', data, expected);
}
function clearShot(db, projectId, shotId) {
    db.prepare('DELETE FROM production_directions WHERE project_id = ? AND owner = ?').run(projectId, `shot:${shotId}`);
    return { cleared: true };
}

module.exports = { getDirection, saveShot, saveStudio, clearShot, ageOf };
