/**
 * UPDATE THE STORYBOARD FROM THE SCREENPLAY: plan first, then apply exactly that plan.
 *
 * The Screenplay page's "Update storyboard" button uses this. It is the action `shots-resync` could not take:
 * resync only carries dialogue that still matches word for word, so a line rewritten from "You look like her."
 * to "You look just like her." came back as "changed or gone" and "no shot covers this", and the board kept
 * the old words however many times it ran.
 *
 * HOW A CHANGED LINE FINDS ITS CARD. The lines on a scene's cards, read in shot order, are aligned with the
 * scene's lines in the screenplay, in order (a weighted longest common subsequence):
 *   - an identical line stays where it is;
 *   - a line that was rewritten (same speaker, or the same words with a new speaker) is updated in place, on
 *     the same card, in the same position;
 *   - a line cut from the screenplay is taken off its card;
 *   - a new line goes onto the card that holds the line before it (the first card with dialogue, when it opens
 *     the scene).
 * The alignment never crosses: a line is never moved from one card to another, and a line that changed places
 * in the screenplay is a removal plus an addition, which the plan shows as such.
 *
 * Also refreshed, exactly as resync does: who and what is on the card (characters, props) and its location.
 * Never touched: the description, camera, direction, duration, notes, shot code and the shot itself. Nothing is
 * generated, nothing is spent, and no shot is created or deleted.
 *
 * THE PLAN IS THE CONTRACT. `planStoryboardUpdate` writes nothing and returns a `plan_id`, a hash of every write
 * the apply would make. `applyStoryboardUpdate` rebuilds the plan and refuses (PLAN_CHANGED) if the hash is not
 * the one the person reviewed, so a screenplay edit or a card saved in between can never be applied unseen.
 */

const crypto = require('crypto');
const { db: database } = require('../db/database');

function parseCard(shot) {
    try { return JSON.parse(shot.scene_card_yaml || '{}') || {}; } catch (_) { return {}; }
}

const clean = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

/** CONT'D is a page-layout marker, not a voice: it never belongs on a card. V.O., O.S. and O.C. do. */
function voiceOf(ext) {
    return clean(ext).split(/\s*,\s*|\s*\/\s*/)
        .filter(p => p && !/^(CONT'?D|CONT\.?|CONTINUED|MORE)$/i.test(p.replace(/[’]/g, "'")))
        .join(', ');
}

function speakerKey(name) {
    return clean(name).toUpperCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s*\^$/, '').trim();
}

/** RAY and RAY MERCER are the same speaker: the screenplay cues by first name, cards often carry the full one. */
function sameSpeaker(a, b) {
    const x = speakerKey(a), y = speakerKey(b);
    if (!x || !y) return false;
    return x === y || x.startsWith(y + ' ') || y.startsWith(x + ' ');
}

function words(s) {
    return clean(s).toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').split(' ').filter(Boolean);
}

/** How much of two lines is the same words in the same order, 0..1 (2·LCS / total). */
function similarity(a, b) {
    const x = words(a), y = words(b);
    if (!x.length && !y.length) return 1;
    if (!x.length || !y.length) return 0;
    let prev = new Array(y.length + 1).fill(0);
    for (let i = 1; i <= x.length; i++) {
        const cur = new Array(y.length + 1).fill(0);
        for (let j = 1; j <= y.length; j++) {
            cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
        }
        prev = cur;
    }
    return (2 * prev[y.length]) / (x.length + y.length);
}

/**
 * How well a card line answers a screenplay line; 0 means "not the same line".
 * Identical beats rewritten, and any pairing beats leaving both unpaired, so the alignment keeps as many
 * lines in place as it can without ever crossing.
 */
function pairScore(card, script) {
    const speaker = sameSpeaker(card.character, script.character);
    const sim = similarity(card.line, script.line);
    if (speaker && clean(card.line) === clean(script.line)) return 100;
    if (speaker) return 10 + 80 * sim;
    // The same words given to someone else: a reassigned line, not a new one.
    if (sim >= 0.8) return 5 + 40 * sim;
    return 0;
}

/**
 * Align the cards' lines (in shot order) with the screenplay's. Returns the edit, in order:
 * { op: 'same' | 'changed', card: i, script: j } | { op: 'removed', card: i } | { op: 'added', script: j }.
 */
function align(cardLines, scriptLines) {
    const n = cardLines.length, m = scriptLines.length;
    const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
    const pair = Array.from({ length: n }, (_, i) => scriptLines.map(s => pairScore(cardLines[i], s)));
    for (let i = 1; i <= n; i++) {
        for (let j = 1; j <= m; j++) {
            const p = pair[i - 1][j - 1];
            score[i][j] = Math.max(score[i - 1][j], score[i][j - 1], p > 0 ? score[i - 1][j - 1] + p : -Infinity);
        }
    }
    const back = [];
    let i = n, j = m;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0) {
            const p = pair[i - 1][j - 1];
            if (p > 0 && Math.abs(score[i][j] - (score[i - 1][j - 1] + p)) < 1e-9) {
                back.push({ op: p === 100 ? 'same' : 'changed', card: i - 1, script: j - 1 });
                i--; j--; continue;
            }
        }
        if (j > 0 && (i === 0 || score[i][j - 1] >= score[i - 1][j])) { back.push({ op: 'added', script: j - 1 }); j--; }
        else { back.push({ op: 'removed', card: i - 1 }); i--; }
    }
    const ops = back.reverse();
    // Between two paired lines, removals first, then additions: a line that replaces a cut one lands on the
    // cut line's card, not on the card before it.
    const out = [];
    let run = [];
    const flush = () => {
        out.push(...run.filter(o => o.op === 'removed'), ...run.filter(o => o.op === 'added'));
        run = [];
    };
    for (const o of ops) {
        if (o.op === 'removed' || o.op === 'added') run.push(o);
        else { flush(); out.push(o); }
    }
    flush();
    return out;
}

