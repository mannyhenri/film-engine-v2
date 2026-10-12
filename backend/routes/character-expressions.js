'use strict';
const expressions = require('../lib/character-expressions');
function json(res,status,data) { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(data)); }
async function handleCharacterExpressions(req,res,id,parts) {
    try {
        const s = expressions.store(), slotId = parts[4], action = parts[5], body = req.body || {};
        if (req.method === 'GET' && !slotId) return json(res,200,{slots:s.list(id)});
        if (req.method === 'PUT' && slotId && !action) return json(res,200,{slot:s.update(id,slotId,body)});
        if (req.method === 'POST' && action === 'import') return json(res,201,s.importImage(id,slotId,body));
        if (req.method === 'POST' && action === 'generate') {
            const plan = s.plan(id,slotId,body);
            const options = require('../lib/final-subject-request-plans').subjectExecutionOptions('character',id,`expression:${slotId}`);
            if (!options.finalRequest) expressions.failure('A final approved request is required before expression generation.',428);
            const reviewed = require('../lib/final-request-review').store().get(options.finalRequest.id);
            if(reviewed.state!=='approved' || reviewed.fingerprint!==options.finalRequest.fingerprint)expressions.failure('This expression request needs its exact final approval before generation.');
            const canonical = require('../lib/final-request-review').canonical;
            if (canonical(reviewed.editable.provenance.expression) !== canonical(plan.expression)) expressions.failure('Expression or identity changed. Review the request again.');
            const approved = require('../lib/final-image-execution').executionPayload(reviewed);
            if (approved.count !== 1 || Number(approved.n || 1) !== 1) expressions.failure('Each expression request must generate exactly one image.');
            const adapter=require('../lib/providers').get(reviewed.snapshot.provider);
            const budget=Number.isFinite(adapter?.maxReferenceImages)?adapter.maxReferenceImages:3;
            if(!adapter?.supportsReferenceImages || (reviewed.snapshot.references || []).length>budget)expressions.failure('The approved provider cannot fit the expression identity/style reference budget.');
            for(const [index,ref] of plan.payload.reference_images.entries()) {
                const data=ref.uri || (ref.file_path && require('../lib/reference-images').toDataUri(ref.file_path));
                const sha=require('crypto').createHash('sha256').update(Buffer.from(data.split(',')[1],'base64')).digest('hex');
                if(!reviewed.snapshot.references.some(r=>r.sha256===sha))expressions.failure('The approved expression request must retain the canonical identity and style reference images.');
                if(index===0 && reviewed.snapshot.references[0]?.sha256!==sha)expressions.failure('Keep the canonical identity as the first reviewed reference image for this face request.');
            }
            const reserved = s.reserve(id,slotId,body.revision);
            const binding={character_id:id,slot:plan.slot,activate_revision:reserved.revision,identity_asset_id:plan.expression.identity_asset_id,character_fingerprint:expressions.characterFingerprint(plan.ch),approved_review_id:reviewed.id,approved_fingerprint:reviewed.fingerprint};
            const result = await require('../lib/final-image-execution').executeApprovedImage(adapter,options,plan.config,{jobMeta:{expression_delivery:binding}});
            if (!result.ok) return json(res,result.pending?202:result.status || 502,{error:result.error,job_id:result.generation_job_id,pending:!!result.pending});
            try {
                const out=await expressions.deliverGenerated(binding,result.data,{provider:adapter.id,approved_review_id:reviewed.id,approved_fingerprint:reviewed.fingerprint,identity_asset_id:plan.expression.identity_asset_id,collected_from_job:result.generation_job_id});
                return json(res,201,out);
            }catch(error){if(result.generation_job_id)require('../lib/generation-jobs').fail(result.generation_job_id,error.message);throw error;}
        }
        return json(res,405,{error:'Method not allowed'});
    } catch (error) { return json(res,error.status || 400,{error:error.message}); }
}
module.exports = {handleCharacterExpressions};
