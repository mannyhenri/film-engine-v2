/**
 * An audio file is a card, not a line of text
 * ─────────────────────────────────────────────────────────────────────────
 *
 * "The new audio section is horrible. Each audio file should be its own card
 *  with details about it — format, what it is, etc. I should be able to add a
 *  new audio through either generate or upload."
 *
 * The cue sheet shipped as a one-line row per cue: a title, a badge and three
 * buttons. It says what the cue is CALLED and nothing about the audio — not
 * its format, not how long it runs, not how big it is, not what made it or
 * when. A director choosing between two takes of a score has nothing to choose
 * on.
 *
 * The detail fields are DERIVED from the columns `film_assets` actually has,
 * read from the schema rather than typed here, because a card that invents a
 * field shows a blank where a fact should be — and because the honest set is
 * exactly what the database can answer.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const UI = fs.readFileSync(path.join(ROOT, 'src', 'index.html'), 'utf8');

/*
 * What a card must say about a file, and the column each fact comes from.
 * Every one of these exists on film_assets today — nothing here is invented,
 * which is the point: a card should report, not guess.
 */
const DETAIL = {
    format: 'format',
    duration: 'duration_ms',
    size: 'size_bytes',
    provider: 'provider',
    made: 'created_at',
};

test('every detail the card promises is a column the database has', () => {
    /*
     * EVERY migration that touches film_assets, not just the one that creates
     * it. `provider` was added by a later ALTER, so scanning only the CREATE
     * reported a column the live table plainly has as missing — a test wrong
     * about the schema is worse than no test, because it is believed.
     *
     * Read from the migrations rather than the live database on purpose:
     * test-isolation forbids a test opening the real one.
     */
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const schema = fs.readdirSync(dir)
        .map(n => fs.readFileSync(path.join(dir, n), 'utf8'))
        .filter(sql => /film_assets/i.test(sql))
        .join('\n');
    assert.ok(/CREATE TABLE[^;]*film_assets/i.test(schema),
        'no migration creates film_assets — the scan is broken');
    const missing = Object.values(DETAIL).filter(col => !new RegExp('\\b' + col + '\\b').test(schema));
    assert.deepStrictEqual(missing, [],
        `the card promises facts the table cannot answer: ${missing.join(', ')}`);
});

/*
 * The per-cue sheet (soundCueCard) went with music-making on 2026-10-14. The
 * sound LIBRARY card is the one that remains, and it owes the same facts.
 */
test('a library sound renders as a CARD carrying every detail', () => {
    const gaps = [];
    const at = UI.indexOf('function soundFileCard(');
    if (at < 0) gaps.push('there is no soundFileCard renderer');
    const body = at < 0 ? '' : UI.slice(at, UI.indexOf('\n    }\n', at));
    if (!/class="snd-card"/.test(body)) gaps.push('no card element — the sound is still a row');
    for (const [label, col] of Object.entries(DETAIL)) {
        if (!new RegExp(`\\bs\\.${col}\\b`).test(body)) {
            gaps.push(`the card never reads ${col}, so it cannot show ${label}`);
        }
    }
    assert.deepStrictEqual(gaps, [], '\n  ' + gaps.join('\n  ') + '\n');
});

test('the card shows a waveform, and the server can produce one', () => {
    const gaps = [];
    if (!fs.existsSync(path.join(__dirname, '..', 'lib', 'waveform.js'))) {
        gaps.push('lib/waveform.js does not exist — nothing can compute peaks');
    }
    const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    if (!/waveform/.test(server)) gaps.push('server.js dispatches nothing to a waveform route');
    if (!/drawWaveform|snd-wave/.test(UI)) gaps.push('the page never draws a waveform');
    /*
     * And it must be CALLED. Declaring a painter and never invoking it renders
     * every canvas blank, which looks exactly like a waveform that failed to
     * compute — this test passed in precisely that state until a wiring check
     * was added.
     */
    if (!/paintWaveforms\([a-zA-Z]/.test(UI)) gaps.push('paintWaveforms is defined but never called');
    assert.deepStrictEqual(gaps, [], '\n  ' + gaps.join('\n  ') + '\n');
});
