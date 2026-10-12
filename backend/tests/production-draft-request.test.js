'use strict';
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
test('cross-project references and explicit unsupported settings are refused without silent normalization', async () => {
    const f = fixture(), other = fixture(), wrong = image(other);
    save(f, { image: openaiRecipe({ reference_images: [{ asset_id: wrong.id }] }) });
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'image'), /project/);
    save(f, { image: openaiRecipe({ settings: { steps: 42 } }) }, 1);
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f, 2), 'image'), /unsupported.*steps/i);
});
test('legacy missing provenance cannot invent a historical prompt and a new explicit recipe remains possible', async () => {
    const f = fixture(), source = image(f);
    save(f, { image: { source_asset_id: source.id, provider: 'openai', model: 'gpt-image-1' } });
    await assert.rejects(() => drafts.plannedDraft(db, f.shot, body(f), 'image'), /legacy|full.*prompt/i);
    save(f, { image: openaiRecipe({ source_asset_id: source.id }) }, 1);
    assert.equal((await drafts.plannedDraft(db, f.shot, body(f, 2), 'image')).payload.prompt, openaiRecipe().prompt);
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
test('explicit recipe settings override project image defaults without adding detached inputs', async () => {
    const f = fixture();
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2', image_options: { quality: 'high', size: '1536x1024' } }), f.project);
    save(f, { image: openaiRecipe({ settings: { quality: 'low', size: '1024x1024' } }) });
    const plan = await drafts.plannedDraft(db, f.shot, body(f), 'image');
    assert.equal(plan.provider, 'openai'); assert.equal(plan.payload.model, 'gpt-image-1');
    assert.equal(plan.payload.quality, 'low'); assert.equal(plan.payload.size, '1024x1024');
    assert.deepEqual(plan.payload.reference_images, []);
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
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
