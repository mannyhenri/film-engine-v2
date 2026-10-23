'use strict';
const { mainFirstSql } = require('./character-sheet-main');   // the character's MAIN sheet first (lib/character-sheet-main.js)
const fs = require('fs');
const DEFAULTS = Object.freeze(['Neutral', 'Fear', 'Anger', 'Sadness', 'Joy', 'Surprise']);
const SLOT_IDS = DEFAULTS.map((_, i) => `slot-${i + 1}`);
function failure(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function meta(row) { try { const value=typeof row.metadata === 'object' ? row.metadata : JSON.parse(row.metadata || '{}');return value && typeof value==='object'?value:{}; } catch { return {}; } }
function characterFingerprint(row) { const contract=require('./final-request-review');return require('crypto').createHash('sha256').update(contract.canonical(contract.semanticRow(row))).digest('hex'); }
function createExpressionStore(db) {
    const storage = require('./file-storage');
    function character(id) {
        const ch = db.prepare('SELECT * FROM film_characters WHERE id=?').get(id);
        if (!ch) failure('Character not found', 404);
        return ch;
    }
    function slot(id, slotId) {
        character(id);
        if (!SLOT_IDS.includes(slotId)) failure('Unknown expression slot', 400);
        return db.prepare('SELECT * FROM film_character_expression_slots WHERE character_id=? AND slot_id=?').get(id, slotId)
            || { character_id: id, slot_id: slotId, label: DEFAULTS[SLOT_IDS.indexOf(slotId)], direction: '', active_asset_id: null, revision: 0 };
    }
    function check(id, slotId, revision) {
        const s = slot(id, slotId);
        if (!Number.isInteger(revision) || revision !== s.revision) failure('Expression slot changed. Reload it before saving or generating.');
        return s;
    }
    function asset(id, assetId) {
        const ch = character(id);
        const a = db.prepare('SELECT * FROM film_assets WHERE id=? AND character_id=? AND project_id=?').get(assetId, id, ch.project_id);
        if (!a || !a.file_path || !fs.existsSync(a.file_path)) failure('Expression reference is missing or deleted. Upload or select another image.');
        return a;
    }
    function history(id, slotId) {
        return db.prepare("SELECT * FROM film_assets WHERE character_id=? AND json_valid(metadata) AND json_extract(metadata,'$.reference_role')='expression' AND json_extract(metadata,'$.expression_slot_id')=? ORDER BY version DESC, created_at DESC").all(id, slotId).map(a => {
            const exists = !!a.file_path && fs.existsSync(a.file_path);
            return { id: a.id, version: a.version, metadata: meta(a), file_exists: exists,
                image_url: exists ? storage.getFileUrl('refsheets', a.project_id, a.file_name, a.id) : null };
        });
    }
    function list(id) {
        return SLOT_IDS.map(slotId => {
            const s = slot(id, slotId), versions = history(id, slotId);
            const selected = versions.find(a => a.id === s.active_asset_id);
            return { ...s, versions, image_url: selected?.image_url || null, missing_reference: !!s.active_asset_id && !selected?.file_exists };
        });
    }
    function write(s) {
        db.prepare('INSERT INTO film_character_expression_slots (character_id,slot_id,label,direction,active_asset_id,revision) VALUES (?,?,?,?,?,?) ON CONFLICT(character_id,slot_id) DO UPDATE SET label=excluded.label,direction=excluded.direction,active_asset_id=excluded.active_asset_id,revision=excluded.revision').run(s.character_id,s.slot_id,s.label,s.direction,s.active_asset_id,s.revision);
        return s;
    }
    const update = db.transaction((id, slotId, body) => {
        const s = check(id,slotId,body.revision);
        if (body.label !== undefined) {
            const label = String(body.label).trim();
            if (!label || label.length > 80) failure('Expression label must contain 1–80 characters', 400);
            s.label = label;
        }
        if (body.direction !== undefined) {
            if (typeof body.direction !== 'string' || body.direction.length > 1000) failure('Expression direction must be text of at most 1000 characters', 400);
            s.direction = body.direction;
        }
        if (body.asset_id !== undefined) {
            if (body.asset_id === null) s.active_asset_id = null;
            else {
                const a = asset(id,body.asset_id), m = meta(a);
                if (m.reference_role !== 'expression' || m.expression_slot_id !== slotId) failure('Select a version from this expression slot', 400);
                s.active_asset_id = a.id;
            }
        }
        return write({ ...s, revision: s.revision + 1 });
    });
    function fileVersion(id, s, bytes, mime, details = {}, activateRevision = s.revision) {
        const ch = character(id), uuid = require('../db/database').generateId();
        const filename = `expression_${id}_${s.slot_id}_${uuid}.${mime === 'image/jpeg' ? 'jpg' : 'png'}`;
        const filePath = storage.saveFile(ch.project_id,'refsheets',filename,bytes);
        try {
            return db.transaction(() => {
                const current = slot(id,s.slot_id);
                // Two collectors may have downloaded the same provider job while neither had filed it.
                if(details.collected_from_job) {
                    const old=db.prepare("SELECT id,version FROM film_assets WHERE character_id=? AND json_valid(metadata) AND json_extract(metadata,'$.collected_from_job')=? AND json_extract(metadata,'$.reference_role')='expression'").get(id,details.collected_from_job);
                    if(old){fs.unlinkSync(filePath);return {asset_id:old.id,version:old.version,activated:false,slot:current};}
                }
                const version = Number(db.prepare("SELECT MAX(version) AS v FROM film_assets WHERE character_id=? AND json_valid(metadata) AND json_extract(metadata,'$.reference_role')='expression' AND json_extract(metadata,'$.expression_slot_id')=?").get(id,s.slot_id).v || 0) + 1;
                const metadata = { ...details, reference_role:'expression', ref_category:'face', plate_role:'concept',
                    expression_slot_id:s.slot_id, expression_label:s.label, expression_direction:s.direction,
                    framing:'face_closeup', camera_view:'front', view:`expression:${s.slot_id}` };
                db.prepare("INSERT INTO film_assets (id,project_id,character_id,asset_type,file_path,file_name,format,mime_type,version,metadata) VALUES (?,?,?,'reference_image',?,?,?,?,?,?)").run(uuid,ch.project_id,id,filePath,filename,mime === 'image/jpeg'?'jpg':'png',mime,version,JSON.stringify(metadata));
                const unchangedCharacter=!details.character_fingerprint || characterFingerprint(character(id))===details.character_fingerprint;
                let unchangedIdentity=true;
                if(details.generated && details.identity_asset_id){try{unchangedIdentity=identity(id).id===details.identity_asset_id;}catch(_){unchangedIdentity=false;}}
                const activated = current.revision === activateRevision && unchangedCharacter && unchangedIdentity;
                if (activated) write({ ...current, active_asset_id:uuid, revision:current.revision + 1 });
                return { asset_id:uuid, version, activated, slot:slot(id,s.slot_id) };
            })();
        } catch (error) { fs.unlinkSync(filePath); throw error; }
    }
    function importImage(id,slotId,body) {
        const s = check(id,slotId,body.revision);
        const media = require('./media-imports');
        const input = body.source_asset_id ? {bytes:fs.readFileSync(asset(id,body.source_asset_id).file_path),mime:asset(id,body.source_asset_id).mime_type} : body;
        const {bytes,mime} = media.bytesFrom(input);
        if (bytes.length > 20*1024*1024) failure('Expression image exceeds 20 MB',400);
        media.validateBytes({kind:'image',mimes:['image/png','image/jpeg','image/jpg']},mime,bytes);
        // Validate again after decoding, before file/row writes; a late selection never replaces a newer slot.
        check(id,slotId,body.revision);
        return fileVersion(id,s,bytes,mime === 'image/jpg'?'image/jpeg':mime,{imported:true,...(body.source_asset_id?{source_asset_id:body.source_asset_id}:{})});
    }
    function identity(id) {
        const ch = character(id);
        const rows = db.prepare(`SELECT * FROM film_assets WHERE project_id=? AND character_id=? AND asset_type IN ('character_sheet','reference_image') AND ${require('./subject-gallery').sendableSql()} ORDER BY ${mainFirstSql()}, ${require('./plate-views').orderByViewSql()}, version DESC, created_at DESC`).all(ch.project_id,id);
        const a = rows.find(r => r.file_path && fs.existsSync(r.file_path));
        if (!a) failure('A usable approved identity plate is required before generating an expression. Upload or approve a body plate first.');
        return a;
    }
    function plan(id,slotId,body={},providerOverride) {
        const ch = character(id), s = check(id,slotId,body.revision), anchor = identity(id);
        const override = require('./generation-override').imageOverride(body);
        const config = require('./provider-config').spendContext({id:ch.project_id},null,null,override) || require('./provider-config').providerConfigFor(ch.project_id);
        const provider = providerOverride || require('./providers').resolve('image',config);
        if (!provider?.supportsReferenceImages) failure('Choose an image provider that supports identity references.');
        const styles = require('./reference-plates').styleReferencesFor(db,ch.project_id);
        const limit = Number.isFinite(provider.maxReferenceImages) ? provider.maxReferenceImages : 3;
        if (1 + styles.length > limit) failure('Provider reference budget cannot fit the identity and style anchors. Choose a provider with more reference slots.');
        const refs = [{name:ch.name,kind:'character',file_path:anchor.file_path,uri:require('./reference-images').toDataUri(anchor.file_path),tag:'identity'},...styles];
        if (!refs[0].uri) failure('Approved identity image cannot be read.');
        const project = db.prepare('SELECT * FROM film_projects WHERE id=?').get(ch.project_id);
        const expression = {slot_id:s.slot_id,label:s.label,direction:s.direction,revision:s.revision,active_asset_id:s.active_asset_id,reference_role:'expression',framing:'face_closeup',camera_view:'front',identity_asset_id:anchor.id};
        const address = provider.supportsReferenceTags ? '@identity' : 'the first reference image';
        const prompt = [require('./plate-isolation').projectMedium(ch.project_id,db),
            `One face-only close-up of ${ch.name}. Match the exact canonical identity in ${address}; preserve facial proportions, species, markings, hair and eyes.`,
            `Facial expression: ${s.label}.`,s.direction,
            'Only the face and head, front view, plain neutral background; no full body, montage, grid, text or labels.',
            ch.appearance_prompt || ch.description || '',
            styles.length ? 'Preserve the visual medium and palette of the supplied style reference.' : ''].filter(Boolean).join(' ');
        const payload = {prompt,negative_prompt:require('./plate-isolation').isolationNegativeFor('character'),reference_images:refs,
            ...require('./image-standard').plateSize('1:1',require('./image-standard').projectResolution(ch.project_id)),count:1,n:1,
            ...(body.model?{model:body.model}:{}),...(body.seed!==undefined?{seed:body.seed}: {})};
        const folded=provider.supportsNegativePrompt==='folded'?payload.negative_prompt.length+'\n\nAvoid: '.length:0;
        if(provider.promptLimit && prompt.length+folded>provider.promptLimit)failure('The exact expression and appearance exceed this provider prompt budget. Shorten the direction or choose a provider with a larger prompt budget.');
        require('./capability-payloads').withTierModel(payload,{project:{id:ch.project_id},tierOverride:override},provider);
        return {ch,slot:s,provider,config,payload,expression,sourcePaths:refs.map(r=>r.file_path).filter(Boolean)};
    }
    const reserve = db.transaction((id,slotId,revision) => { const s=check(id,slotId,revision); return write({...s,revision:s.revision+1}); });
    return {character,slot,check,asset,list,history,update,importImage,fileVersion,identity,plan,reserve};
}
function store() { return createExpressionStore(require('../db/database').db); }
function appendSelectedExpressions(payload,selections,context,provider) {
    if (!Array.isArray(selections) || !selections.length) return payload;
    if (!provider?.supportsReferenceImages) failure('This provider cannot attach the selected expression references.');
    if (selections.length > 6) failure('Select at most one expression per character.',400);
    const refs = [...(payload.reference_images || [])], limit = Number.isFinite(provider.maxReferenceImages) ? provider.maxReferenceImages : 3;
    if (refs.length + selections.length > limit) failure('Selected expressions do not fit the remaining reference budget. Identity, anchor, location and style references were preserved. Choose fewer expressions or a provider with more slots.');
    const s = store(), seen = new Set(), directions=[];
    for (const selection of selections) {
        if (!selection || seen.has(selection.character_id)) failure('Select at most one expression per character.',400);
        seen.add(selection.character_id);
        const ch = s.character(selection.character_id);
        const matched=context.sceneCard ? require('./shot-references').matchCharacters(context.sceneCard.characters,context.characters || []) : context.characters || [];
        if (ch.project_id !== context.project.id || !matched.some(c=>c.id===ch.id)) failure('Selected expression is not a character in this shot.',400);
        s.identity(ch.id);
        const slot = s.check(ch.id,selection.slot_id,selection.revision);
        if (!selection.asset_id || slot.active_asset_id !== selection.asset_id) failure('Expression selection changed. Choose its current version and review again.');
        const a=s.asset(ch.id,selection.asset_id), metadata=meta(a);
        if(metadata.reference_role!=='expression'||metadata.expression_slot_id!==slot.slot_id) failure('Expression asset belongs to a different slot.');
        const uri=require('./reference-images').toDataUri(a.file_path);
        if(!uri)failure('Expression reference cannot be read.');
        let tag=`expression${refs.length+1}`;
        while(refs.some(r=>r.tag===tag))tag+='x';
        refs.push({uri,file_path:a.file_path,tag,name:`${ch.name} expression`,kind:'expression',reference_role:'expression',framing:'face_closeup',character_id:ch.id,expression_slot_id:slot.slot_id,expression_revision:slot.revision,expression_label:slot.label,expression_direction:slot.direction,asset_id:a.id});
        directions.push(`${ch.name}: facial expression ${slot.label}${slot.direction?` — ${slot.direction}`:''}. Use ${provider.supportsReferenceTags?`@${tag}`:`reference image ${refs.length}`} for facial expression only; retain canonical identity, body view, staging and location.`);
    }
    const prompt=String(payload.prompt || '')+'\n'+directions.join('\n');
    const reserved=provider.supportsNegativePrompt==='folded'?String(payload.negative_prompt || '').length+9:0;
    if(provider.promptLimit && prompt.length+reserved>provider.promptLimit)failure('The exact expression direction exceeds this provider prompt budget. Shorten the direction or choose a provider with a larger prompt budget.');
    return {...payload,prompt,reference_images:refs};
}
async function deliverGenerated(binding,data,details={}) {
    const s=store(),ch=s.character(binding.character_id);
    if(details.collected_from_job) {
        const db=require('../db/database').db;
        const old=db.prepare("SELECT id,version FROM film_assets WHERE character_id=? AND json_valid(metadata) AND json_extract(metadata,'$.collected_from_job')=? AND json_extract(metadata,'$.reference_role')='expression'").get(ch.id,details.collected_from_job);
        if(old)return {asset_id:old.id,version:old.version,activated:false};
    }
    const file=await require('./provider-media').persistProviderMedia(ch.project_id,'refsheets',`expression_delivery_${require('../db/database').generateId()}.png`,data,{serveDir:'images'});
    try {
        const bytes=fs.readFileSync(file),mime=bytes[0]===0xff?'image/jpeg':'image/png';
        require('./media-imports').validateBytes({kind:'image',mimes:['image/png','image/jpeg']},mime,bytes);
        return s.fileVersion(ch.id,binding.slot,bytes,mime,{generated:true,identity_asset_id:binding.identity_asset_id,character_fingerprint:binding.character_fingerprint,approved_review_id:binding.approved_review_id,approved_fingerprint:binding.approved_fingerprint,...details},binding.activate_revision);
    } finally {fs.unlinkSync(file);}
}
function selectedExpressionEvidence(db,selections) {
    const s=createExpressionStore(db),semantic=require('./final-request-review').semanticRow;
    return selections.map(selection=>({character:semantic(s.character(selection.character_id)),slot:s.slot(selection.character_id,selection.slot_id),identity:s.identity(selection.character_id)}));
}
module.exports = {DEFAULTS,SLOT_IDS,createExpressionStore,store,meta,failure,appendSelectedExpressions,deliverGenerated,selectedExpressionEvidence,characterFingerprint};
