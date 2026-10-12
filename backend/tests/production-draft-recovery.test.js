'use strict';
require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-draft-recovery-'));
process.env.FILM_DATA_DIR = temp;
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
const jobs = require('../lib/generation-jobs'), providers = require('../lib/providers');
const recipes = require('../lib/production-recipes'), drafts = require('../lib/production-draft-request');
const reviews = require('../lib/final-request-review');
const png = require('../lib/png-raster').encode({ width: 32, height: 18, pixels: Buffer.alloc(32 * 18 * 4, 177) });
const originalFetch = global.fetch;
global.fetch = async () => { throw new Error('A recovery test must never use real transport'); };
require('../lib/providers/credentials').getCredential = () => ({ apiKey: 'mock-only', meta: {} });

function fixture() {
    const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
    db.prepare('INSERT INTO film_projects(id,title) VALUES(?,?)').run(project, 'Draft recovery fixture');
    db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene, project);
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)').run(shot, scene, '1A', '{}');
    return { project, scene, shot, key: `shot:${shot}` };
}
async function receipt(f, capability = 'image', sequenceId = null) {
    const key = sequenceId ? `seq:${sequenceId}` : f.key;
    const provider = capability === 'image' ? 'muapi' : 'seedance';
    const payload = capability === 'image' ? { model: 'nano-banana-2', prompt: 'Exact recovered frame', reference_images: [] }
        : { model: 'seedance-2.5', workflow: 'text-to-video', prompt: 'Exact recovered footage', duration_s: 4 };
    const draft = recipes.saveDraft(db, f.project, key, { expected_revision: 0, payload: { [capability]: { provider, ...payload } } });
    const plan = drafts.resolveDraftRequest(db, sequenceId || f.shot, { production_draft: { node_key: key, revision: draft.revision } }, capability, sequenceId ? 'sequence' : 'shot');
    const delivery = drafts.deliveryOf(plan, capability);
    const review = await reviews.store().preview({ provider, capability, payload, provenance: plan.provenance });
    reviews.store().approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true, cost_unknown_ack: true });
    const meta = { approval_id: review.id, production_delivery: delivery };
    const jobId = jobs.record({ provider, capability, requestId: `mock:${review.id}`, projectId: f.project, shotId: sequenceId ? null : f.shot, meta });
    return { jobId, reviewId: review.id, delivery, provider, payload, meta };
}
function cache(r, data = png) { jobs.accepted(r.jobId, { ok: true, data, final_request_review_id: 'untrusted-result-id' }); }

