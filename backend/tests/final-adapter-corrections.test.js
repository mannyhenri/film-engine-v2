'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
require('../lib/providers/credentials').getCredential = () => ({ apiKey: 'mock-only', meta: {} });
const openai = require('../lib/providers/openai-image');
const google = require('../lib/providers/google-image');
const seedance = require('../lib/providers/seedance');
const higgsfield = require('../lib/providers/higgsfield');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'final-adapter-corrections-'));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));
const first = Buffer.from('first reference bytes');
const last = Buffer.from('last reference bytes');
const uri = `data:image/png;base64,${first.toString('base64')}`;
const lastUri = `data:image/png;base64,${last.toString('base64')}`;
const file = path.join(dir, 'last reference.png');
fs.writeFileSync(file, last);
const missing = path.join(dir, 'missing.png');
const common = { prompt: 'Original prompt', negative_prompt: 'Original negative' };

test('OpenAI includes data URI, local path and file URI references in selected order', async () => {
    const request = openai.buildImageRequest({ ...common, reference_images: [{ uri }, file, { uri: pathToFileURL(file).href }] });
    assert.match(request.url, /\/images\/edits$/);
    assert.equal(request.referenceCount, 3);
    const images = request.form.getAll('image[]');
    assert.deepEqual(await Promise.all(images.map(async image => Buffer.from(await image.arrayBuffer()))), [first, last, last]);
    assert.equal(request.form.get('prompt'), 'Original prompt\n\nAvoid: Original negative');
});

for (const [label, ref] of [['missing path', { file_path: missing }], ['missing source', {}], ['bare URL', { uri: 'https://remote.invalid/ref.png' }]]) {
    test(`OpenAI rejects a selected ${label} instead of producing a text-only request`, () => {
        assert.throws(() => openai.buildImageRequest({ ...common, reference_images: [{ uri }, ref] }), /reference|immutable/i);
    });
}
test('OpenAI rejects excess selected references before preview', () => {
    assert.throws(() => openai.buildImageRequest({ ...common, reference_images: Array(9).fill({ file_path: file }) }), /reference|maximum|at most/i);
});

test('Google inlines data URI, local path and file URI references in selected order', () => {
    const request = google.buildImageRequest({ ...common, reference_images: [{ uri }, { file_path: file }, pathToFileURL(file).href] });
    assert.deepEqual(request.body.input.filter(part => part.type === 'image').map(part => Buffer.from(part.data, 'base64')), [first, last, last]);
    assert.equal(request.body.input[0].text, 'Original prompt\n\nAvoid: Original negative');
});
for (const [label, ref] of [['missing path', { file_path: missing }], ['missing source', {}], ['bare URL', { uri: 'https://remote.invalid/ref.png' }]]) {
    test(`Google rejects a selected ${label} instead of silently omitting it`, () => {
        assert.throws(() => google.buildImageRequest({ ...common, reference_images: [{ uri }, ref] }), /reference|immutable/i);
    });
}
test('Google rejects excess selected references before preview', () => {
    assert.throws(() => google.buildImageRequest({ ...common, reference_images: Array(9).fill({ uri }) }), /reference|maximum|at most/i);
});

test('Higgsfield rejects audio above the selected endpoint schema cap', () => {
    const payload = { model: 'seedance-2', prompt: 'Move', reference_images: [uri], audio_references: Array(4).fill('data:audio/wav;base64,YXVkaW8=') };
    assert.throws(() => higgsfield.buildRequest('video', payload), /audio.*3|3.*audio/i);
    const accepted = higgsfield.buildRequest('video', { ...payload, audio_references: payload.audio_references.slice(0, 3) });
    assert.equal(accepted.body.audio_urls.length, 3);
});
test('Higgsfield rejects a selected audio source that has no URI', () => {
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', reference_images: [uri], audio_references: [{}] }), /audio|reference/i);
});
test('Higgsfield rejects excess and unsupported selected images before preview', () => {
    assert.throws(() => higgsfield.buildRequest('image', { model: 'soul-standard', prompt: 'Move', reference_images: [uri, lastUri] }), /image|picture|reference/i);
    assert.throws(() => higgsfield.buildRequest('image', { model: 'soul-2', prompt: 'Move', reference_images: [uri] }), /image|picture|reference/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', reference_images: Array(10).fill(uri) }), /9|image|picture|reference/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', keyframes: [uri, lastUri, uri] }), /keyframe|image|picture|reference/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', reference_images: [{}] }), /image|picture|reference/i);
});

