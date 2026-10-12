'use strict';
// Final reviews reuse the paid route's payload planner. No provider call, upload,
// job insertion or source mutation happens here. Repair may populate a disposable
// local frame cache so its actual reference bytes exist before review.
async function prepareFootageRequests({ path, body = {} }) {
    const clean = String(path || '').split('?')[0];
    const repair = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/repair$/);
    if (repair) {
        const { Readable } = require('stream');
        const req = Readable.from([Buffer.from(JSON.stringify(body))]);
        req.method = 'POST'; req.finalPreviewOnly = true;
        let output, status;
        const res = { writeHead(value) { status = value; }, end(value) { output = JSON.parse(value); } };
        await require('../routes/repair').handleRepair(req, res, ['film', 'shots', repair[1], 'repair']);
        if (!output?.preview) throw Object.assign(new Error(output?.reason || output?.error || 'Repair cannot be prepared'), { status: status >= 400 ? status : 409 });
        const { db } = require('../db/database');
        const shot = db.prepare('SELECT s.*,sc.project_id FROM film_shots s JOIN film_scenes sc ON sc.id=s.scene_id WHERE s.id=?').get(repair[1]);
        const provider = require('./providers').resolve('video', require('./provider-config').providerConfigFor(shot.project_id));
        if (!['seedance', 'runway'].includes(provider.id)) throw Object.assign(new Error('Repair requires a supported immutable video adapter'), { status: 409 });
        // Repair travels between a first and a last frame at a Seedance-style tier. On
        // Runway that needs a model that takes both frames (veo3.1 unless one was named),
        // and the tier is carried by Runway's native ratio, not a resolution field.
        let payload = output.payload;
        if (provider.id === 'runway') {
            payload = { ...payload, model: payload.model || 'veo3.1' };
            delete payload.resolution; delete payload.width; delete payload.height;
        }
        const preview = await provider.generate('video', payload, { previewRequest: true });
        if (!preview.preview) throw Object.assign(new Error(preview.error || 'Repair request cannot be resolved'), { status: 409 });
        return { supported: true, items: [{ provider: provider.id, capability: 'video', payload: preview.payload,
            provenance: { project_id: shot.project_id, shot_id: shot.id, source_paths: output.source_paths,
                source_shot_ids: [shot.id, ...(body.bridge && body.next_shot_id ? [body.next_shot_id] : [])] } }] };
    }
    const match = clean.match(/^\/(?:film\/)?shots\/([^/]+)\/post\/(upscale|face-restore|color-grade)$/);
    if (!match) return null;
    const jobType = match[2].replaceAll('-', '_');
    const plan = require('../routes/post-production').buildPostStepRequest(match[1], jobType, body);
    if (plan.provider.id === 'topaz') throw Object.assign(new Error('Native Topaz video acceptance is outside this review implementation and remains disabled.'), { status: 409 });
    if (!['seedance', 'magnific'].includes(plan.provider.id)) throw Object.assign(new Error('This post-production provider does not support immutable final request review.'), { status: 409 });
    const preview = await plan.provider.generate('post', plan.payload, { previewRequest: true });
    if (!preview.preview) throw Object.assign(new Error(preview.error || 'Final post-production request could not be resolved'), { status: 409 });
    return { supported: true, items: [{ provider: plan.provider.id, capability: 'post', payload: preview.payload,
        provenance: { project_id: plan.scene.project_id, shot_id: plan.shot.id,
            source_paths: [plan.source.file_path], input_asset_id: plan.source.id,
            source_selection: { kind: 'post_video', shot_id: plan.shot.id, explicit_asset_id: body.asset_id || null } } }] };
}
module.exports = { prepareFootageRequests };
