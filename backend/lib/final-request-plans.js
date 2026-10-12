'use strict';
// Pure planning: complete every item before the approval UI opens or any job is inserted.
const { db } = require('../db/database');
function shotProvenance(id) {
    const row = db.prepare('SELECT s.id AS shot_id, sc.project_id FROM film_shots s JOIN film_scenes sc ON sc.id=s.scene_id WHERE s.id=?').get(id);
    if (!row) throw Object.assign(new Error('Shot not found'), { status: 404 });
    return row;
}
async function boardItem(id, body) {
    const draft = await require('./production-draft-request').plannedDraft(db, id, body, 'image');
    if (draft) return { provider: draft.provider, capability: 'image', payload: draft.payload, provenance: draft.provenance };
    const result = await require('../routes/storyboard').realBoardRequest(id, body);
    if (!result.preview || !result.preview.provider || !result.preview.payload) {
        throw Object.assign(new Error(result.error || 'No final storyboard adapter request could be prepared'), { status: result.status || 409 });
    }
    const expressionSelections=(result.preview.payload.reference_images || []).filter(r=>r.reference_role==='expression').map(r=>({character_id:r.character_id,slot_id:r.expression_slot_id,asset_id:r.asset_id,revision:r.expression_revision,label:r.expression_label,direction:r.expression_direction,reference_role:'expression',framing:'face_closeup'}));
    return { provider: result.preview.provider, capability: 'image', payload: result.preview.payload,
        provenance: { ...shotProvenance(id),source_paths:(result.references||result.preview.payload.reference_images||[]).map(r=>r.file_path||r.path).filter(Boolean), ...(expressionSelections.length?{expression_selections:expressionSelections}:{}), ...(body.seed==null ? { default_seed: true } : {}) } };
}
async function videoItem(id, body) {
    const draft = await require('./production-draft-request').plannedDraft(db, id, body, 'video');
    if (draft) return { provider: draft.provider, capability: 'video', payload: draft.payload, provenance: draft.provenance };
    const plan = require('../routes/video-gen').buildVideoGenerationPlan(id, body);
    if (!plan.videoProvider || !plan.videoProvider.id) throw Object.assign(new Error('No explicit video provider could be resolved'), { status: 409 });
    const normalized=await plan.videoProvider.generate('video',plan.payload,{previewRequest:true});
    if(!normalized?.preview)throw Object.assign(new Error(normalized?.error||'Video provider did not stop at preview'),{status:409});
    return { provider: plan.videoProvider.id, capability: 'video', payload: normalized.payload,
        provenance: shotProvenance(id) };
}
async function prepare({ path, body = {} }) {
    const clean = String(path || '').split('?')[0];
    const pipeline = await require('./final-pipeline-request-plans').preparePipelineRequests({path:clean,body});
    if(pipeline)return pipeline;
    const threeD = await require('./final-threed-request-plans').prepareThreeDRequests({path:clean,body});
    if(threeD)return threeD;
    const footage = await require('./final-footage-request-plans').prepareFootageRequests({path:clean,body});
    if(footage)return footage;
    const subject = await require('./final-subject-request-plans').prepareSubjectRequests({path:clean,body});
    if(subject)return subject;
    const flow = await require('./final-flow-request-plans').prepareFlowRequests({path:clean,body});
    if(flow)return flow;
    let match = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/storyboard\/regenerate$/);
    if (match) return { supported: true, items: [await boardItem(match[1], body)] };
    match = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/storyboard-upscale$/);
    if (match) {
        const plan = require('./storyboard-upscale').store().plan(match[1], body.resolution, body.provider || 'muapi');
        const asset = db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(plan.source_asset_id);
        return { supported: true, items: [{ provider: 'muapi-upscale', capability: 'image-upscale', payload: { image: require('./reference-images').toDataUri(asset.file_path), resolution: plan.resolution }, provenance: {...shotProvenance(match[1]),source_paths:[asset.file_path]} }] };
    }
    match = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/storyboard\/(refine|recompose)$/);
    if (match) {
        const storyboard = require('../routes/storyboard');
        const result = await (match[2] === 'recompose' ? storyboard.realRecomposeRequest : storyboard.realRefineRequest)(match[1], body);
        if (!result.preview) throw Object.assign(new Error(result.error || 'Refine request refused'), { status: result.status || 409 });
        return { supported: true, items: [{ provider: result.preview.provider, capability: 'image', payload: result.preview.payload, provenance: {...shotProvenance(match[1]),source_paths:(result.preview.payload.reference_images||[]).map(r=>r.file_path||r.path).filter(Boolean)} }] };
    }
    match = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/video\/generate(?:\/stream)?$/);
    if (match) return { supported: true, items: [await videoItem(match[1], body)] };
    match=clean.match(/^\/(?:film\/)?sequences\/([^/]+)\/(inbetweens|stations)(?:\/([^/]+)\/(\d+))?$/);
    if(match)return await require('../routes/sequences').realStationRequests(match[1],body,match[3],match[4]);
    match = clean.match(/^\/(?:film\/)?sequences\/([^/]+)\/(generate|generate-native)$/);
    if(match) return {supported:true,...await require('../routes/sequences').realSequenceRequests(match[1],body,match[2]==='generate-native')};
    match = clean.match(/^\/(?:film\/)?inbetweens\/([^/]+)\/generate$/);
    if(match)return await require('../routes/inbetweens').realFrameRequest(match[1],body);
    match = clean.match(/^\/(?:film\/)?inbetweens\/([^/]+)\/video$/);
    if (match) {
        const module = require('../routes/inbetweens'), loaded = module.load(match[1]);
        if (!loaded) throw Object.assign(new Error('In-betweens not found'), { status: 404 });
        const plan = module.buildVideoCalls(loaded, body);
        const items=[];
        for(const [index,call] of plan.calls.entries()){const normalized=await plan.provider.generate('video',call.payload,{previewRequest:true});if(!normalized?.preview)throw new Error(normalized?.error||'Provider did not stop at preview');items.push({provider:plan.provider.id,capability:'video',payload:normalized.payload,provenance:{project_id:plan.project.id,inbetween_id:match[1],item_index:index,source_paths:plan.plan._points.map(p=>p.path).filter(Boolean),source_shot_ids:[loaded.row.from_shot_id,loaded.row.to_shot_id]}});}
        return {supported:true,items};
    }
    match = clean.match(/^\/(?:film\/)?projects\/([^/]+)\/(storyboard\/generate|video\/batch)(?:\/stream)?$/);
    if (match) {
        const projectId = match[1];
        if (!db.prepare('SELECT id FROM film_projects WHERE id=?').get(projectId)) throw Object.assign(new Error('Project not found'), { status: 404 });
        const planned = match[2].startsWith('storyboard')
            ? await require('../routes/storyboard').realBatchBoardRequests(projectId, body, clean.endsWith('/stream'))
            : await require('../routes/video-gen').realBatchVideoRequests(projectId, body);
        return {supported:true,items:planned.items};
    }
    if (/\/inbetweens\/[^/]+\/generate$/.test(clean) || /\/sequences\/[^/]+\/inbetweens/.test(clean)) {
        throw Object.assign(new Error('This image chain uses a newly generated frame as the next reference. Each next frame needs a fresh final review after the previous result exists. Nothing was submitted.'), { status: 409, code: 'FINAL_REQUEST_REVIEW_UNSUPPORTED' });
    }
    throw Object.assign(new Error('This generation path does not yet support an exact final request review. Nothing was submitted.'), { status: 409, code: 'FINAL_REQUEST_REVIEW_UNSUPPORTED' });
}
module.exports = { prepare, boardItem, videoItem };