test('Seedance rejects references the selected anchor workflow would drop', () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, reference_images: [lastUri] }), /image|reference/i);
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', keyframes: [uri, lastUri], reference_images: [uri] }), /image|reference/i);
});
test('Seedance rejects the 31st selected image before collection can truncate it', () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', workflow: 'omni-reference', reference_images: Array.from({ length: 31 }, (_, i) => `data:image/png;base64,${Buffer.from(`image-${i}`).toString('base64')}`) }), /30|reference/i);
});
test('Seedance rejects excess or unsupported selected audio before preview', () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', audio_references: Array(11).fill('data:audio/wav;base64,YXVkaW8=') }), /audio.*10|10.*audio/i);
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', workflow: 'image-to-video', init_image: uri, audio_references: ['data:audio/wav;base64,YXVkaW8='] }), /audio|omni-reference/i);
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', audio_references: [{}] }), /audio|reference/i);
});
test('Seedance rejects selected reference videos instead of approving an empty conditioning package', async () => {
    const payload = { prompt: 'Move', workflow: 'omni-reference', reference_videos: ['data:video/mp4;base64,dmlkZW8='] };
    assert.throws(() => seedance.buildVideoRequest(payload), /reference_videos.*not supported|unsupported.*reference_videos/i);
    await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('seedance', 'video', payload), /reference_videos.*not supported|unsupported.*reference_videos/i);
});
test('Seedance rejects selected muapi_options instead of approving a request without the chosen option', async () => {
    const payload = { prompt: 'Move', muapi_options: { seed: 9 } };
    assert.throws(() => seedance.buildVideoRequest(payload), /muapi_options.*not supported|unsupported.*muapi_options/i);
    await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('seedance', 'video', payload), /muapi_options.*not supported|unsupported.*muapi_options/i);
    assert.equal(seedance.buildVideoRequest({ prompt: 'Move', reference_videos: [], muapi_options: {}, seed: 9 }).body.seed, 9);
});
test('Seedance folds its declared negative prompt before approval and final_prompt remains an exact override', async () => {
    const payload = { prompt: 'Appearance', motion_prompt: 'Original movement', negative_prompt: 'Original negative' };
    assert.equal(seedance.buildVideoRequest(payload).body.prompt, 'Original movement\n\nAvoid: Original negative');
    const resolved = await require('../lib/final-provider-request').resolveFinalRequest('seedance', 'video', { ...payload, final_prompt: 'Exact approved final text' });
    assert.equal(resolved.body.prompt, 'Exact approved final text');
});
test('Higgsfield rejects a selected workflow that differs from its attachment-derived endpoint', () => {
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', workflow: 'omni-reference' }), /workflow/i);
    assert.equal(higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', workflow: 'text' }).workflow, 'text');
});
test('Higgsfield sends a supported selected negative and rejects it when the endpoint has no field', () => {
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', negative_prompt: 'Avoid blur' }), /negative_prompt/i);
    assert.equal(higgsfield.buildRequest('video', { model: 'kling-2-5-turbo-pro', prompt: 'Move', negative_prompt: 'Avoid blur' }).body.negative_prompt, 'Avoid blur');
});
test('native builders reject unknown or incompatible selected workflow and source fields', async () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', workflow: 'unknown' }), /workflow/i);
});
test('Seedance rejects a selected draft mode that the text endpoint cannot send', async () => {
    const payload = { prompt: 'Move', workflow: 'text-to-video', muapi_draft: true };
    assert.throws(() => seedance.buildVideoRequest(payload), /draft/i);
    await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('seedance', 'video', payload), /draft/i);
    assert.equal(seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, muapi_draft: true }).body.draft, true);
    assert.equal(seedance.buildVideoRequest({ prompt: 'Move', muapi_draft: false }).body.draft, undefined);
});
test('Seedance preserves first/last roles even when both select the same bytes', () => {
    const request = seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, last_frame: uri });
    assert.equal(request.workflow, 'first-last-frame');
    assert.deepEqual(request.body.images_list, [uri, uri]);
});
test('Seedance and Higgsfield accept local path reference objects without dropping them', () => {
    assert.deepEqual(seedance.buildVideoRequest({ prompt: 'Move', workflow: 'omni-reference', reference_images: [{ file_path: file }] }).body.images_list, [file]);
    assert.deepEqual(higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', reference_images: [{ file_path: file }] }).body.image_urls, [file]);
});
test('declared image_url/end_image aliases retain first/last roles on both video adapters', () => {
    const seed = seedance.buildVideoRequest({ prompt: 'Move', image_url: uri, end_image: lastUri });
    assert.equal(seed.workflow, 'first-last-frame');
    assert.deepEqual(seed.body.images_list, [uri, lastUri]);
    const higgs = higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', image_url: uri, end_image: lastUri });
    assert.equal(higgs.body.image_url, uri);
    assert.equal(higgs.body.end_image_url, lastUri);
    const edit = higgsfield.buildRequest('image', { model: 'qwen-image-3', prompt: 'Change', image_url: uri });
    assert.match(edit.endpoint, /\/edit$/);
    assert.deepEqual(edit.body.image_urls, [uri]);
});
test('route endpoint fields and their exact keyframe alias list represent two selected frames', () => {
    for (const firstUri of [uri, lastUri]) {
        const payload = { prompt: 'Move', init_image: firstUri, last_frame: lastUri, keyframes: [{ uri: firstUri }, { uri: lastUri }] };
        assert.deepEqual(seedance.buildVideoRequest(payload).body.images_list, [firstUri, lastUri]);
        const higgs = higgsfield.buildRequest('video', { ...payload, model: 'seedance-2-5' });
        assert.equal(higgs.body.image_url, firstUri);
        assert.equal(higgs.body.end_image_url, lastUri);
    }
    assert.deepEqual(seedance.buildVideoRequest({ prompt: 'Move', keyframes: [uri, uri] }).body.images_list, [uri, uri]);
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, reference_images: [uri] }), /image|reference/i);
});
test('conflicting aliases and Higgsfield media option overrides cannot silently replace selected references', () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, image_url: lastUri }), /conflict|selected/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2-5', prompt: 'Move', init_image: uri, image_url: lastUri }), /conflict|selected/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', reference_images: [uri], higgsfield_options: { image_urls: [lastUri] } }), /conflict|selected|replace/i);
});
test('selected reference lists must be arrays rather than silently disappearing', () => {
    for (const provider of [openai, google]) assert.throws(() => provider.buildImageRequest({ ...common, reference_images: { uri } }), /reference_images.*array/i);
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', audio_references: { uri } }), /audio_references.*array/i);
    assert.throws(() => higgsfield.buildRequest('video', { model: 'seedance-2', prompt: 'Move', audio_references: { uri } }), /audio_references.*array/i);
});

function stallUntilAbort(init) {
    if (!init.signal) throw new Error('Fetch is missing the bounded AbortSignal');
    return new Promise((resolve, reject) => {
        if (init.signal.aborted) return reject(init.signal.reason);
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
}
