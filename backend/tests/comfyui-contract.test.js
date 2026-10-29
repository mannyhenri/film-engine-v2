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

/*
 * The take tool (take_upscale_seedvr2, as deployed on the PC; "audio" given as [] as agreed): every choice of every
 * option reaches the graph. A choice with a "value" sends the value (the label is only what the page shows); an
 * option with "sets" writes each of its inputs, "<choice.X>" read from the choice picked.
 */
const TAKE = read('take_upscale_seedvr2.fe.json');
const TAKE_GRAPH = read('take_upscale_seedvr2.api.json');

test('the take tool\'s manifest validates against its own graph, every sets input included', () => {
    assert.deepStrictEqual(comfy.validate(TAKE, TAKE_GRAPH), []);
    const broken = { ...TAKE, options: TAKE.options.map(o => (o.sets ? { ...o, sets: { ...o.sets, 'resize_type.nope': 1 } } : o)) };
    assert.match(comfy.validate(broken, TAKE_GRAPH).join('\n'), /has no input "resize_type.nope"/);
    assert.match(comfy.validate({ ...TAKE, audio: 'passthrough' }, TAKE_GRAPH).join('\n'), /audio: a list of slots/);
});

test('every choice of every take-tool option reaches the graph as its value, or as each input it sets', () => {
    for (const o of TAKE.options) {
        assert.ok(o.choices.length, o.id);
        for (const c of o.choices) {
            const g = comfy.buildPrompt(TAKE, TAKE_GRAPH, { options: { [o.id]: c.label }, video: ['film-engine/take.mp4'], seed: 7 });
            const inputs = g[String(o.node)].inputs;
            if (o.sets) {
                for (const [k, tpl] of Object.entries(o.sets)) {
                    const m = /^<choice\.(\w+)>$/.exec(String(tpl));
                    assert.deepStrictEqual(inputs[k], m ? c[m[1]] : tpl, `${o.id} = ${c.label}: ${k}`);
                }
            } else assert.strictEqual(inputs[o.input], 'value' in c ? c.value : c.label, `${o.id} = ${c.label}`);
            assert.strictEqual(g[TAKE.video[0].node].inputs[TAKE.video[0].input], 'film-engine/take.mp4', 'the take is the video in');
        }
    }
    // The default draft is the Best model at exactly 1920x1080.
    const d = comfy.buildPrompt(TAKE, TAKE_GRAPH, { video: ['film-engine/take.mp4'] });
    assert.strictEqual(d['52'].inputs.unet_name, 'seedvr2_7b_int8_convrot.safetensors');
    assert.deepStrictEqual([d['57'].inputs['resize_type.width'], d['57'].inputs['resize_type.height']], [1920, 1080]);
});

/*
 * Every choice a manifest offers must be one the PC accepts (its /object_info, pinned here from the live PC):
 * a model file that exists, a colour method the node knows, a resize mode and a size in range. Checked set-based:
 * corrupting ANY one choice of ANY option must be caught, except where the PC lists no choices for that input
 * (a CustomCombo's options live in the workflow itself; the PC's registry test covers those), which is counted.
 */
const INFO = read('object_info.json');
const MANIFESTS = { storyboard_shot_to_video: [MANIFEST, GRAPH], take_upscale_seedvr2: [TAKE, TAKE_GRAPH] };
const corrupt = (m, oi, ci, field) => {
    const copy = JSON.parse(JSON.stringify(m));
    const o = copy.options[oi], c = o.choices[ci];
    if (field) c[field] = typeof c[field] === 'number' ? 999999 : 'X_INVALID';
    else if (typeof c === 'object' && 'value' in c) c.value = 'X_INVALID';
    else if (typeof c === 'object') c.label = 'X_INVALID';
    else o.choices[ci] = 'X_INVALID';
    return copy;
};

test('every choice of every option is one the live PC accepts, and any one corrupted choice is caught', () => {
    let caught = 0, unguarded = 0;
    for (const [slug, [m, g]] of Object.entries(MANIFESTS)) {
        assert.deepStrictEqual(comfy.liveProblems(m, g, INFO), [], `${slug} as deployed`);
        m.options.forEach((o, oi) => o.choices.forEach((c, ci) => {
            // A sets option is corrupted in each field its templates read; else the value the graph gets.
            const fields = o.sets ? [...new Set(Object.values(o.sets).map(t => (/^<choice\.(\w+)>$/.exec(String(t)) || [])[1]).filter(Boolean))] : [null];
            for (const field of fields) {
                const problems = comfy.liveProblems(corrupt(m, oi, ci, field), g, INFO);
                const spec = !o.sets && comfy.inputSpec(INFO, g[String(o.node)].class_type, o.input);
                if (spec && !comfy.choicesOf(spec)?.length) { assert.deepStrictEqual(problems, [], `${slug} ${o.id}: the PC lists no choices`); unguarded++; continue; }
                assert.ok(problems.some(p => p.startsWith(`option ${o.id}`)), `${slug} ${o.id} choice ${ci}${field ? ' ' + field : ''}: corruption caught (${problems.join('; ') || 'nothing'})`);
                caught++;
            }
        }));
    }
    assert.ok(caught >= 9, `checked ${caught} take-tool corruptions`);   // model 2 + colour 4 + resolution 2x2
    assert.strictEqual(unguarded, MANIFEST.options.reduce((n, o) => n + o.choices.length, 0), 'only the storyboard CustomCombo choices are left to the PC registry test');
    // The gate's own corruption, by name.
    const sepia = JSON.parse(JSON.stringify(TAKE)); sepia.options.find(o => o.id === 'color_correction').choices[0].value = 'sepia_INVALID';
    assert.match(comfy.liveProblems(sepia, TAKE_GRAPH, INFO).join('\n'), /option color_correction: "sepia_INVALID" is not one the PC accepts/);
    // A node class the PC does not have is a problem, not a crash.
    assert.match(comfy.liveProblems(TAKE, TAKE_GRAPH, {}).join('\n'), /option model: the PC has no node UNETLoader/);
});

test('the PC is asked about each node class by its URL-encoded name (a class may have a space: "Video Slice")', () => {
    assert.strictEqual(comfy.objectInfoPath('Video Slice'), '/object_info/Video%20Slice');
    assert.strictEqual(comfy.objectInfoPath('UNETLoader'), '/object_info/UNETLoader');
});
