'use strict';
require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-production-draft-'));
process.env.FILM_DATA_DIR = temp;
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const recipes = require('../lib/production-recipes');
const plans = require('../lib/final-request-plans');
const review = require('../lib/final-request-review');
require('../lib/providers/credentials').getCredential = id => ({ apiKey: ['muapi', 'seedance', 'runway', 'openai'].includes(id) ? 'mock-only' : null, meta: {} });
const drafts = require('../lib/production-draft-request');
function fixture() {
    const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
    db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project, 'Draft fixture', JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2', video: 'seedance' }));
    db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene, project);
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot, scene, '1A', JSON.stringify({ description: 'Original composed description' }));
    return { project, scene, shot, key: `shot:${shot}` };
}
function image(f, version = 1) {
    const id = crypto.randomUUID(), file = path.join(temp, `${id}.png`);
    fs.writeFileSync(file, require('../lib/png-raster').encode({ width: 16, height: 16, pixels: Buffer.alloc(16 * 16 * 4, version) }));
    db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version,mime_type) VALUES(?,?,?,'storyboard',?,?,?,'image/png')").run(id, f.project, f.shot, file, path.basename(file), version);
    return { id, file };
}
function save(f, payload, revision = 0) {
    return recipes.saveDraft(db, f.project, f.key, { expected_revision: revision, payload });
}
function body(f, revision = 1) { return { production_draft: { node_key: f.key, revision } }; }
async function approval(f, capability = 'image', revision = 1) {
    const route = capability === 'image' ? `/shots/${f.shot}/storyboard/regenerate` : `/shots/${f.shot}/video/generate`;
    const item = (await plans.prepare({ path: route, body: body(f, revision) })).items[0];
    const visible = await review.store().preview(item);
    const token = review.store().approve(visible.id, { human_confirmed: true, fingerprint: visible.fingerprint, cost_unknown_ack: true });
    return { route, visible, token };
}
async function request(route, payload, handler) {
    let status = 200, data;
    const res = { writeHead(code) { status = code; }, setHeader() {}, end(text) { data = JSON.parse(String(text)); } };
    await (handler || require('../routes/storyboard').handleStoryboard)({ method: 'POST', body: payload, headers: {} }, res, ['film', ...route.slice(1).split('/')], {});
    return { status, data };
}
function openaiRecipe(extra = {}) { return { provider: 'openai', model: 'gpt-image-1', prompt: 'The exact entire visible recipe.', size: '1024x1024', quality: 'low', reference_images: [], ...extra }; }
test('free final planner reads the saved image recipe, exact full prompt, reference order and settings', async () => {
    const f = fixture(), a = image(f), b = image(f, 2);
    save(f, { image: { provider: 'muapi', model: 'nano-banana-2', prompt: 'The exact complete draft prompt.', reference_images: [{ asset_id: b.id, reference_role: 'location' }, { asset_id: a.id, reference_role: 'character' }], settings: { width: 1024, height: 1024 } } });
    const result = await plans.prepare({ path: `/shots/${f.shot}/storyboard/regenerate`, body: body(f) });
    const item = result.items[0], visible = await review.store().preview(item);
    assert.equal(item.payload.prompt, 'The exact complete draft prompt.');
    assert.equal(visible.snapshot.body.prompt, item.payload.prompt);
    assert.deepEqual(visible.snapshot.references.map(r => r.asset_id), [b.id, a.id]);
    assert.deepEqual(visible.snapshot.references.map(r => r.role), ['location', 'character']);
    assert.equal(item.provenance.production_draft.revision, 1);
    assert.equal(item.provenance.production_draft.digest.length, 64);
});
test('concurrent draft revision fails before free preview or send', () => {
    const f = fixture(); save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'First', workflow: 'text-to-video' } });
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'Concurrent edit', workflow: 'text-to-video' } }, 1);
    assert.throws(() => drafts.resolveDraftRequest(db, f.shot, body(f), 'video'), /draft.*changed|revision/i);
});
test('a Google origin rerun retains the actual folded wire prompt through draft resolution', async () => {
    const payload={model:'gemini-3.1-flash-image',prompt:'A wet station at night.',negative_prompt:'daytime and crowds',reference_images:[]};
    const boundary=require('../lib/final-provider-request'),snapshot=await boundary.resolveFinalRequest('google','image',payload);
    const {recipeFromLineage}=await import('../../src/pages/productiongraph/lineage-model.js');
    const recipe=recipeFromLineage({status:'recorded',provider:'google',model:payload.model,approved:{body:snapshot.body,payload,references:[]}});
    assert.equal(recipe.prompt,snapshot.body.input.find(part=>part.type==='text').text);
    const f=fixture();save(f,{image:recipe});
    const plan=await drafts.plannedDraft(db,f.shot,body(f),'image');
    const rerun=await boundary.resolveFinalRequest(plan.provider,'image',plan.payload);
    assert.deepEqual(rerun.body,snapshot.body);
});
test('unsupported audio conditioning and timeline edits in a conditioning reference fail explicitly', async () => {
    const f = fixture(), id = crypto.randomUUID(), file = path.join(temp, `${id}.wav`); fs.writeFileSync(file, 'full audio bytes');
    db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,mime_type,duration_ms) VALUES(?,?,'audio_sfx',?,?,'audio/wav',9000)").run(id, f.project, file, path.basename(file));
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'Listen', workflow: 'image-to-video', audio_references: [{ asset_id: id, reference_role: 'dialogue' }] } });
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'video'), /audio|image/i);
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'Listen', workflow: 'omni-reference', audio_references: [{ asset_id: id, offset_ms: 100 }] } }, 1);
    assert.throws(() => drafts.resolveDraftRequest(db, f.shot, body(f, 2), 'video'), /offset|timeline|conditioning/i);
});
test('draft edits, selected source changes and reference byte changes invalidate approved consent before HTTP', async () => {
    const original = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw Error('Unexpected HTTP'); };
    try {
        for (const change of ['draft', 'selection', 'bytes']) {
            const f = fixture(), a = image(f), b = image(f, 2);
            db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);
            save(f, { image: openaiRecipe({ reference_images: [{ asset_id: a.id, reference_role: 'character' }] }) });
            const reviewed = await approval(f);
            if (change === 'draft') save(f, { image: openaiRecipe({ prompt: 'Edited later' }) }, 1);
            if (change === 'selection') db.prepare('UPDATE film_shots SET current_frame_version=2 WHERE id=?').run(f.shot);
            if (change === 'bytes') fs.writeFileSync(a.file, fs.readFileSync(b.file));
            const before = db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n;
            const sent = await request(reviewed.route, { ...body(f), final_request_approvals: [reviewed.token] });
            assert.ok(sent.status >= 400, JSON.stringify(sent));
            assert.equal(db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n, before);
        }
        assert.equal(calls, 0);
    } finally { global.fetch = original; }
});
test('actual shot draft route sends the approved full request once and files identity-linked new immutable versions', async () => {
    const f = fixture(), prior = image(f); db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);
    save(f, { image: openaiRecipe() });
    const approved = await approval(f), original = global.fetch, posts = [];
    const produced = require('../lib/png-raster').encode({ width: 16, height: 16, pixels: Buffer.alloc(16 * 16 * 4, 200) });
    global.fetch = async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: produced.toString('base64') }] }) }; };
    try {
        const first = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] });
        assert.equal(first.status, 200, JSON.stringify(first)); assert.equal(posts.length, 1);
        assert.deepEqual(posts[0].body, approved.visible.snapshot.body);
        const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(first.data.asset_id);
        assert.equal(JSON.parse(asset.metadata).final_request_review_id, approved.visible.id);
        assert.equal(require('../lib/production-lineage').assetLineage(db, asset).review_id, approved.visible.id);
        assert.deepEqual(fs.readFileSync(prior.file), require('../lib/png-raster').encode({ width: 16, height: 16, pixels: Buffer.alloc(16 * 16 * 4, 1) }));
        assert.deepEqual(fs.readFileSync(asset.file_path), produced);
        const duplicate = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] });
        assert.equal(duplicate.status, 409); assert.equal(posts.length, 1);
        const next = await approval(f);
        const second = await request(next.route, { ...body(f), final_request_approvals: [next.token] });
        assert.equal(second.status, 200, JSON.stringify(second)); assert.equal(posts.length, 2);
        assert.notEqual(second.data.asset_id, first.data.asset_id);
        assert.notEqual(second.data.file_path, first.data.file_path);
        assert.equal(second.data.version, first.data.version + 1);
    } finally { global.fetch = original; }
});
test('cancel and double-send reject before another job or any paid request', async () => {
    const f = fixture(); save(f, { image: openaiRecipe() }); const approved = await approval(f);
    review.store().cancel(approved.visible.id); const original = global.fetch; let calls = 0;
    global.fetch = async () => { calls++; throw Error('Unexpected HTTP'); };
    try {
        const before = db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n;
        const sent = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] });
        assert.equal(sent.status, 409); assert.equal(calls, 0);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_generation_jobs').get().n, before);
    } finally { global.fetch = original; }
});
test('a result arriving after a new selection is retained in original shot history without taking selection', async () => {
    const f = fixture(), a = image(f), b = image(f, 2); db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);
    save(f, { image: openaiRecipe() }); const approved = await approval(f), original = global.fetch;
    const produced = fs.readFileSync(a.file);
    global.fetch = async () => {
        db.prepare('UPDATE film_shots SET current_frame_version=2 WHERE id=?').run(f.shot);
        return { ok: true, status: 200, json: async () => ({ data: [{ b64_json: produced.toString('base64') }] }) };
    };
    try {
        const sent = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] });
        assert.equal(sent.status, 200, JSON.stringify(sent)); assert.equal(sent.data.historical, true);
        assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version, 2);
        assert.equal(require('../lib/selected-frame').selectedFrame(db, f.shot).id, b.id);
        assert.equal(db.prepare('SELECT shot_id FROM film_assets WHERE id=?').get(sent.data.asset_id).shot_id, f.shot);
    } finally { global.fetch = original; }
});
test('cross-project references and explicit unsupported settings are refused without silent normalization', async () => {
    const f = fixture(), other = fixture(), wrong = image(other);
    save(f, { image: openaiRecipe({ reference_images: [{ asset_id: wrong.id }] }) });
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'image'), /project/);
    save(f, { image: openaiRecipe({ settings: { steps: 42 } }) }, 1);
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f, 2), 'image'), /unsupported.*steps/i);
});
test('a captured historical rerun uses its approved bytes after current plates change; detach and attach make a new recipe', async () => {
    const f = fixture(), source = image(f), a = image(f, 2), b = image(f, 3);
    save(f, { image: openaiRecipe({ reference_images: [{ asset_id: a.id, reference_role: 'character' }] }) });
    const approved = await approval(f);
    review.store().claim(approved.token, 'openai', 'image'); review.store().complete(approved.visible.id, { ok: true });
    db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify({ final_request_review_id: approved.visible.id }), source.id);
    const originalBytes = fs.readFileSync(a.file); fs.writeFileSync(a.file, fs.readFileSync(b.file));
    save(f, { image: { source_asset_id: source.id, provider: 'openai', model: 'gpt-image-1',
        reference_images: [{ captured_reference: { review_id: approved.visible.id, order: 1 }, reference_role: 'character' }] } }, 1);
    const historical = await drafts.plannedDraft(db, f.shot, body(f, 2), 'image');
    const visible = await review.store().preview({ provider: historical.provider, capability: 'image', payload: historical.payload, provenance: historical.provenance });
    assert.equal(visible.snapshot.references[0].sha256, crypto.createHash('sha256').update(originalBytes).digest('hex'));
    save(f, { image: openaiRecipe({ source_asset_id: source.id, reference_images: [{ asset_id: b.id, reference_role: 'location' }] }) }, 2);
    const changed = await drafts.plannedDraft(db, f.shot, body(f, 3), 'image');
    const newReview = await review.store().preview({ provider: changed.provider, capability: 'image', payload: changed.payload, provenance: changed.provenance });
    assert.equal(newReview.snapshot.references.length, 1); assert.equal(newReview.snapshot.references[0].asset_id, b.id);
    assert.equal(JSON.parse(db.prepare('SELECT metadata FROM film_assets WHERE id=?').get(source.id).metadata).final_request_review_id, approved.visible.id);
});
test('legacy missing provenance cannot invent a historical prompt and a new explicit recipe remains possible', async () => {
    const f = fixture(), source = image(f);
    save(f, { image: { source_asset_id: source.id, provider: 'openai', model: 'gpt-image-1' } });
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'image'), /legacy|full.*prompt/i);
    save(f, { image: openaiRecipe({ source_asset_id: source.id }) }, 1);
    assert.equal((await drafts.plannedDraft(db, f.shot, body(f, 2), 'image')).payload.prompt, openaiRecipe().prompt);
});
test('selected supported audio role and ordered full bytes reach approved versus actual transport; unsupported model sends nothing', async () => {
    const f = fixture(), audio = [], wav = Buffer.alloc(48);
    wav.write('RIFF', 0); wav.writeUInt32LE(40, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(4, 40);
    for (let index = 0; index < 2; index++) {
        const id = crypto.randomUUID(), file = path.join(temp, `${id}.wav`), bytes = Buffer.from(wav); bytes.writeInt16LE(index + 1, 44); fs.writeFileSync(file, bytes);
        db.prepare("INSERT INTO film_assets(id,project_id,asset_type,file_path,file_name,mime_type,duration_ms) VALUES(?,?,'audio_sfx',?,?,'audio/wav',1000)").run(id, f.project, file, path.basename(file)); audio.push({ id, bytes });
    }
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'My whole request', workflow: 'omni-reference', duration_s: 5,
        audio_references: [{ asset_id: audio[1].id, reference_role: 'dialogue' }, { asset_id: audio[0].id, reference_role: 'sound_reference' }] } });
    const approved = await approval(f, 'video'), original = global.fetch, posts = [], uploads = [];
    global.fetch = async (url, init) => {
        if (String(url).endsWith('/upload_file')) { uploads.push(Buffer.from(await init.body.get('file').arrayBuffer())); return { ok: true, status: 200, json: async () => ({ url: `https://mock.invalid/audio-${uploads.length}` }) }; }
        posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: false, status: 400, json: async () => ({ error: 'Mock ends after creative transport' }) };
    };
    try {
        const sent = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] }, require('../routes/video-gen').handleVideoGen);
        assert.equal(sent.status, 400, JSON.stringify(sent)); assert.equal(posts.length, 1); assert.equal(uploads.length, 2);
        assert.deepEqual(uploads, [audio[1].bytes, audio[0].bytes]);
        const refs = approved.visible.snapshot.references.filter(r => r.mime.startsWith('audio/'));
        assert.deepEqual(refs.map(r => r.role), ['dialogue', 'sound_reference']); assert.deepEqual(refs.map(r => r.byte_length), [48,48]);
        assert.deepEqual(posts[0].body, { ...approved.visible.snapshot.body, audios_list: ['https://mock.invalid/audio-1','https://mock.invalid/audio-2'] });
        const transport = db.prepare('SELECT * FROM film_generation_transport_receipts WHERE review_id=?').get(approved.visible.id);
        assert.deepEqual(JSON.parse(transport.references_json).map(r => r.role), ['dialogue','sound_reference']);
        save(f, { video: { provider: 'runway', model: 'gen4_turbo', prompt: 'Other model', audio_references: [{ asset_id: audio[0].id }] } }, 1);
        await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f, 2), 'video'), /audio|takes no|supports|requires/i);
        assert.equal(posts.length, 1);
    } finally { global.fetch = original; }
});
test('sequence draft free preview and paid route use the same saved recipe and preserve original member evidence', async () => {
    const f = fixture(), id = crypto.randomUUID(), key = `seq:${id}`;
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(id, f.project, 'Narrative sequence', JSON.stringify([f.shot]));
    recipes.saveDraft(db, f.project, key, { expected_revision: 0, payload: { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'Complete sequence direction', workflow: 'text-to-video', duration_s: 5 } } });
    const draftBody = { production_draft: { node_key: key, revision: 1 } }, route = `/sequences/${id}/generate-native`;
    const item = (await plans.prepare({ path: route, body: draftBody })).items[0];
    const visible = await review.store().preview(item), token = review.store().approve(visible.id, { human_confirmed: true, fingerprint: visible.fingerprint, cost_unknown_ack: true });
    assert.equal(visible.snapshot.body.prompt, 'Complete sequence direction'); assert.deepEqual(item.provenance.source_shot_ids, [f.shot]);
    const original = global.fetch, posts = [];
    global.fetch = async (url, init) => { posts.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: false, status: 400, json: async () => ({ error: 'Mock ends after creative transport' }) }; };
    try {
        const sent = await request(route, { ...draftBody, final_request_approvals: [token] }, require('../routes/sequences').handleSequences);
        assert.equal(sent.status, 400, JSON.stringify(sent)); assert.deepEqual(posts[0].body, visible.snapshot.body);
        const job = db.prepare("SELECT * FROM film_generation_jobs WHERE json_extract(meta,'$.approval_id')=?").get(visible.id);
        const delivery = JSON.parse(job.meta).production_delivery;
        assert.equal(delivery.sequence_id, id); assert.equal(delivery.node_key, key); assert.deepEqual(delivery.source_shot_ids, [f.shot]);
    } finally { global.fetch = original; }
});
test('free current-source starter preserves Moodboard identity, full prompt and exact bytes without a review/write', async () => {
    const f = fixture(), plate = image(f), lookId = crypto.randomUUID();
    db.prepare('INSERT INTO film_mood_board(id,project_id,image_path,asset_id,active,influence_roles,influence_note) VALUES(?,?,?,?,1,?,?)')
        .run(lookId, f.project, plate.file, plate.id, JSON.stringify(['lighting']), 'Warm window light');
    const before = db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n;
    const original = global.fetch; let calls = 0; global.fetch = async () => { calls++; throw Error('Unexpected HTTP'); };
    try {
        const starter = await drafts.starterDraft(db, f.project, f.key, 'image');
        assert.equal(starter.ready, true, JSON.stringify(starter.unresolved));
        assert.equal(starter.recipe.reference_images.length, 1);
        assert.equal(starter.recipe.reference_images[0].asset_id, plate.id);
        assert.equal(starter.recipe.reference_images[0].moodboard_entry_id, lookId);
        assert.equal(starter.recipe.reference_images[0].sha256, crypto.createHash('sha256').update(fs.readFileSync(plate.file)).digest('hex'));
        assert(starter.recipe.prompt.includes('Warm window light'));
        save(f, { image: starter.recipe });
        const plan = await drafts.plannedDraft(db, f.shot, body(f), 'image');
        assert.equal(plan.payload.prompt, starter.recipe.prompt);
        assert.equal(plan.payload.reference_images.length, 1);
        assert.equal(plan.payload.reference_images[0].uri, starter.recipe.reference_images[0].uri);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n, before); assert.equal(calls, 0);
        fs.writeFileSync(plate.file, 'changed source');
        await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'image'), /source.*changed|captured.*changed/i);
    } finally { global.fetch = original; }
});
test('combined explicit start frame and Moodboard plates keep both ordered references', async () => {
    const f = fixture(), start = image(f), look = image(f, 2), lookId = crypto.randomUUID();
    db.prepare('INSERT INTO film_mood_board(id,project_id,image_path,asset_id,active,influence_roles,influence_note) VALUES(?,?,?,?,1,?,?)')
        .run(lookId, f.project, look.file, look.id, JSON.stringify(['lighting']), 'Warm light');
    const instruction = require('../lib/moodboard-influence').instruction({ influence_roles: ['lighting'], influence_note: 'Warm light' }, 2);
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: `Move slowly. ${instruction}`, workflow: 'omni-reference',
        init_image: { asset_id: start.id, reference_role: 'keyframe' }, reference_images: [{ asset_id: look.id, moodboard_entry_id: lookId, influence_roles: ['lighting'], influence_note: 'Warm light', reference_role: 'style' }] } });
    const plan = await drafts.plannedDraft(db, f.shot, body(f), 'video');
    const visible = await review.store().preview({ provider: plan.provider, capability: 'video', payload: plan.payload, provenance: plan.provenance });
    assert.equal(visible.snapshot.references.length, 2);
    assert.deepEqual(visible.snapshot.references.map(r => r.sha256), [start,look].map(r => crypto.createHash('sha256').update(fs.readFileSync(r.file)).digest('hex')));
});
test('native sequence starter preserves actual shots JSON and its single source role through saved preview', async () => {
    const f = fixture(), frame = image(f), ids = [f.shot];
    for (const code of ['1B','1C']) {
        const id = crypto.randomUUID(); ids.push(id);
        db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(id, f.scene, code, JSON.stringify({ description: `Direction for ${code}` }));
        image({ ...f, shot: id },ids.length);
    }
    const id = crypto.randomUUID(), key = `seq:${id}`;
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({ image: 'muapi', video: 'runway', video_model: 'gen4_turbo' }), f.project);
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(id, f.project, 'Native three shot sequence', JSON.stringify(ids));
    const initial = (await require('../routes/sequences').realSequenceRequests(id, {}, true)).items[0];
    const original = await require('../lib/final-provider-request').resolveFinalRequest(initial.provider, 'video', initial.payload);
    const starter = await drafts.starterDraft(db, f.project, key, 'video');
    assert.equal(starter.ready, true, JSON.stringify(starter.unresolved));
    assert.equal(starter.recipe.prompt_format, 'native_shots_json');
    assert.deepEqual(JSON.parse(starter.recipe.prompt), original.body.shots);
    assert.equal(starter.recipe.promptImage.asset_id, frame.id);
    assert.equal(starter.recipe.reference_images.length, 0);
    recipes.saveDraft(db, f.project, key, { expected_revision: 0, payload: { video: starter.recipe } });
    const saved = await drafts.plannedDraft(db, id, { production_draft: { node_key: key, revision: 1 } }, 'video', 'sequence');
    assert.equal(saved.payload.prompt_format, undefined); assert.equal(saved.payload.final_prompt, undefined);
    const snapshot = await require('../lib/final-provider-request').resolveFinalRequest(saved.provider, 'video', saved.payload);
    assert.deepEqual(snapshot.body, original.body);
    assert.deepEqual(snapshot.references.map(ref => [ref.role,ref.sha256]), original.references.map(ref => [ref.role,ref.sha256]));
    const edited = JSON.parse(starter.recipe.prompt); edited[1].prompt = 'The user edited the exact second shot prompt.';
    recipes.saveDraft(db, f.project, key, { expected_revision: 1, payload: { video: { ...starter.recipe, prompt: JSON.stringify(edited) } } });
    const second = await drafts.plannedDraft(db, id, { production_draft: { node_key: key, revision: 2 } }, 'video', 'sequence');
    assert.deepEqual(second.payload.shots, edited);
    const visible = await review.store().preview({ provider:second.provider,capability:'video',payload:second.payload,provenance:second.provenance });
    const token = review.store().approve(visible.id,{ human_confirmed:true,fingerprint:visible.fingerprint,cost_unknown_ack:true });
    const fetchBefore = global.fetch, posts = [];
    global.fetch = async (url,init) => { posts.push({ url:String(url),body:JSON.parse(init.body) }); return { ok:false,status:422,json:async()=>({ error:'mock provider refusal after recording exact request' }),text:async()=> 'mock refusal' }; };
    try {
        const sent = await request(`/sequences/${id}/generate-native`,{ production_draft:{ node_key:key,revision:2 },final_request_approvals:[token] },require('../routes/sequences').handleSequences);
        assert.ok(sent.status >= 400,JSON.stringify(sent));
        assert.equal(posts.length,1); assert(posts[0].url.endsWith('/recipes/multi_shot_video'));
        assert.deepEqual(posts[0].body,visible.snapshot.body); assert.equal(posts[0].body.prompt,undefined);
    } finally { global.fetch=fetchBefore; }
    const tooLong = edited.map(shot=>({ ...shot })); tooLong[0].prompt='x'.repeat(1001);
    recipes.saveDraft(db,f.project,key,{ expected_revision:2,payload:{ video:{ ...starter.recipe,prompt:JSON.stringify(tooLong) } } });
    await assert.rejects(()=>drafts.plannedDraft(db,id,{ production_draft:{ node_key:key,revision:3 } },'video','sequence'),/prompts.*durations.*supported|shorten/i);
});
test('explicit recipe settings override project image defaults without adding detached inputs', async () => {
    const f = fixture();
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2', image_options: { quality: 'high', size: '1536x1024' } }), f.project);
    save(f, { image: openaiRecipe({ settings: { quality: 'low', size: '1024x1024' } }) });
    const plan = await drafts.plannedDraft(db, f.shot, body(f), 'image');
    assert.equal(plan.provider, 'openai'); assert.equal(plan.payload.model, 'gpt-image-1');
    assert.equal(plan.payload.quality, 'low'); assert.equal(plan.payload.size, '1024x1024');
    assert.deepEqual(plan.payload.reference_images, []);
});
test('new generated image retains its actual PNG media type and dimensions', async () => {
    const f = fixture(); save(f, { image: openaiRecipe() });
    const approved = await approval(f), plan = drafts.resolveDraftRequest(db,f.shot,body(f),'image');
    const buffer = require('../lib/png-raster').encode({ width: 24,height: 18,pixels: Buffer.alloc(24 * 18 * 4,100) });
    const filed = drafts.fileProductionDraftFrame(db,{ delivery: drafts.deliveryOf(plan,'image'),result: { final_request_review_id: approved.visible.id },bytes: buffer });
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(filed.asset_id);
    assert.equal(asset.mime_type,'image/png'); assert.equal(asset.format,'png');
    assert.equal(asset.width,24); assert.equal(asset.height,18); assert.deepEqual(fs.readFileSync(asset.file_path),buffer);
});
test('legacy sequence reruns file new versions and adopt repeated delivery without rewriting earlier origins', () => {
    const f = fixture(), sequenceId = crypto.randomUUID(), nextShot = crypto.randomUUID();
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code) VALUES(?,?,?)').run(nextShot,f.scene,'1B');
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(sequenceId,f.project,'Two shot legacy sequence',JSON.stringify([f.shot,nextShot]));
    const helpers = require('../lib/sequence-delivery'), firstJob = crypto.randomUUID(), secondJob = crypto.randomUUID();
    const firstName = helpers.clipFileName(sequenceId,'1A','1B',firstJob), secondName = helpers.clipFileName(sequenceId,'1A','1B',secondJob);
    const firstFile = path.join(temp,`${firstJob}.mp4`), secondFile = path.join(temp,`${secondJob}.mp4`);
    fs.writeFileSync(firstFile,'first immutable video including sound'); fs.writeFileSync(secondFile,'second immutable video including sound');
    const base = { projectId:f.project,sequenceId,shotId:f.shot,from:'1A',to:'1B' };
    const first = helpers.fileSequenceClip({ ...base,fileName:firstName,filePath:firstFile,jobId:firstJob,reviewId:'first-exact-review' });
    const before = db.prepare('SELECT * FROM film_assets WHERE id=?').get(first);
    const second = helpers.fileSequenceClip({ ...base,fileName:secondName,filePath:secondFile,jobId:secondJob,reviewId:'second-exact-review' });
    assert.notEqual(firstName,secondName); assert.notEqual(first,second);
    assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE id=?').get(first),before);
    assert.equal(fs.readFileSync(firstFile,'utf8'),'first immutable video including sound');
    const newer = db.prepare('SELECT * FROM film_assets WHERE id=?').get(second);
    assert.equal(newer.version,before.version+1);
    assert.equal(JSON.parse(newer.metadata).final_request_review_id,'second-exact-review');
    assert.equal(JSON.parse(newer.metadata).generation_job_id,secondJob);
    assert.equal(helpers.fileSequenceClip({ ...base,fileName:'ignored-retry-name.mp4',filePath:firstFile,jobId:secondJob,reviewId:'second-exact-review',extra:{ retry:'must not rewrite origin' } }),second);
    assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE id=?').get(second),newer);
    const latest = db.prepare("SELECT * FROM film_assets WHERE project_id=? AND asset_type='video_raw' AND json_extract(metadata,'$.sequence_id')=? AND json_extract(metadata,'$.from')='1A' AND json_extract(metadata,'$.to')='1B' ORDER BY version DESC,created_at DESC,rowid DESC LIMIT 1").get(f.project,sequenceId);
    assert.equal(latest.id,second);
});
test('legacy native result keeps captured membership and cannot replace a changed sequence selection', async () => {
    const f = fixture(), ids = [f.shot]; image(f);
    for (const code of ['1B','1C']) {
        const id = crypto.randomUUID(); ids.push(id);
        db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(id,f.scene,code,JSON.stringify({ description:`Original ${code}` })); image({ ...f,shot:id },ids.length);
    }
    const id = crypto.randomUUID(), old = crypto.randomUUID(), replacement = crypto.randomUUID(), file = path.join(temp,`${old}.mp4`);
    fs.writeFileSync(file,'old native sequence source including original sound');
    for (const asset of [old,replacement]) db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,?,1)").run(asset,f.project,f.shot,file,path.basename(file));
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({ video:'runway',video_model:'gen4_turbo' }),f.project);
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids,selected_video_asset_id,output_asset_id) VALUES(?,?,?,?,?,?)').run(id,f.project,'Native late sequence',JSON.stringify(ids),old,old);
    const route = `/sequences/${id}/generate-native`, item = (await plans.prepare({ path:route,body:{} })).items[0];
    const visible = await review.store().preview(item), token = review.store().approve(visible.id,{ human_confirmed:true,fingerprint:visible.fingerprint,cost_unknown_ack:true });
    const fetchBefore = global.fetch, posts = [], raw = Buffer.from('new complete native sequence bytes including sound');
    global.fetch = async (url,init={}) => {
        const address = String(url);
        if (address.includes('/tasks/native-late')) return { ok:true,status:200,json:async()=>({ status:'SUCCEEDED',output:['https://mock.invalid/native-late-output'] }) };
        if (address === 'https://mock.invalid/native-late-output') {
            db.prepare('UPDATE film_sequences SET shot_ids=?,selected_video_asset_id=?,output_asset_id=? WHERE id=?').run(JSON.stringify([...ids].reverse()),replacement,replacement,id);
            return { ok:true,status:200,arrayBuffer:async()=>raw };
        }
        posts.push(JSON.parse(init.body)); return { ok:true,status:200,json:async()=>({ id:'native-late' }) };
    };
    try {
        const sent = await review.runWithApprovals([token],()=>request(route,{ final_request_approvals:[token] },require('../routes/sequences').handleSequences));
        assert.equal(sent.status,200,JSON.stringify(sent)); assert.equal(sent.data.historical,true);
        assert.deepEqual(posts,[visible.snapshot.body]);
        const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(sent.data.asset_id), metadata = JSON.parse(asset.metadata);
        assert.deepEqual(metadata.original_shot_ids,ids); assert.equal(metadata.final_request_review_id,visible.id);
        assert.equal(asset.shot_id,ids[0]); assert.deepEqual(fs.readFileSync(asset.file_path),raw);
        assert.equal(asset.duration_ms,visible.snapshot.body.duration*1000);
        const row = db.prepare('SELECT shot_ids,selected_video_asset_id,output_asset_id FROM film_sequences WHERE id=?').get(id);
        assert.deepEqual(JSON.parse(row.shot_ids),[...ids].reverse()); assert.equal(row.selected_video_asset_id,replacement); assert.equal(row.output_asset_id,replacement);
        const job = db.prepare("SELECT * FROM film_generation_jobs WHERE json_extract(meta,'$.approval_id')=?").get(visible.id);
        assert.equal(JSON.parse(job.delivered_json).asset_id,asset.id); assert.deepEqual(JSON.parse(job.meta).production_delivery.source_shot_ids,ids);
        const beforeAsset={...asset};
        const selection=await request(`/sequences/${id}/video/select`,{asset_id:asset.id},require('../routes/sequences').handleSequences);
        assert.equal(selection.status,409,JSON.stringify(selection));
        assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE id=?').get(asset.id),beforeAsset);
        assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_sequences WHERE id=?').get(id).selected_video_asset_id,replacement);
    } finally { global.fetch=fetchBefore; }
});
test('legacy leg with changed membership is historical and retains the captured source list', () => {
    const f = fixture(), next = crypto.randomUUID(), id = crypto.randomUUID();
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code) VALUES(?,?,?)').run(next,f.scene,'1B');
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(id,f.project,'Legacy leg late',JSON.stringify([f.shot,next]));
    const owner = recipes.nodeOwner(db,f.project,`seq:${id}`), baseline = drafts.selectionBaseline(db,owner);
    db.prepare('UPDATE film_sequences SET shot_ids=? WHERE id=?').run(JSON.stringify([next,f.shot]),id);
    const file = path.join(temp,`${id}.mp4`); fs.writeFileSync(file,'captured original leg media');
    const assetId = require('../lib/sequence-delivery').fileSequenceClip({ projectId:f.project,sequenceId:id,shotId:f.shot,from:'1A',to:'1B',filePath:file,jobId:'exact-late-leg',reviewId:'exact-review',baseline,sourceShotIds:[f.shot,next] });
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(assetId), metadata = JSON.parse(asset.metadata);
    assert.equal(metadata.historical,true); assert.deepEqual(metadata.original_shot_ids,[f.shot,next]); assert.equal(asset.shot_id,f.shot);
    assert.deepEqual(JSON.parse(db.prepare('SELECT shot_ids FROM film_sequences WHERE id=?').get(id).shot_ids),[next,f.shot]);
});
test('video draft result persists full source bytes and a changed selection keeps its earlier clip', async () => {
    const f = fixture(), oldId = crypto.randomUUID(), oldFile = path.join(temp, `${oldId}.mp4`); fs.writeFileSync(oldFile, 'original full video');
    db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,?,1)").run(oldId,f.project,f.shot,oldFile,path.basename(oldFile));
    db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(oldId,f.shot);
    save(f, { video: { provider: 'seedance', model: 'seedance-2.5', prompt: 'Full video request', workflow: 'text-to-video', duration_s: 5 } });
    const approved = await approval(f,'video'), original = global.fetch, posts = [], raw = Buffer.from('complete mock video bytes including original sound');
    const replacement = crypto.randomUUID();
    global.fetch = async (url, init = {}) => {
        const address = String(url);
        if (address.includes('/predictions/')) return { ok: true, status: 200, json: async () => ({ status: 'completed', outputs: ['https://mock.invalid/full-video'] }) };
        if (address === 'https://mock.invalid/full-video') {
            db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,?,2)").run(replacement,f.project,f.shot,oldFile,path.basename(oldFile));
            db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(replacement,f.shot);
            return { ok: true, status: 200, arrayBuffer: async () => raw };
        }
        posts.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ request_id: 'draft-video-success' }) };
    };
    try {
        const sent = await request(approved.route, { ...body(f), final_request_approvals: [approved.token] }, require('../routes/video-gen').handleVideoGen);
        assert.equal(sent.status,200,JSON.stringify(sent)); assert.equal(sent.data.historical,true); assert.deepEqual(posts,[approved.visible.snapshot.body]);
        const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(sent.data.asset_id);
        assert.equal(asset.version,3); assert.deepEqual(fs.readFileSync(asset.file_path),raw);
        assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_shots WHERE id=?').get(f.shot).selected_video_asset_id,replacement);
        assert.equal(JSON.parse(asset.metadata).final_request_review_id,approved.visible.id);
        const job = db.prepare("SELECT * FROM film_generation_jobs WHERE json_extract(meta,'$.approval_id')=?").get(approved.visible.id);
        assert.equal(JSON.parse(job.delivered_json).asset_id,asset.id);
    } finally { global.fetch=original; }
});
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
