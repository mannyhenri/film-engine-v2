'use strict';
require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
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
const runway = require('../lib/providers/runway');

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
test('Runway rejects malformed, nonarray, excess and unsupported selected image/audio inputs', () => {
    for (const reference_images of [[{}], { uri }, [uri, lastUri]]) assert.throws(() => runway.buildVideoRequest({ model: 'seedance2_5', prompt: 'Move', reference_images }), /reference|array|image/i);
    for (const audio_references of [[{}], { uri }, Array(11).fill('data:audio/wav;base64,YXVkaW8=')]) assert.throws(() => runway.buildVideoRequest({ model: 'seedance2_5', prompt: 'Move', audio_references }), /audio|array|reference/i);
    assert.throws(() => runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', audio_references: ['data:audio/wav;base64,YXVkaW8='] }), /audio|reference/i);
    assert.throws(() => runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', init_image: uri, reference_images: [lastUri] }), /image|reference/i);
    assert.throws(() => runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', keyframes: [uri, lastUri, uri] }), /keyframe|image|reference/i);
    assert.throws(() => runway.buildImageRequest({ model: 'gen4_image', prompt: 'Image', reference_images: Array(4).fill(uri) }), /image|reference/i);
});
test('Runway preserves exact route keyframe aliases and rejects distinct conflicting endpoint images', () => {
    const payload = { model: 'gen4_turbo', prompt: 'Move', init_image: uri, keyframes: [{ uri }, { uri: lastUri }] };
    assert.deepEqual(runway.buildVideoRequest(payload).body.promptImage, [{ uri, position: 'first' }, { uri: lastUri, position: 'last' }]);
    assert.throws(() => runway.buildVideoRequest({ ...payload, init_image: lastUri }), /conflict|selected|image|keyframe/i);
    assert.throws(() => runway.buildVideoRequest({ model: 'gen4_turbo', prompt: 'Move', reference_images: [uri, uri] }), /image|reference/i);
});
test('Runway folds video negatives before approval and refuses unsupported requested sound generation', async () => {
    const payload = { model: 'gen4.5', prompt: 'Original movement', negative_prompt: 'Original negative' };
    assert.equal(runway.buildVideoRequest(payload).body.promptText, 'Original movement\n\nAvoid: Original negative');
    const resolved = await require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', { ...payload, final_prompt: 'Exact approved final text' });
    assert.equal(resolved.body.promptText, 'Exact approved final text');
    assert.throws(() => runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', generate_audio: true }), /audio|sound/i);
    assert.equal(runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', generate_audio: false }).body.audio, undefined);
});
test('native builders reject unknown or incompatible selected workflow and source fields', async () => {
    assert.throws(() => seedance.buildVideoRequest({ prompt: 'Move', workflow: 'unknown' }), /workflow/i);
    for (const selected of [{ runway_recipe: 'unknown' }, { mode: 'video_to_video' }, { references: [uri] }, { videoUri: 'data:video/mp4;base64,dmlkZW8=' }]) {
        const payload = { model: 'gen4.5', prompt: 'Move', ...selected };
        assert.throws(() => runway.buildVideoRequest(payload), /recipe|mode|reference|videoUri|video.*endpoint/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /recipe|mode|reference|videoUri|video.*endpoint/i);
    }
});
test('Runway preserves native promptImage array roles and rejects excess timed keyframes', () => {
    const promptImage = [{ uri, position: 'first' }, { uri: lastUri, position: 'last' }];
    assert.deepEqual(runway.buildVideoRequest({ model: 'gen4_turbo', prompt: 'Move', promptImage, init_image: uri, keyframes: promptImage }).body.promptImage, promptImage);
    assert.throws(() => runway.buildVideoRequest({ model: 'aleph2', videoUri: 'https://mock.invalid/source.mp4', keyframes: Array.from({ length: 6 }, (_, seconds) => ({ uri, seconds })) }), /keyframe|reference/i);
});
test('Runway keeps folded negatives on the existing timed-keyframe builder', () => {
    const request = runway.buildVideoRequest({ model: 'aleph2', videoUri: 'https://mock.invalid/source.mp4', prompt: 'Original edit', negative_prompt: 'Original negative' });
    assert.equal(request.body.promptText, 'Original edit\n\nAvoid: Original negative');
});
test('Runway rejects a selected output format the resolved model cannot send', async () => {
    for (const [model, output_format] of [['gen4.5', 'unsupported-output'], ['gen4_turbo', 'mp4']]) {
        const payload = { model, prompt: 'Move', output_format };
        assert.throws(() => runway.buildVideoRequest(payload), /output_format|output format/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /output_format|output format/i);
    }
    assert.equal(runway.buildVideoRequest({ model: 'gen4.5', prompt: 'Move', output_format: 'mp4' }).body.outputFormat, 'mp4');
});
test('Seedance rejects a selected draft mode that the text endpoint cannot send', async () => {
    const payload = { prompt: 'Move', workflow: 'text-to-video', muapi_draft: true };
    assert.throws(() => seedance.buildVideoRequest(payload), /draft/i);
    await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('seedance', 'video', payload), /draft/i);
    assert.equal(seedance.buildVideoRequest({ prompt: 'Move', init_image: uri, muapi_draft: true }).body.draft, true);
    assert.equal(seedance.buildVideoRequest({ prompt: 'Move', muapi_draft: false }).body.draft, undefined);
});
test('Runway rejects unsupported selected automatic duration and resolution without changing valid choices', async () => {
    for (const selected of [{ model: 'gen4.5', duration_auto: true }, { model: 'gen4.5', resolution: '4k' }, { model: 'h3_max', resolution: 'unsupported' }]) {
        const payload = { prompt: 'Move', ...selected };
        assert.throws(() => runway.buildVideoRequest(payload), /duration_auto|automatic duration|resolution/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /duration_auto|automatic duration|resolution/i);
    }
    assert.equal(runway.buildVideoRequest({ model: 'h3_max', prompt: 'Move', resolution: '768P' }).body.resolution.toLowerCase(), '768p');
    assert.equal(runway.buildVideoRequest({ model: 'gemini_omni_flash_1.1', prompt: 'Move', duration_auto: true }).body.duration, 'auto');
});
test('Runway accepts a selected resolution represented exactly by its native pixel ratio', async () => {
    const boundary = require('../lib/final-provider-request');
    const payload = { model: 'veo3.1', prompt: 'Repair movement', resolution: '720p', width: 1280, height: 720, keyframes: [uri, lastUri] };
    const resolved = await boundary.resolveFinalRequest('runway', 'video', payload);
    assert.equal(resolved.body.ratio, '1280:720');
    assert.equal(resolved.body.resolution, undefined);
    assert.equal(resolved.references.length, 2);
    const portrait = await boundary.resolveFinalRequest('runway', 'video', { ...payload, width: 720, height: 1280 });
    assert.equal(portrait.body.ratio, '720:1280');
    const uhd = await boundary.resolveFinalRequest('runway', 'video', { ...payload, model: 'gemini_omni_flash_1.1', duration_auto: true, resolution: '4k', width: 3840, height: 2160 });
    assert.equal(uhd.body.ratio, '3840:2160');
    for (const selected of [{ resolution: '4k' }, { resolution: 'unsupported' }, { ratio: '1920:1080' }]) {
        await assert.rejects(boundary.resolveFinalRequest('runway', 'video', { ...payload, ...selected }), /resolution/i);
    }
});
test('Runway multi-shot rejects excess custom shots and selected auto shots before preview', async () => {
    const shots = Array.from({ length: 6 }, (_, index) => ({ prompt: `Shot ${index}`, duration: 1 }));
    for (const selected of [{ mode: 'custom', shots }, { mode: 'auto', shots: shots.slice(0, 3) }, { mode: 'unsupported' }]) {
        const payload = { runway_recipe: 'multi_shot_video', prompt: 'Move', ...selected };
        assert.throws(() => runway.buildMultiShotRequest(payload), /shot|mode/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /shot|mode/i);
    }
    assert.equal(runway.buildMultiShotRequest({ mode: 'custom', shots: shots.slice(0, 5) }).body.shots.length, 5);
});
test('Runway multi-shot rejects selected image/audio references that the recipe does not consume', async () => {
    for (const selected of [{ reference_images: [uri] }, { referenceImages: [{ uri }] }, { audio_references: ['data:audio/wav;base64,YXVkaW8='] }, { keyframes: [uri] }, { init_image: uri }]) {
        const payload = { runway_recipe: 'multi_shot_video', mode: 'auto', prompt: 'Move', ...selected };
        assert.throws(() => runway.buildMultiShotRequest(payload), /reference|image|keyframe/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /reference|image|keyframe/i);
    }
    assert.equal(runway.buildMultiShotRequest({ mode: 'auto', prompt: 'Move', promptImage: uri }).body.promptImage, uri);
});
test('Runway multi-shot rejects selected technical options the recipe cannot send', () => {
    for (const selected of [{ duration_auto: true }, { resolution: '4k' }, { output_format: 'mp4' }]) {
        assert.throws(() => runway.buildMultiShotRequest({ mode: 'auto', prompt: 'Move', ...selected }), /duration_auto|resolution|output_format/i);
    }
});
test('Runway multi-shot rejects selected seed, generated audio and negatives instead of ignoring them', async () => {
    for (const selected of [{ seed: 0 }, { seed: 9 }, { audio: true }, { generate_audio: true }, { negative_prompt: 'No blur' }, { video_negative_prompt: 'No blur' }]) {
        const payload = { runway_recipe: 'multi_shot_video', mode: 'auto', prompt: 'Move', ...selected };
        assert.throws(() => runway.buildMultiShotRequest(payload), /seed|audio|negative/i);
        await assert.rejects(require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', payload), /seed|audio|negative/i);
    }
    assert.equal(runway.buildMultiShotRequest({ mode: 'auto', prompt: 'Move', seed: null, audio: false, negative_prompt: null }).body.prompt, 'Move');
    const resolved = await require('../lib/final-provider-request').resolveFinalRequest('runway', 'video', { runway_recipe: 'multi_shot_video', mode: 'auto', prompt: 'Original', audio: false, negative_prompt: null, final_prompt: 'Exact approved final text' });
    assert.equal(resolved.body.prompt, 'Exact approved final text');
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
async function withRunwayRequest(run) {
    const contract = require('../lib/final-request-review');
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec(fs.readFileSync(path.join(__dirname, '../db/migrations/141_final_request_reviews.sql'), 'utf8'));
    const store = contract.createFinalRequestStore(db, { provenance: () => ({ fixture: 'runway-timeout' }) });
    const originalStore = contract.store;
    const originalFetch = global.fetch;
    const originalKey = process.env.RUNWAY_API_KEY;
    process.env.RUNWAY_API_KEY = 'mock-only';
    contract.store = () => store;
    try {
        const review = await store.preview({ provider: 'runway', capability: 'image',
            payload: { model: 'gen4_image', prompt: 'Approved prompt', width: 1280, height: 720 } });
        const finalRequest = store.approve(review.id, { fingerprint: review.fingerprint,
            human_confirmed: true, cost_unknown_ack: true });
        return await run(require('../lib/providers/runway').adapter, finalRequest);
    } finally {
        contract.store = originalStore;
        global.fetch = originalFetch;
        db.close();
        if (originalKey === undefined) delete process.env.RUNWAY_API_KEY; else process.env.RUNWAY_API_KEY = originalKey;
    }
}

test('Runway aborts a stalled POST within the budget and reports unknown acceptance without retry', async () => {
    await withRunwayRequest(async (adapter, finalRequest) => {
        let posts = 0;
        const handles = [];
        global.fetch = (url, init) => { posts++; return stallUntilAbort(init); };
        const started = Date.now();
        const out = await adapter.generate('image', {}, { finalRequest, timeout: 30, onHandle: id => handles.push(id) });
        assert.equal(out.status, 504, out.error);
        assert.equal(out.acceptanceUnknown, true);
        assert.match(out.error, /acceptance|accepted|unknown/i);
        assert.equal(posts, 1);
        assert.deepEqual(handles, []);
        assert(Date.now() - started < 1000);
    });
});
test('Runway aborts a stalled poll and retains the submitted handle for collection', async () => {
    await withRunwayRequest(async (adapter, finalRequest) => {
        let posts = 0, polls = 0;
        const handles = [];
        global.fetch = (url, init) => {
            if (init.method === 'POST') { posts++; return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'accepted-task' }) }); }
            polls++; return stallUntilAbort(init);
        };
        const out = await adapter.generate('image', {}, { finalRequest, timeout: 30, onHandle: id => handles.push(id), onTimeout: (id, budget) => ({ ok: false, pending: true, request_id: id, budget }) });
        assert.equal(out.pending, true, out.error);
        assert.equal(out.request_id, 'accepted-task');
        assert.equal(out.budget, 30);
        assert.deepEqual(handles, ['accepted-task']);
        assert.equal(posts, 1);
        assert.equal(polls, 1);
    });
});
test('Runway bounds the POST response body as well as waiting for headers', async () => {
    await withRunwayRequest(async (adapter, finalRequest) => {
        let posts = 0;
        global.fetch = async (url, init) => {
            posts++;
            return { ok: true, status: 200, json: () => stallUntilAbort(init) };
        };
        const out = await adapter.generate('image', {}, { finalRequest, timeout: 30 });
        assert.equal(out.status, 504, out.error);
        assert.equal(out.acceptanceUnknown, true);
        assert.equal(posts, 1);
    });
});
test('Runway collection aborts a stalled GET without submitting another paid task', async () => {
    await withRunwayRequest(async (adapter, finalRequest) => {
        let gets = 0;
        global.fetch = (url, init) => {
            assert.notEqual(init.method, 'POST');
            assert.match(String(url), /\/tasks\/accepted-task$/);
            gets++;
            return stallUntilAbort(init);
        };
        const out = await adapter.collect('accepted-task', { timeout: 30 });
        assert.equal(out.status, 504, out.error);
        assert.equal(gets, 1);
    });
});