test('late image collection files one immutable version for the captured target and approved identity', async () => {
    const f = fixture(), r = await receipt(f); cache(r);
    const a = await jobs.collect(r.jobId), b = await jobs.collect(r.jobId);
    assert.equal(a.ok, true, a.error);
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(a.asset_id);
    assert.ok(asset, 'accepted image was stored without a storyboard version');
    assert.equal(asset.shot_id, f.shot);
    assert.equal(asset.asset_type, 'storyboard');
    assert.deepEqual(fs.readFileSync(asset.file_path), png);
    assert.equal(JSON.parse(asset.metadata).final_request_review_id, r.reviewId);
    assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version, asset.version);
    assert.equal(b.asset_id, asset.id);
    assert.equal(b.already, 'completed');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 1);
});
test('late image retains the newer selected board and concurrent collectors share the filed version', async () => {
    const f = fixture(), r = await receipt(f), adapter = providers.get(r.provider), priorCollect = adapter.collect;
    const chosenId = crypto.randomUUID(), chosenPath = path.join(temp, `${chosenId}.png`); fs.writeFileSync(chosenPath, png);
    db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version,mime_type) VALUES(?,?,?,'storyboard',?,?,1,'image/png')").run(chosenId, f.project, f.shot, chosenPath, path.basename(chosenPath));
    db.prepare('UPDATE film_shots SET current_frame_version=1 WHERE id=?').run(f.shot);
    let polls = 0, release; const gate = new Promise(resolve => { release = resolve; });
    adapter.collect = async () => { polls++; await gate; return { ok: true, data: png }; };
    try {
        const first = jobs.collect(r.jobId), second = jobs.collect(r.jobId); release();
        const [a, b] = await Promise.all([first, second]);
        assert.equal(a.ok, true, a.error); assert.equal(a.asset_id, b.asset_id); assert.equal(polls, 1);
        assert.ok(a.frame?.historical);
        assert.equal(db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(f.shot).current_frame_version, 1);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE shot_id=?').get(f.shot).n, 2);
    } finally { adapter.collect = priorCollect; }
});
test('captured Production delivery refuses caller retargeting before polling', async () => {
    const f = fixture(), r = await receipt(f), adapter = providers.get(r.provider), priorCollect = adapter.collect;
    let polls = 0; adapter.collect = async () => { polls++; return { ok: true, data: png }; };
    try {
        const result = await jobs.collect(r.jobId, { belongs_to: { kind: 'storyboard_frame', shot_id: crypto.randomUUID() } });
        assert.equal(result.status, 409); assert.equal(polls, 0);
        const patch = await jobs.collect(r.jobId, { metaPatch: { sequence_id: crypto.randomUUID(), from: '1A', to: '1B' } });
        assert.equal(patch.status, 409); assert.equal(polls, 0);
    } finally { adapter.collect = priorCollect; }
});
test('shot video collection links the selected full file to the original request', async () => {
    const f = fixture(), r = await receipt(f, 'video'), bytes = Buffer.from('fixture-full-video-source'); cache(r, bytes);
    const result = await jobs.collect(r.jobId);
    assert.equal(result.ok, true, result.error);
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(result.asset_id);
    assert.ok(asset, 'video never linked to film_assets'); assert.equal(asset.asset_type, 'video_raw');
    assert.deepEqual(fs.readFileSync(asset.file_path), bytes);
    assert.equal(JSON.parse(asset.metadata).final_request_review_id, r.reviewId);
    assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_shots WHERE id=?').get(f.shot).selected_video_asset_id, asset.id);
});
test('sequence result keeps captured membership and does not replace a changed sequence', async () => {
    const f = fixture(), sequenceId = crypto.randomUUID();
    db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(sequenceId, f.project, 'Captured sequence', JSON.stringify([f.shot]));
    const r = await receipt(f, 'video', sequenceId), otherShot = crypto.randomUUID();
    db.prepare("INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,'{}')").run(otherShot, f.scene, '1B');
    db.prepare('UPDATE film_sequences SET shot_ids=? WHERE id=?').run(JSON.stringify([otherShot, f.shot]), sequenceId);
    cache(r, Buffer.from('fixture-sequence-full-source'));
    const result = await jobs.collect(r.jobId);
    assert.equal(result.ok, true, result.error);
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=?').get(result.asset_id);
    assert.ok(asset, 'sequence result has no immutable asset');
    const meta = JSON.parse(asset.metadata);
    assert.deepEqual(meta.original_shot_ids, [f.shot]); assert.equal(meta.sequence_id, sequenceId); assert.ok(meta.historical);
    assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_sequences WHERE id=?').get(sequenceId).selected_video_asset_id, null);
    assert.equal(require('../lib/conform').selectedClip(db, f.shot), null, 'historical sequence result became the implicit shot clip');
});
test('late historical media stays out of implicit selection and remains explicitly selectable', () => {
    const f = fixture(), frameId = crypto.randomUUID(), clipId = crypto.randomUUID();
    for (const [id, type] of [[frameId, 'storyboard'], [clipId, 'video_raw']]) {
        db.prepare('INSERT INTO film_assets(id,project_id,shot_id,asset_type,version,metadata) VALUES(?,?,?,?,3,?)')
            .run(id, f.project, f.shot, type, JSON.stringify({ historical: true }));
    }
    assert.equal(require('../lib/selected-frame').selectedFrame(db, f.shot), null);
    assert.equal(require('../lib/conform').selectedClip(db, f.shot), null);
    assert.equal(require('../lib/production-graph').buildGraph(db, f.project).nodes.find(n => n.id === f.shot).frames.some(frame => frame.selected), false);
    db.prepare('UPDATE film_shots SET current_frame_version=3,selected_video_asset_id=? WHERE id=?').run(clipId, f.shot);
    assert.equal(require('../lib/selected-frame').selectedFrame(db, f.shot).id, frameId);
    assert.equal(require('../lib/conform').selectedClip(db, f.shot).id, clipId);
});
test('completed request receipt recovers cached bytes without polling or creating a duplicate version', async () => {
    const f = fixture(), r = await receipt(f);
    db.prepare("UPDATE film_final_request_reviews SET state='completed',result_json=? WHERE id=?").run(JSON.stringify({ ok: true, data: png, _final_request_receipt: { job_meta: r.meta } }), r.reviewId);
    jobs.complete(r.jobId);
    const result = await jobs.collect(r.reviewId);
    assert.equal(result.ok, true, result.error);
    assert.ok(result.asset_id, 'completed receipt was treated as filed although it has no asset');
    assert.equal((await jobs.collect(r.jobId)).asset_id, result.asset_id);
});
test('a saved newer draft makes an in-flight image, video or sequence result historical', async () => {
    for (const kind of ['image','video','sequence']) {
        const f=fixture(), sequence=kind==='sequence'?crypto.randomUUID():null;
        if(sequence)db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(sequence,f.project,'Old recipe',JSON.stringify([f.shot]));
        const r=await receipt(f,kind==='image'?'image':'video',sequence),key=sequence?`seq:${sequence}`:f.key;
        const current=recipes.readDraft(db,f.project,key);
        recipes.saveDraft(db,f.project,key,{expected_revision:current.revision,payload:{...current.payload,revision_note:'new user work'}});
        cache(r,kind==='image'?png:Buffer.from('whole original video bytes'));
        const result=await jobs.collect(r.jobId);assert.equal(result.ok,true,result.error);
        assert.equal(JSON.parse(db.prepare('SELECT metadata FROM film_assets WHERE id=?').get(result.asset_id).metadata).historical,true);
        assert.equal(require('../lib/conform').selectedClip(db,f.shot),null);
        assert.equal(require('../lib/selected-frame').selectedFrame(db,f.shot),null);
    }
});
test('recovered Production video retains source sound bytes despite a silent generation policy', async () => {
    const f=fixture(),r=await receipt(f,'video'),bytes=Buffer.from('complete original clip with its sound stream');
    db.prepare('UPDATE film_generation_jobs SET meta=? WHERE id=?').run(JSON.stringify({...r.meta,audio:false}),r.jobId);
    cache(r,bytes);
    const result=await jobs.collect(r.jobId);assert.equal(result.ok,true,result.error);
    assert.deepEqual(fs.readFileSync(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(result.asset_id).file_path),bytes);
});
test('synchronous and collected filing adopt the same exact request identity for all Production results', async () => {
    for(const kind of ['image','video','sequence']) {
        const f=fixture(),sequence=kind==='sequence'?crypto.randomUUID():null;
        if(sequence)db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(sequence,f.project,'Concurrent delivery',JSON.stringify([f.shot]));
        const r=await receipt(f,kind==='image'?'image':'video',sequence),file=path.join(temp,`${r.jobId}.mp4`);
        fs.writeFileSync(file,'complete original video');
        const input={delivery:r.delivery,result:{ok:true},provider:r.provider,reviewId:r.reviewId,jobId:r.jobId,bytes:png,filePath:file};
        const save=kind==='image'?drafts.fileProductionDraftFrame:kind==='sequence'?drafts.fileProductionDraftSequence:drafts.fileProductionDraftVideo;
        const a=save(db,input),b=save(db,input);
        assert.equal(a.asset_id,b.asset_id);assert.equal(db.prepare('SELECT COUNT(*) n FROM film_assets WHERE project_id=?').get(f.project).n,1);
    }
});
test('stop waiting preserves a completed result as historical without selecting it', async () => {
    const f=fixture(),r=await receipt(f,'video');cache(r,Buffer.from('complete late video'));
    assert.equal((await require('../lib/generation-cancel').cancelJob(r.jobId)).mode,'stop_waiting');
    const result=await jobs.collect(r.jobId);assert.equal(result.ok,true,result.error);
    assert.equal(JSON.parse(db.prepare('SELECT metadata FROM film_assets WHERE id=?').get(result.asset_id).metadata).historical,true);
    assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_shots WHERE id=?').get(f.shot).selected_video_asset_id,null);
});
test('overlapping, reversed and nonconsecutive sequences retain paid results without changing the narrative cut', async () => {
    for(const mode of ['overlap','reversed','gap']) {
        const f=fixture(),b=crypto.randomUUID(),c=crypto.randomUUID(),sequence=crypto.randomUUID();
        for(const [id,code,order] of [[b,'1B',1],[c,'1C',2]])db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,sort_order) VALUES(?,?,?,?)').run(id,f.scene,code,order);
        const members=mode==='reversed'?[b,f.shot]:mode==='gap'?[f.shot,c]:[f.shot,b];
        db.prepare('INSERT INTO film_sequences(id,project_id,name,shot_ids) VALUES(?,?,?,?)').run(sequence,f.project,mode,JSON.stringify(members));
        let prior;
        if(mode==='overlap') {
            prior=crypto.randomUUID();
            db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version) VALUES(?,?,?,'video_raw','/prior.mp4',1)").run(prior,f.project,f.shot);
            require('../lib/clip-coverage').setCoverage(db,prior,members);
            db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(prior,f.shot);
        }
        const r=await receipt(f,'video',sequence);cache(r,Buffer.from('original sequence source'));
        const result=await jobs.collect(r.jobId);assert.equal(result.ok,true,result.error);
        const asset=db.prepare('SELECT * FROM film_assets WHERE id=?').get(result.asset_id),meta=JSON.parse(asset.metadata);
        assert.equal(meta.historical,true,mode);assert.deepEqual(meta.original_shot_ids,members);assert.equal(asset.shot_id,members[0]);
        assert.equal(db.prepare('SELECT selected_video_asset_id FROM film_sequences WHERE id=?').get(sequence).selected_video_asset_id,null);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_clip_coverage WHERE asset_id=?').get(asset.id).n,0);
        if(prior)assert.equal(db.prepare('SELECT COUNT(*) n FROM film_clip_coverage WHERE asset_id=?').get(prior).n,2);
        if(mode==='reversed') {
            let status,response;const before={...asset};
            await require('../routes/sequences').handleSequences({method:'POST',body:{asset_id:asset.id}},{writeHead(code){status=code;},end(body){response=JSON.parse(body);}},['film','sequences',sequence,'video','select'],{});
            assert.equal(status,409,JSON.stringify(response));
            assert.deepEqual(db.prepare('SELECT * FROM film_assets WHERE id=?').get(asset.id),before);
            assert.equal(db.prepare('SELECT COUNT(*) n FROM film_clip_coverage WHERE asset_id=?').get(asset.id).n,0);
        }
    }
});

test.after(() => { global.fetch = originalFetch; db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