function lineLabel(d) {
    const voice = voiceOf(d && d.extension);
    return `${clean(d && d.character)}${voice ? ` (${voice})` : ''}`;
}

/**
 * The card's line, carrying the screenplay's words, speaker and voice where they differ; anything else the card
 * held on it is kept, and so is what already agrees (RAY MERCER on the card for RAY in the screenplay).
 */
function updatedLine(card, script) {
    const next = { ...card };
    if (clean(card.line) !== clean(script.line)) next.line = script.line;
    if (!sameSpeaker(card.character, script.character)) next.character = script.character;
    const voice = voiceOf(script.extension);
    if (voiceOf(card.extension) !== voice) { if (voice) next.extension = voice; else delete next.extension; }
    return next;
}

/** A card line as an object: older cards can hold "NAME: words" strings. */
function asLine(d) {
    if (d && typeof d === 'object') return d;
    const m = /^\s*([A-Z][A-Z0-9 .'’-]*?)\s*:\s*(.+)$/.exec(String(d == null ? '' : d));
    return m ? { character: m[1], line: m[2] } : { character: '', line: String(d == null ? '' : d) };
}

function fromScreenplay(script) {
    const voice = voiceOf(script.extension);
    return { character: script.character, line: script.line, ...(voice ? { extension: voice } : {}) };
}

function names(list) {
    return (Array.isArray(list) ? list : []).map(x => (typeof x === 'string' ? x : x && x.name)).filter(Boolean);
}

/** Everything the apply would write, and what it means, for one project. Writes nothing. */
function buildPlan(projectId) {
    const db = database;
    const { sceneFromScreenplay } = require('./shots-resync');
    const { resolveCardSubjects } = require('./shot-references');
    const { matchesScene } = require('./screenplay-drift');

    const scenes = db.prepare(
        "SELECT * FROM film_scenes WHERE project_id = ? AND status != 'removed' ORDER BY scene_number").all(projectId);
    const plannedScenes = [];
    const writes = [];         // { shot_id, card }: the cards the apply rewrites
    const stamps = [];         // { shot_id, scene_id }: the shots the apply records as current
    const notes = [];          // what the update does not do, said once

    for (const scene of scenes) {
        const shots = db.prepare('SELECT * FROM film_shots WHERE scene_id = ? ORDER BY sort_order, shot_code').all(scene.id);
        const heading = [scene.int_ext, scene.location, scene.time_of_day].filter(Boolean).join('. ');
        if (!shots.length) continue;

        const screenplay = sceneFromScreenplay(db, scene);
        const cards = shots.map(parseCard);
        const before = cards.map(c => JSON.stringify(c));
        const changes = shots.map(() => []);

        // Every card line, in shot order, with where it lives.
        const cardLines = [];
        cards.forEach((card, s) => (Array.isArray(card.dialogue) ? card.dialogue : []).forEach((d, k) => {
            if (d != null && clean(asLine(d).line)) cardLines.push({ shot: s, index: k, d: asLine(d) });
        }));

        const unplaced = [];
        const hasText = !!clean(screenplay.text);
        if (hasText && (cardLines.length || screenplay.dialogue.length)) {
            const ops = align(cardLines.map(c => c.d), screenplay.dialogue);
            const next = shots.map(() => []);
            // Where an added line goes: after the last card line passed, else before the next one.
            const firstCardOp = ops.find(o => o.card !== undefined);
            let at = firstCardOp ? cardLines[firstCardOp.card].shot : null;
            for (const o of ops) {
                if (o.op === 'same') {
                    const c = cardLines[o.card];
                    at = c.shot;
                    const line = updatedLine(c.d, screenplay.dialogue[o.script]);
                    const was = voiceOf(c.d.extension), now = voiceOf(line.extension);
                    if (was !== now) {
                        changes[c.shot].push({ kind: 'voice_changed', character: clean(c.d.character), line: clean(c.d.line),
                            from: was || 'on screen', to: now || 'on screen' });
                    }
                    next[c.shot].push(line);
                } else if (o.op === 'changed') {
                    const c = cardLines[o.card];
                    at = c.shot;
                    const line = updatedLine(c.d, screenplay.dialogue[o.script]);
                    // `similar` false: the same speaker's line in the same place, reworded past recognition.
                    changes[c.shot].push({ kind: 'line_changed', from_character: lineLabel(c.d), character: lineLabel(line),
                        from: clean(c.d.line), to: clean(line.line), similar: similarity(c.d.line, line.line) >= 0.3 });
                    next[c.shot].push(line);
                } else if (o.op === 'removed') {
                    const c = cardLines[o.card];
                    at = c.shot;
                    changes[c.shot].push({ kind: 'line_removed', character: lineLabel(c.d), line: clean(c.d.line) });
                } else {
                    const line = fromScreenplay(screenplay.dialogue[o.script]);
                    if (at === null) { unplaced.push(line); continue; }
                    const prev = next[at][next[at].length - 1];
                    changes[at].push({ kind: 'line_added', character: lineLabel(line), line: clean(line.line),
                        after: prev ? clean(prev.line) : null });
                    next[at].push(line);
                }
            }
            cards.forEach((card, s) => {
                const had = Array.isArray(card.dialogue) ? card.dialogue : [];
                if (JSON.stringify(had) !== JSON.stringify(next[s]) && (had.length || next[s].length)) card.dialogue = next[s];
            });
        }

        // Who and what is in the frame, and where: the same derivation resync makes.
        cards.forEach((card, s) => {
            let resolved = null;
            try { resolved = resolveCardSubjects(db, projectId, card); } catch (_) { resolved = null; }
            if (resolved) {
                const wasChars = names(card.characters), wasProps = names(card.props);
                if (JSON.stringify(wasChars) !== JSON.stringify(resolved.characters)) {
                    changes[s].push({ kind: 'characters', from: wasChars, to: resolved.characters });
                    card.characters = resolved.characters.map(name => ({ name }));
                }
                if (JSON.stringify(wasProps) !== JSON.stringify(resolved.props)) {
                    changes[s].push({ kind: 'props', from: wasProps, to: resolved.props });
                    card.props = resolved.props;
                }
            }
            if (scene.location && (card.location || scene.location) !== scene.location) {
                changes[s].push({ kind: 'location', from: card.location, to: scene.location });
                card.location = scene.location;
            }
        });

        const behind = shots.filter(sh => sh.scene_fingerprint && !(() => {
            try { return matchesScene(scene, sh.scene_fingerprint); } catch (_) { return true; }
        })());
        const entry = { scene_id: scene.id, scene_number: String(scene.scene_number), heading, shots: [],
            unchanged: [], unplaced_lines: unplaced.map(l => ({ character: lineLabel(l), line: clean(l.line) })),
            screenplay_changed: behind.length > 0 };

        shots.forEach((sh, s) => {
            const card = cards[s];
            const changed = JSON.stringify(card) !== before[s];
            if (changed) {
                writes.push({ shot_id: sh.id, card });
                entry.shots.push({ shot_id: sh.id, shot_code: sh.shot_code, changes: changes[s] });
            } else {
                entry.unchanged.push(sh.shot_code);
            }
            // Recorded as written from this draft: the card now carries what the screenplay says. An unstamped
            // card that needs nothing stays unstamped ("outside the workflow" is not ours to claim for it).
            if (changed || behind.includes(sh)) stamps.push({ shot_id: sh.id, scene_id: scene.id });
        });
        if (entry.shots.length || entry.unplaced_lines.length || entry.screenplay_changed) plannedScenes.push(entry);
    }

    // Scenes the screenplay no longer has, whose shots are kept: said, never acted on.
    const gone = db.prepare(
        `SELECT sc.scene_number, COUNT(s.id) n FROM film_scenes sc JOIN film_shots s ON s.scene_id = sc.id
          WHERE sc.project_id = ? AND sc.status = 'removed' GROUP BY sc.id ORDER BY sc.scene_number`).all(projectId);
    for (const g of gone) {
        notes.push({ kind: 'scene_removed', scene_number: String(g.scene_number), shots: g.n,
            why: `Scene ${g.scene_number} is no longer in the screenplay. Its ${g.n} shot(s) are kept as they are: an update never deletes a shot.` });
    }
    const empty = db.prepare(
        `SELECT sc.scene_number FROM film_scenes sc WHERE sc.project_id = ? AND sc.status != 'removed'
            AND NOT EXISTS (SELECT 1 FROM film_shots s WHERE s.scene_id = sc.id) ORDER BY sc.scene_number`).all(projectId);
    if (empty.length) {
        notes.push({ kind: 'scenes_without_shots', scenes: empty.map(e => String(e.scene_number)),
            why: `Scene${empty.length === 1 ? '' : 's'} ${empty.map(e => e.scene_number).join(', ')} ${empty.length === 1 ? 'has' : 'have'} no shots yet, so there is nothing on the board to update. Break ${empty.length === 1 ? 'it' : 'them'} into shots first.` });
    }

    const planId = crypto.createHash('sha256')
        .update(JSON.stringify({ writes: writes.map(w => [w.shot_id, w.card]), stamps: stamps.map(s => s.shot_id) }))
        .digest('hex').slice(0, 32);
    return { plannedScenes, writes, stamps, notes, planId };
}

function summary(projectId, built, applied) {
    const cards = built.writes.length;
    const lines = built.plannedScenes.reduce((n, sc) => n + sc.shots.reduce((k, sh) =>
        k + sh.changes.filter(c => /^line_|^voice_/.test(c.kind)).length, 0), 0);
    return {
        project_id: projectId,
        plan_id: built.planId,
        applied,
        cards_to_update: cards,
        dialogue_changes: lines,
        cards_marked_current: built.stamps.length,
        scenes: built.plannedScenes,
        notes: built.notes,
        spends: 0,
        kept: ['description', 'camera', 'direction', 'duration', 'notes', 'shot code', 'the shot itself', 'frames'],
    };
}

/** The plan: which cards would change and how. Free, and writes nothing at all. */
function planStoryboardUpdate(projectId) {
    return summary(projectId, buildPlan(projectId), false);
}

/**
 * Apply the plan with this id, and only that plan. Throws PLAN_CHANGED (with the fresh plan on `err.plan`) when
 * the screenplay or a card has moved since it was reviewed.
 */
function applyStoryboardUpdate(projectId, planId) {
    const db = database;
    const { stampShot } = require('./screenplay-drift');
    const run = db.transaction(() => {
        const built = buildPlan(projectId);
        if (!planId || planId !== built.planId) {
            const err = new Error('The screenplay or the cards changed since this plan was made. Review the new plan before updating.');
            err.code = 'PLAN_CHANGED';
            err.plan = summary(projectId, built, false);
            throw err;
        }
        const write = db.prepare('UPDATE film_shots SET scene_card_yaml = ? WHERE id = ?');
        for (const w of built.writes) write.run(JSON.stringify(w.card, null, 2), w.shot_id);
        for (const s of built.stamps) stampShot(s.shot_id, s.scene_id);
        return built;
    });
    return summary(projectId, run(), true);
}

module.exports = { planStoryboardUpdate, applyStoryboardUpdate, align, similarity, voiceOf, sameSpeaker };
