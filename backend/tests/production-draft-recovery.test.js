'use strict';
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

test.after(() => { global.fetch = originalFetch; db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
