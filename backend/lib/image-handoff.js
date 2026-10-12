'use strict';
const fs=require('fs'),crypto=require('crypto');
const {canonical,semanticRow}=require('./final-request-review');
const activation=require('./storyboard-activation');
const digest=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:canonical(value)).digest('hex');
function fail(message,status=409){throw Object.assign(new Error(message),{status});}
function promptOf(snapshot) {
    const body=snapshot.body || {};
    for(const key of ['prompt','promptText','text'])if(typeof body[key]==='string')return body[key];
    const field=body.fields?.find(f=>f.name==='prompt');if(typeof field?.value==='string')return field.value;
    if(typeof body.instances?.[0]?.prompt==='string')return body.instances[0].prompt;
    const parts=Array.isArray(body.input)?body.input.filter(p=>p.type==='text').map(p=>p.text):[];
    if(parts.length)return parts.join('\n');
    fail('This resolved image request has no exportable prompt.');
}
function targetFor(review) {
    if(review.snapshot?.capability!=='image')fail('ChatGPT Desktop handoff supports image generation only.',400);
    const p=review.editable?.provenance || {};
    if(p.sequence_id || p.inbetween_id || p.station_index!==undefined || p.world_version_id || p.run_id || p.node_id || p.pipeline_task || p.pipeline_run_id)fail('This image belongs to a dependent sequence, station, flow, pipeline or 3D workflow. Use a standalone storyboard frame or subject image.',400);
    if(p.subject_kind==='character' && p.expression) return {kind:'expression',project_id:p.project_id,subject_id:p.subject_id,slot_id:p.expression.slot_id,revision:p.expression.revision,expression:p.expression};
    if(['character','location','prop'].includes(p.subject_kind) && p.subject_id) return {kind:p.subject_kind,project_id:p.project_id,subject_id:p.subject_id,view:p.view || (p.subject_kind==='character'?'front':'')};
    if(p.shot_id) return {kind:'storyboard',project_id:p.project_id,shot_id:p.shot_id,...(p.expression_selections?.length?{expression_selections:p.expression_selections}:{})};
    fail('This image request has no supported captured import target.',400);
}
function createHandoffStore(db,reviewStore=require('./final-request-review').store()) {
    function sourceEvidence(target,review,files) {
        const p=review.editable.provenance || {},e={target,project:semanticRow(db.prepare('SELECT * FROM film_projects WHERE id=?').get(target.project_id))};
        if(!e.project)fail('Target project was deleted.');
        if(target.kind==='storyboard') {
            e.shot=semanticRow(db.prepare('SELECT * FROM film_shots WHERE id=?').get(target.shot_id));
            if(!e.shot)fail('Target shot was deleted.');
            const scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(e.shot.scene_id);
            if(scene?.project_id!==target.project_id)fail('Captured shot belongs to a different project.');
            e.scene=semanticRow(scene);
            e.frame=require('./selected-frame').selectedFrame(db,target.shot_id);
            e.live_frame=activation.liveFrameEvidence(db,target.shot_id);
            e.annotations=db.prepare('SELECT * FROM film_storyboard_annotations WHERE shot_id=? ORDER BY id').all(target.shot_id);
            if(p.expression_selections?.length)e.expressions=require('./character-expressions').selectedExpressionEvidence(db,p.expression_selections);
        } else {
            const table={character:'film_characters',expression:'film_characters',location:'film_locations',prop:'film_props'}[target.kind];
            e.subject=semanticRow(db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(target.subject_id));
            if(!e.subject || e.subject.project_id!==target.project_id)fail('Captured subject was deleted or changed project.');
            if(target.kind==='expression') {
                const expressions=require('./character-expressions').createExpressionStore(db);
                e.slot=expressions.check(target.subject_id,target.slot_id,target.revision);
                if(!p.expression?.identity_asset_id || expressions.identity(target.subject_id).id!==p.expression.identity_asset_id)fail('Canonical identity changed. Review a fresh expression request before preparing or importing this handoff.');
            }
            const column={character:'character_id',expression:'character_id',location:'location_id',prop:'prop_id'}[target.kind];
            e.plates=db.prepare(`SELECT * FROM film_assets WHERE ${column}=? AND asset_type IN ('character_sheet','reference_image') AND ${require('./subject-gallery').sendableSql()} ORDER BY id`).all(target.subject_id);
        }
        const paths=new Set([...(p.source_paths || []),...(review.snapshot.references || []).filter(r=>r.path).map(r=>r.path),...(e.plates || []).map(a=>a.file_path),e.frame?.file_path].filter(Boolean));
        e.files=[...paths].sort().map(path=>({path,sha256:fs.existsSync(path)?digest(fs.readFileSync(path)):null}));
        // The stable live frame is intentionally replaced by activation; its
        // outgoing bytes are guarded in the version archive. All other source
        // paths must remain identical through the transaction's final commit.
        if(files)for(const source of e.files)if(source.path!==e.live_frame?.path)files.expect(source.path,source.sha256);
        return digest(e);
    }
    function publicRow(row){if(!row)fail('Image handoff not found',404);return {id:row.id,review_id:row.review_id,fingerprint:row.fingerprint,target:JSON.parse(row.target_json),snapshot:JSON.parse(row.snapshot_json),state:row.state,prompt:promptOf(JSON.parse(row.snapshot_json)),result:row.result_json?JSON.parse(row.result_json):null};}
    const create=db.transaction((reviewId,input) => {
        const reviewed=reviewStore.get(reviewId);
        if(input.human_confirmed!==true || input.fingerprint!==reviewed.fingerprint)fail('Approve the visible image handoff fingerprint.',400);
        const existing=db.prepare('SELECT * FROM film_image_handoffs WHERE review_id=?').get(reviewId);
        if(existing)return publicRow(existing);
        if(reviewed.state!=='preview')fail('Use a fresh unsent review for a manual image handoff.');
        reviewStore.validate(reviewId);
        const target=targetFor(reviewed),sourceDigest=sourceEvidence(target,reviewed),id=crypto.randomUUID();
        const count=Number(require('./final-image-execution').executionPayload(reviewed).count);
        if(count!==1)fail('Manual handoff imports one image. Resolve this request with an image count of one.');
        promptOf(reviewed.snapshot);
        db.prepare('INSERT INTO film_image_handoffs (id,review_id,fingerprint,snapshot_json,target_json,source_digest) VALUES (?,?,?,?,?,?)').run(id,reviewId,reviewed.fingerprint,canonical(reviewed.snapshot),canonical(target),sourceDigest);
        // The manual destination cannot subsequently be submitted to a paid API.
        reviewStore.cancel(reviewId);
        return publicRow(db.prepare('SELECT * FROM film_image_handoffs WHERE id=?').get(id));
    });
    function get(id){return publicRow(db.prepare('SELECT * FROM film_image_handoffs WHERE id=?').get(id));}
    function packageFor(id) {
        const h=get(id),entries=[['prompt.txt',h.prompt]],refs=[];
        for(const [i,ref] of (h.snapshot.references || []).entries()) {
            let bytes;
            if(ref.data)bytes=Buffer.from(ref.data.startsWith('data:')?ref.data.split(',')[1]:ref.data,'base64');
            else if(ref.path && fs.existsSync(ref.path))bytes=fs.readFileSync(ref.path);
            if(!bytes || digest(bytes)!==ref.sha256)fail('Captured reference bytes are missing or changed. Prepare a fresh handoff.');
            if(!ref.mime?.startsWith('image/'))fail('Only image references can be exported for this handoff.',400);
            const extension=ref.mime==='image/jpeg'?'jpg':ref.mime==='image/webp'?'webp':'png';
            const filename=`references/${String(i+1).padStart(2,'0')}.${extension}`;
            entries.push([filename,bytes]);refs.push({order:i+1,file:filename,role:ref.role || 'reference',sha256:ref.sha256,mime:ref.mime,byte_length:bytes.length,...(ref.moodboard_entry_id?{moodboard_entry_id:ref.moodboard_entry_id,influence_roles:ref.influence_roles,influence_note:ref.influence_note,board_order:ref.board_order}:{} )});
        }
        const manifest={version:1,handoff_id:h.id,review_id:h.review_id,approved_fingerprint:h.fingerprint,target:h.target,references:refs,snapshot:h.snapshot,
            note:'Manual ChatGPT Desktop handoff. No Film Engine API generation is submitted or charged. Paste prompt.txt, attach numbered references in order, and generate in ChatGPT yourself. API model/settings describe the reviewed source request; ChatGPT uses its own available models and may interpret inputs differently. Import the saved result to the captured target.'};
        entries.push(['manifest.json',JSON.stringify(manifest,null,2)]);
        return {file_name:`chatgpt-image-${h.id}.zip`,data:`data:application/zip;base64,${require('./handoff-zip').zip(entries).toString('base64')}`};
    }
    const importOperation=(id,input,files) => {
        const row=db.prepare('SELECT * FROM film_image_handoffs WHERE id=?').get(id),h=publicRow(row);
        if(h.state==='imported') {
            // Retrying an old receipt may reconcile its still-selected frame,
            // but must never undo a later selection or create another version.
            if(h.target.kind==='storyboard' && require('./selected-frame').selectedFrame(db,h.target.shot_id)?.id===h.result.asset_id)
                activation.activateAsset(db,h.target.shot_id,h.result.asset_id,files,{complete:true,requireUnlocked:true});
            return h.result;
        }
        if(h.state!=='prepared')fail('This handoff was cancelled.');
        if(h.target.kind==='storyboard' && db.prepare('SELECT board_locked_at,provider_config FROM film_projects WHERE id=?').get(h.target.project_id)?.board_locked_at)
            fail('This board is locked. Unlock it before importing the captured frame.',423);
        const reviewed=reviewStore.get(h.review_id);
        const expectedLiveSha256=h.target.kind==='storyboard'?activation.liveFrameEvidence(db,h.target.shot_id).sha256:undefined;
        if(sourceEvidence(h.target,reviewed,files)!==row.source_digest)fail('The captured target, selected version or source references changed. Keep your external image and prepare a fresh handoff before importing.');
        const media=require('./media-imports'),{bytes,mime}=media.bytesFrom(input);
        if(h.target.kind==='storyboard' && (mime!=='image/png' || !bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))))
            fail('Storyboard handoff requires a PNG result. Keep the original and re-export it as PNG.',400);
        if(bytes.length>20*1024*1024)fail('Result image exceeds 20 MB',400);
        media.validateBytes({kind:'image',mimes:['image/png','image/jpeg','image/jpg']},mime,bytes);
        let result;
        if(h.target.kind==='expression') result=require('./character-expressions').store().importImage(h.target.subject_id,h.target.slot_id,{revision:h.target.revision,data:input.data});
        else {
            const t=h.target,uuid=crypto.randomUUID(),format=/jpeg|jpg/.test(mime)?'jpg':'png',subdir=t.kind==='storyboard'?'storyboards':'refsheets';
            const filename=`chatgpt_${uuid}.${format}`,storage=require('./file-storage');
            const file=t.kind==='storyboard'?storage.getFilePath(t.project_id,subdir,filename):storage.saveFile(t.project_id,subdir,filename,bytes);
            if(t.kind==='storyboard')files.write(file,bytes,true);
            try {
                const column=t.kind==='storyboard'?'shot_id':{character:'character_id',location:'location_id',prop:'prop_id'}[t.kind],owner=t.shot_id || t.subject_id;
                const prior=db.prepare(`SELECT MAX(version) AS v FROM film_assets WHERE ${column}=? AND asset_type IN ('storyboard','keyframe','character_sheet','reference_image')`).get(owner);
                const version=Number(prior.v || 0)+1,assetType=t.kind==='storyboard'?'storyboard':t.kind==='character'?'character_sheet':'reference_image';
                if(t.kind!=='storyboard') {
                    const rows=db.prepare(`SELECT * FROM film_assets WHERE ${column}=? AND asset_type IN ('character_sheet','reference_image') AND ${require('./subject-gallery').sendableSql()}`).all(owner);
                    for(const old of rows) {
                        const stored=require('./subject-gallery').viewOf(old);
                        const view=t.kind==='character'?(require('./character-sheet').canonicalView(stored)||stored||'front'):stored;
                        const targetView=t.kind==='character'?(require('./character-sheet').canonicalView(t.view)||t.view||'front'):(t.view||'');
                        if(view===targetView)db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify({...require('./character-expressions').meta(old),plate_role:'superseded'}),old.id);
                    }
                }
                const metadata={kind:t.kind==='storyboard'?'storyboard_import':`${t.kind}_plate`,imported:true,external_tool:'ChatGPT Desktop',handoff_id:h.id,approved_fingerprint:h.fingerprint,...(t.kind==='storyboard'?{}:{view:t.view,plate_role:'reference'})};
                db.prepare(`INSERT INTO film_assets (id,project_id,${column},asset_type,file_path,file_name,format,mime_type,size_bytes,version,metadata) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(uuid,t.project_id,owner,assetType,file,filename,format,mime,bytes.length,version,JSON.stringify(metadata));
                if(t.kind==='storyboard')activation.activateAsset(db,owner,uuid,files,{complete:true,expectedLiveSha256});
                result={asset_id:uuid,version,activated:true,target:t,url:storage.getFileUrl(subdir,t.project_id,filename,uuid)};
            }catch(error){if(t.kind!=='storyboard')fs.unlinkSync(file);throw error;}
        }
        const imported=db.prepare('SELECT metadata FROM film_assets WHERE id=?').get(result.asset_id);
        db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify({...JSON.parse(imported.metadata || '{}'),external_tool:'ChatGPT Desktop',handoff_id:h.id,approved_fingerprint:h.fingerprint}),result.asset_id);
        db.prepare("UPDATE film_image_handoffs SET state='imported',result_json=? WHERE id=?").run(canonical(result),id);
        return result;
    };
    function importResult(id,input) {
        const h=get(id);
        return h.target.kind==='storyboard'
            ? activation.withStoryboardMutation(db,h.target.shot_id,files=>importOperation(id,input,files))
            : db.transaction(()=>importOperation(id,input))();
    }
    return {create,get,packageFor,importResult};
}
function store(){return createHandoffStore(require('../db/database').db);}
module.exports={promptOf,targetFor,createHandoffStore,store};
