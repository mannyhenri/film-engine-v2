/**
 * The contract between Film Engine and the ComfyUI PC (comfyui-connector), pinned from the PC's own repo:
 * tests/fixtures/comfyui/ is GRIDLIGHT-INC/comfyui-connector @ d6ca197 (comfy-workflows/ and its fixtures/,
 * the PC's README there renamed CONTRACT.md). Its apply_manifest.py must produce *.expected.json from
 * *.inputs.json; so must buildPrompt here. Every golden case in the folder is run, so a case the PC adds
 * is checked here too once copied in.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-comfy-contract-'));
const comfy = require('../lib/comfyui');

const DIR = path.join(__dirname, 'fixtures', 'comfyui');
const read = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const MANIFEST = read('storyboard_shot_to_video.fe.json');
const GRAPH = read('storyboard_shot_to_video.api.json');
const sorted = o => JSON.parse(JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v)));

test('the PC\'s manifest validates against its own graph here', () => {
    assert.deepStrictEqual(comfy.validate(MANIFEST, GRAPH), []);
});

test('every golden case: buildPrompt makes exactly the graph the PC\'s transform makes', () => {
    const cases = fs.readdirSync(DIR).filter(f => f.endsWith('.inputs.json')).map(f => f.replace('.inputs.json', ''));
    assert.ok(cases.length >= 3, `golden cases found: ${cases.join(', ')}`);
    for (const c of cases) {
        const got = comfy.buildPrompt(MANIFEST, GRAPH, read(`${c}.inputs.json`));
        assert.deepStrictEqual(sorted(got), sorted(read(`${c}.expected.json`)), `case ${c}`);
    }
});

test('every key Film Engine reads from the manifest is there, with the shape it expects', () => {
    for (const k of ['prompt', 'seed']) assert.ok(MANIFEST[k].node && MANIFEST[k].input, k);
    for (const k of ['images', 'audio']) for (const r of MANIFEST[k]) assert.ok(r.node && r.input, `${k} slot`);
    for (const o of MANIFEST.options) {
        assert.strictEqual(o.type, 'enum', o.id);
        assert.strictEqual(o.index, true, `${o.id}: a CustomCombo needs choice and index`);
        o.choices.forEach((c, i) => assert.deepStrictEqual([typeof c.label, c.index], ['string', i], `${o.id} choice ${i}`));
    }
    assert.ok(GRAPH[MANIFEST.outputs.node], 'the save node');
    assert.ok(GRAPH[MANIFEST.core_node] && MANIFEST.ref_wiring.images.core_input_prefix && MANIFEST.ref_wiring.audio.core_input_prefix, 'ref_wiring');
    for (const [id, v] of Object.entries(MANIFEST.draft || {})) assert.ok(MANIFEST.options.find(o => o.id === id)?.choices[v], `draft ${id}=${v} is a real choice`);
});
