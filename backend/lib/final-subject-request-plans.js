'use strict';
// Reads existing state without creating jobs or changing any source file.
const { db } = require('../db/database');
function failure(message, status = 409) { throw Object.assign(new Error(message), { status }); }
async function item(provider, payload, projectId, kind, id, view, sourcePaths=[], itemIndex=0) {
    if (!provider || !provider.id) failure('No explicit subject image provider resolved');
    const preview = await provider.generate('image', payload, { previewRequest: true });
    if (!preview.preview) failure(preview.error || 'Subject provider cannot resolve final request');
    return { provider: provider.id, capability: 'image', payload: preview.payload,
        provenance: { project_id: projectId, subject_kind: kind, subject_id: id, view: view || '', item_index: itemIndex, source_paths: sourcePaths } };
}
async function prepareSubjectRequests({ path, body = {} }) {
    const clean = String(path || '').split('?')[0];
    const expressionMatch = clean.match(/^\/(?:film\/)?characters\/([^/]+)\/expressions\/(slot-[1-6])\/generate$/);
    if (expressionMatch) {
        const plan = require('./character-expressions').store().plan(expressionMatch[1],expressionMatch[2],body);
        const request = await item(plan.provider,plan.payload,plan.ch.project_id,'character',plan.ch.id,`expression:${plan.slot.slot_id}`,plan.sourcePaths);
        request.provenance.expression = plan.expression;
        return {supported:true,items:[request]};
    }
    let match = clean.match(/^\/(?:film\/)?(locations|props)\/([^/]+)\/plate\/(generate|refine)$/);
    if (match) {
        const kind = match[1] === 'locations' ? 'location' : 'prop', id = match[2];
        const routes = require('../routes/locations');
        if (match[3] === 'refine') {
            const plan = routes.buildSubjectRefineRequest(kind, id, body);
            return { supported: true, items: [await item(plan.provider, plan.payload, plan.subject.project_id, kind, id, plan.view, [plan.existing.file_path])] };
        }
        const plan = routes.buildSubjectGenerationRequest(kind, id, body);
        const built = require('./reference-plates').buildPlateGenerationPlan(plan.args);
        if (!built.ok) failure(built.error);
        return { supported: true, items: [await item(plan.provider, built.payload, plan.subject.project_id, kind, id, body.view, built.sourcePaths)] };
    }
    match = clean.match(/^\/(?:film\/)?(locations|props)\/([^/]+)\/image\/generate$/);
    if (match) {
        const kind = match[1] === 'locations' ? 'location' : 'prop', id = match[2];
        const subject = db.prepare(`SELECT * FROM film_${match[1]} WHERE id=?`).get(id);
        if (!subject) failure(`${kind} not found`, 404);
        const routes = require('../routes/locations');
        const plan = (kind === 'location' ? routes.buildLocationImageRequest : routes.buildPropImageRequest)(subject, body);
        return { supported: true, items: [await item(plan.provider, plan.payload, subject.project_id, kind, id, '')] };
    }
    match = clean.match(/^\/(?:film\/)?characters\/([^/]+)\/refsheet\/generate$/);
    if (match) {
        const id = match[1], ch = db.prepare('SELECT * FROM film_characters WHERE id=?').get(id);
        if (!ch) failure('Character not found', 404);
        const routes = require('../routes/characters');
        const views = body.views || routes.REFSHEET_VIEWS;
        if (!Array.isArray(views) || !views.length) failure('At least one character view is required', 400);
        const override = require('./generation-override').imageOverride(body);
        const config = require('./provider-config').spendContext({ id: ch.project_id }, null, null, override)
            || require('./provider-config').providerConfigFor(ch.project_id);
        const provider = require('./providers').resolve('image', config);
        return { supported: true, items: await Promise.all(views.map(async (view,itemIndex) => {
            const plan = routes.buildCharacterViewRequest(ch, view, body, provider);
            return item(provider, plan.payload, ch.project_id, 'character', id, view, plan.sourcePaths, itemIndex);
        })) };
    }
    match = clean.match(/^\/(?:film\/)?characters\/([^/]+)\/refsheet\/orbit$/);
    if (match) {
        const ch = db.prepare('SELECT * FROM film_characters WHERE id=?').get(match[1]);
        if (!ch) failure('Character not found', 404);
        const plan = require('../routes/characters').buildCharacterOrbitRequest(ch, body);
        const preview = await plan.provider.generate('video', plan.payload, { previewRequest: true });
        if (!preview.preview) failure(preview.error || 'Orbit final request unresolved');
        return { supported: true, items: [{ provider: plan.provider.id, capability: 'video', payload: preview.payload, provenance: { project_id: ch.project_id, subject_kind: 'character', subject_id: ch.id, view: '', item_index: 0, source_paths: plan.sourcePaths } }] };
    }
    match = clean.match(/^\/(?:film\/)?locations\/([^/]+)\/plate\/compass$/);
    if (match) {
        const plan = require('../routes/locations').buildCompassRequests(match[1], body);
        return { supported: true, items: await Promise.all(plan.calls.map(async ({side,args},itemIndex) => { const built = require('./reference-plates').buildPlateGenerationPlan(args); if(!built.ok) failure(built.error); return item(plan.provider, built.payload, plan.project.id, 'location', match[1], side.name, built.sourcePaths, itemIndex); })) };
    }
    return null;
}
function subjectExecutionOptions(kind,id,view='',itemIndex=0) {
    const contract=require('./final-request-review');
    const tokens=contract.getExecutionContext().approvals;
    if(!tokens.length)return {};
    const store=contract.store();
    const matching=tokens.filter(token=>{
        const review=store.get(token.id), p=review.editable.provenance || {};
        return p.subject_kind===kind && p.subject_id===id && (p.view||'')===view && p.item_index===itemIndex;
    });
    if(matching.length!==1)failure('This subject view needs its own exact final approval');
    store.validate(matching[0].id);
    return {finalRequest:matching[0]};
}
module.exports = { prepareSubjectRequests, subjectExecutionOptions };
