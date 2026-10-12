'use strict';
/** Resolve mutable Production edits once, before free review and paid dispatch. */
const fs = require('fs'), path = require('path');
const recipes = require('./production-recipes');
const { canonical, hash } = require('./final-request-review');
const parse = value => { try { return JSON.parse(value || '{}'); } catch (_) { return {}; } };
function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function bytesOf(ref) {
    const uri = ref && (ref.uri || ref.data);
    if (typeof uri === 'string' && /^data:[^;]+;base64,/.test(uri)) return Buffer.from(uri.split(',')[1], 'base64');
    return null;
}
function assetEvidence(db, id) {
    const asset = id && db.prepare('SELECT * FROM film_assets WHERE id=?').get(id);
    if (!asset) return null;
    let sha256 = null; try { sha256 = hash(fs.readFileSync(asset.file_path)); } catch (_) {}
    return { id: asset.id, project_id: asset.project_id, shot_id: asset.shot_id,
        asset_type: asset.asset_type, version: asset.version, file_path: asset.file_path, sha256 };
}
function selectionBaseline(db, owner) {
    if (owner.type === 'shot') {
        const shot = db.prepare('SELECT current_frame_version,selected_video_asset_id FROM film_shots WHERE id=?').get(owner.id);
        const frame = require('./selected-frame').selectedFrame(db, owner.id);
        const video = require('./conform').selectedClip(db, owner.id);
        return { frame_pointer: shot.current_frame_version, frame_asset_id: frame?.id || null,
            video_pointer: shot.selected_video_asset_id, video_asset_id: video?.id || null };
    }
    const row = db.prepare('SELECT selected_video_asset_id,output_asset_id,shot_ids FROM film_sequences WHERE id=?').get(owner.id);
    const members = parse(row.shot_ids);
    return { video_pointer: row.selected_video_asset_id, output_asset_id: row.output_asset_id, shot_ids: row.shot_ids,
        members: Array.isArray(members) ? members.map(id => ({ shot_id: id,
            frame_pointer: db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(id)?.current_frame_version || null,
            frame_asset_id: require('./selected-frame').selectedFrame(db,id)?.id || null,
            video_pointer: db.prepare('SELECT selected_video_asset_id FROM film_shots WHERE id=?').get(id)?.selected_video_asset_id || null,
            video_asset_id: require('./conform').selectedClip(db, id)?.id || null })) : [] };
}
function selectionUnchanged(db, owner, baseline) { return canonical(selectionBaseline(db, owner)) === canonical(baseline); }
function deliveryUnchanged(db, owner, delivery, jobId) {
    if (jobId) {
        const job=db.prepare('SELECT meta,error FROM film_generation_jobs WHERE id=?').get(jobId);
        if (parse(job?.meta).stopped_waiting || job?.error === 'cancelled by the director') return false;
    }
    if (!selectionUnchanged(db, owner, delivery.baseline)) return false;
    if (!delivery.production_draft) return true;
    const draft = recipes.readDraft(db, owner.project_id, owner.node_key), binding = delivery.production_draft;
    return !!draft && draft.revision === binding.revision
        && hash(canonical({payload:draft.payload,source_asset_id:draft.source_asset_id})) === binding.digest;
}
function historicalReview(db, projectId, reviewId) {
    const row = db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(reviewId);
    const editable = row && parse(row.editable_json), origin = editable?.provenance;
    if (!row || origin?.project_id !== projectId || !row.approved_at || !['submitting','submitted','completed','uncertain'].includes(row.state)) {
        fail('Historical approved bytes are unavailable for this project. Attach current references and review a new recipe.');
    }
    return { row, editable, snapshot: parse(row.snapshot_json) };
}
function sourceHistory(db, projectId, assetId) {
    if (!assetId) return null;
    const asset = db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(assetId, projectId);
    if (!asset) fail('The draft source asset is not in this project', 400);
    const lineage = require('./production-lineage').assetLineage(db, asset);
    return lineage?.status === 'recorded' ? historicalReview(db, projectId, lineage.review_id) : null;
}
function reference(db, projectId, input, kind, history) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Each draft reference must identify an asset or captured historical reference', 400);
    if (kind === 'audio' && ['offset_ms','source_in_ms','duration_ms','gain_db','muted','trim_start_ms','trim_end_ms'].some(key => input[key] !== undefined)) {
        fail('Audio conditioning uses the full source. Put offset, trim, gain and mute on a timeline audio track.', 400);
    }
    let captured = input.captured_reference;
    // Inspector reruns may copy an approved reference directly, including its exact data URI.
    if (!captured && history && (input.sha256 || bytesOf(input))) {
        const digest = input.sha256 || hash(bytesOf(input));
        const ref = (history.snapshot.references || []).find(r => r.sha256 === digest);
        if (ref && bytesOf(ref)) captured = { review_id: history.row.id, order: ref.order };
    }
    let asset = null, uri, stored = null;
    if (captured) {
        const origin = historicalReview(db, projectId, captured.review_id);
        stored = (origin.snapshot.references || []).find(r => r.order === captured.order);
        const bytes = bytesOf(stored);
        if (!stored || !bytes || hash(bytes) !== stored.sha256 || !stored.mime?.startsWith(kind + '/')) fail('The captured reference bytes, role or order are unavailable', 400);
        uri = stored.data; // No reread of a plate that may have been replaced.
    } else {
        asset = input.asset_id && db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(input.asset_id, projectId);
        if (!asset && input.moodboard_entry_id) {
            const look = db.prepare('SELECT * FROM film_mood_board WHERE id=? AND project_id=?').get(input.moodboard_entry_id, projectId);
            if (look) {
                asset = look.asset_id && db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(look.asset_id, projectId);
                if (!asset && look.image_path) asset = { file_path: look.image_path, version: null };
            }
        }
        if (!asset) fail('Every attached reference must identify an asset in this project', 400);
        const mime = asset.mime_type || ({ '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.mp4':'video/mp4' })[path.extname(asset.file_path).toLowerCase()];
        if (!mime?.startsWith(kind + '/')) fail(`That asset is not a supported ${kind} reference`, 400);
        let bytes; try { bytes = fs.readFileSync(asset.file_path); } catch (_) { fail('An attached reference is offline. Restore or detach it before reviewing.', 409); }
        if (!bytes.length) fail('An attached reference has no bytes', 400);
        uri = `data:${mime};base64,${bytes.toString('base64')}`;
        if (input.uri || input.data) {
            const capturedBytes = bytesOf(input), capturedMime = /^(?:data:)([^;]+)/.exec(input.uri || input.data)?.[1];
            if (!capturedBytes || capturedMime !== mime || !input.sha256 || hash(capturedBytes) !== input.sha256 || input.source_sha256 !== hash(bytes)) {
                fail('The captured draft reference or its source bytes changed. Prepare a fresh starter or attach the current asset.');
            }
            uri = `data:${mime};base64,${capturedBytes.toString('base64')}`;
        }
    }
    const result = { uri, reference_role: input.reference_role || input.role || stored?.role || (kind === 'audio' ? 'audio_conditioning' : 'image_reference') };
    for (const key of ['name','kind','tag','character_id','location_id','prop_id','moodboard_entry_id','influence_roles','influence_note','weight']) {
        if (input[key] !== undefined) result[key] = input[key]; else if (stored?.[key] !== undefined) result[key] = stored[key];
    }
    if (asset) Object.assign(result, { asset_id: asset.id, version: asset.version, file_path: asset.file_path });
    else Object.assign(result, { asset_id: stored.asset_id || stored.source_asset_id, version: stored.version || stored.asset_version });
    return result;
}
function draftEvidence(db, binding) {
    const draft = recipes.readDraft(db, binding.project_id, binding.node_key);
    const owner = recipes.nodeOwner(db, binding.project_id, binding.node_key);
    const ids = new Set([draft?.source_asset_id].filter(Boolean));
    function visit(value) { if (!value || typeof value !== 'object') return; for (const [key, v] of Object.entries(value)) { if (['asset_id','source_asset_id'].includes(key) && typeof v === 'string') ids.add(v); else visit(v); } }
    visit(draft?.payload);
    const selection = selectionBaseline(db, owner);
    function selectedAssets(value) { if (!value || typeof value !== 'object') return; for (const [key,v] of Object.entries(value)) { if (/asset_id$/.test(key) && typeof v === 'string') ids.add(v); else selectedAssets(v); } }
    selectedAssets(selection);
    return { revision: draft?.revision || null, digest: draft ? hash(canonical({ payload: draft.payload, source_asset_id: draft.source_asset_id })) : null,
        selection, assets: [...ids].sort().map(id => assetEvidence(db, id)) };
}
function resolveDraftRequest(db, targetId, body, capability, targetType = 'shot') {
    const input = body && body.production_draft;
    if (!input) return null;
    const key = `${targetType === 'sequence' ? 'seq' : 'shot'}:${targetId}`;
    if (input.node_key !== key || !Number.isSafeInteger(input.revision) || input.revision < 1) fail('production_draft must name this node and its saved revision', 400);
    const ownerRow = targetType === 'sequence'
        ? db.prepare('SELECT project_id FROM film_sequences WHERE id=?').get(targetId)
        : db.prepare('SELECT sc.project_id FROM film_shots sh JOIN film_scenes sc ON sc.id=sh.scene_id WHERE sh.id=?').get(targetId);
    if (!ownerRow) fail('Production node not found', 404);
    const projectId = ownerRow.project_id, owner = recipes.nodeOwner(db, projectId, key);
    const draft = recipes.readDraft(db, projectId, key);
    if (!draft || draft.revision !== input.revision) fail('The Production draft changed. Reload and review its current revision.');
    const recipe = draft.payload[capability];
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) fail(`Save an explicit ${capability} recipe before reviewing`, 400);
    const history = sourceHistory(db, projectId, recipe.source_asset_id || draft.source_asset_id);
    const base = history?.snapshot.capability === capability ? history.editable.payload : {};
    const provider = recipe.provider || history?.snapshot.provider;
    if (!provider) fail('Choose an explicit provider for this draft', 400);
    const adapter = require('./providers').get(provider);
    if (!adapter?.supports(capability)) fail('That provider does not support this draft capability', 400);
    const payload = {};
    // Only provider-supported historical fields are inherited. Final edits and refs are rebuilt below.
    const allowed = new Set((require('./final-request-validation').supportedInputFields[`${provider}/${capability}`] || '').split(' '));
    for (const [field, value] of Object.entries(base)) if (allowed.has(field) && !['reference_images','audio_references','final_prompt','final_request_body'].includes(field)) payload[field] = value;
    const metadata = new Set(['provider','settings','source_asset_id','reference_images','audio_references','prompt','prompt_format']);
    for (const [field, value] of Object.entries(recipe.settings || {})) payload[field] = value;
    for (const [field, value] of Object.entries(recipe)) if (!metadata.has(field)) payload[field] = value;
    const promptFormat = recipe.prompt_format || (recipe.prompt === undefined && provider === 'runway' && base.runway_recipe === 'multi_shot_video' && Array.isArray(history?.snapshot.body.shots) ? 'native_shots_json' : undefined);
    const prompt = recipe.prompt === undefined ? base.final_prompt || base.prompt || (promptFormat === 'native_shots_json' ? JSON.stringify(history.snapshot.body.shots) : undefined) : recipe.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) fail('The full draft prompt is required. Legacy history does not record it.', 400);
    if (promptFormat !== undefined && promptFormat !== 'native_shots_json') fail('Unsupported draft prompt format', 400);
    if (provider === 'runway' && payload.runway_recipe === 'multi_shot_video' && payload.mode !== 'auto' && promptFormat !== 'native_shots_json') fail('Custom native multi-shot recipes require prompt_format native_shots_json', 400);
    if (promptFormat === 'native_shots_json') {
        if (provider !== 'runway' || capability !== 'video' || payload.runway_recipe !== 'multi_shot_video') fail('Native shots JSON belongs to a Runway multi-shot video recipe', 400);
        let shots; try { shots = JSON.parse(prompt); } catch (_) { fail('Native multi-shot prompt must be the JSON list of shot prompts and durations shown by the starter', 400); }
        if (!Array.isArray(shots)) fail('Native multi-shot prompt must be an ordered list of shot prompts and durations', 400);
        payload.shots = shots;
        delete payload.prompt; delete payload.final_prompt;
    } else {
        payload.prompt = prompt;
        payload.final_prompt = prompt; // Whole wire prompt, without hidden composer additions.
    }
    if (!payload.model) payload.model = recipe.model || base.model || adapter.defaultModel;
    for (const [field, kind] of [['reference_images','image'],['audio_references','audio']]) {
        const list = recipe[field] === undefined ? (base[field] || []) : recipe[field];
        if (!Array.isArray(list)) fail(`${field} must be an ordered list`, 400);
        if (list.length || field === 'reference_images') payload[field] = list.map(ref => reference(db, projectId, ref, kind, history));
    }
    // Every source/keyframe must resolve from this project or a captured review.
    // An arbitrary path/data URL in settings is not an attached project reference.
    function media(value, kind, field) {
        if (value && typeof value === 'object') return reference(db, projectId, value, kind, history);
        if (history && recipe[field] === undefined && recipe.settings?.[field] === undefined) {
            const bytes = typeof value === 'string' && value.startsWith('data:') ? Buffer.from(value.split(',')[1], 'base64') : null;
            const stored = history.snapshot.references.find(r => bytes ? r.sha256 === hash(bytes) : r.path === value || r.source_path === value);
            if (stored) return reference(db, projectId, { captured_reference: { review_id: history.row.id, order: stored.order } }, kind, history);
        }
        fail(`Attach ${field} using a project asset or captured reference`, 400);
    }
    for (const field of ['init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri']) {
        if (payload[field]) {
            const selected = media(payload[field], /video/.test(field) ? 'video' : 'image', field);
            payload[field] = /video/.test(field) ? selected.uri : selected;
        }
    }
    for (const field of ['keyframes','promptImage','reference_videos']) if (payload[field]) {
        const values = Array.isArray(payload[field]) ? payload[field] : [payload[field]];
        const resolved = values.map(ref => ({ ...media(ref, field === 'reference_videos' ? 'video' : 'image', field), ...(ref.position ? { position: ref.position } : {}) }));
        payload[field] = field === 'promptImage' && !Array.isArray(payload[field]) ? resolved[0] : resolved;
    }
    const binding = { project_id: projectId, node_key: key, revision: draft.revision,
        digest: hash(canonical({ payload: draft.payload, source_asset_id: draft.source_asset_id })) };
    const provenance = { project_id: projectId, ...(targetType === 'sequence' ? { sequence_id: targetId } : { shot_id: targetId }), production_draft: binding };
    if (owner.type === 'sequence') {
        const row = db.prepare('SELECT shot_ids FROM film_sequences WHERE id=?').get(targetId);
        const ids = parse(row.shot_ids); // array JSON uses the same parser.
        if (!Array.isArray(ids) || !ids.length) fail('Add narrative shots to this sequence before generating', 400);
        provenance.source_shot_ids = ids;
        for (const id of ids) recipes.nodeOwner(db, projectId, `shot:${id}`);
    }
    const config = require('./provider-config').tag({ [capability]: provider, [`${capability}_model`]: payload.model,
        __production_explicit_recipe: true }, projectId, owner.shot_id, owner.scene_id);
    const generator = require('./providers').resolve(capability, config);
    if (generator?.id !== provider) fail('The chosen draft provider is unavailable. Choose and review again.');
    return { owner, draft, provider, payload, provenance, generator, baseline: selectionBaseline(db, owner) };
}
async function plannedDraft(db, targetId, body, capability, targetType) {
    const plan = resolveDraftRequest(db, targetId, body, capability, targetType);
    if (!plan) return null;
    // Validate raw fields before the shared funnel can normalize inherited defaults.
    const raw = await require('./final-provider-request').resolveFinalRequest(plan.provider, capability, plan.payload);
    if (plan.payload.runway_recipe === 'multi_shot_video' && plan.payload.mode !== 'auto' && canonical(raw.body.shots) !== canonical(plan.payload.shots)) {
        fail('Native shot prompts and durations exceed the supported request. Shorten prompts and use exact whole-second durations before reviewing.',400);
    }
    const normalized = await plan.generator.generate(capability, plan.payload, { previewRequest: true });
    if (!normalized?.preview) fail(normalized?.error || 'The draft provider did not stop at free preview');
    await require('./final-provider-request').resolveFinalRequest(plan.provider, capability, normalized.payload);
    return { ...plan, payload: normalized.payload };
}
/** Free and read-only: preserve the composed request as an explicit editing recipe. */
async function starterDraft(db, projectId, nodeKey, kind = 'image') {
    if (!['image','video'].includes(kind)) fail('Starter kind must be image or video', 400);
    const owner = recipes.nodeOwner(db, projectId, nodeKey);
    if (owner.type === 'sequence' && kind === 'image') fail('Storyboard generation belongs to a shot; this sequence has no image generation route', 400);
    let item;
    if (owner.type === 'shot') item = await require('./final-request-plans')[kind === 'image' ? 'boardItem' : 'videoItem'](owner.id, {});
    else {
        const planned = await require('../routes/sequences').realSequenceRequests(owner.id, {}, true);
        if (planned.items.length !== 1) fail('This sequence currently plans several paid segments. Choose an explicit single video recipe or review each segment separately.');
        item = planned.items[0];
    }
    const snapshot = await require('./final-provider-request').resolveFinalRequest(item.provider, kind, item.payload);
    const fullPrompt = snapshot.body.encoding === 'multipart' ? snapshot.body.fields.find(f => f.name === 'prompt')?.value
        : snapshot.body.promptText ?? snapshot.body.prompt ?? snapshot.body.input?.find(part => part.type === 'text')?.text
            ?? (Array.isArray(snapshot.body.shots) ? JSON.stringify(snapshot.body.shots, null, 2) : undefined);
    if (typeof fullPrompt !== 'string') fail('The composed provider request has no full editable prompt');
    const allowed = new Set((require('./final-request-validation').supportedInputFields[`${item.provider}/${kind}`] || '').split(' '));
    const mediaFields = new Set(['reference_images','referenceImages','audio_references','reference_videos','init_image','image_url','image','end_image','last_frame','keyframes','promptImage','source_video','video_url','videoUri','video_uri']);
    const settings = {};
    for (const [key, value] of Object.entries(item.payload)) if (allowed.has(key) && !mediaFields.has(key) && !['prompt','promptText','motion_prompt','model','negative_prompt'].includes(key)) settings[key] = value;
    const recipe = { provider: item.provider, model: item.payload.model || (item.payload.runway_recipe === 'multi_shot_video' ? require('./providers').get(item.provider).defaultModel : snapshot.model),
        prompt: fullPrompt, ...(item.payload.negative_prompt ? { negative_prompt: item.payload.negative_prompt } : {}), settings, reference_images: [], audio_references: [] };
    if (Array.isArray(snapshot.body.shots)) recipe.prompt_format = 'native_shots_json';
    const unresolved = [], used = new Set();
    function identify(ref, index) {
        let asset = (ref.asset_id || ref.source_asset_id) && db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(ref.asset_id || ref.source_asset_id, projectId);
        const sourcePath = ref.source_path || ref.path;
        if (!asset && sourcePath) {
            const matches = db.prepare('SELECT * FROM film_assets WHERE project_id=? AND file_path=?').all(projectId, sourcePath);
            if (matches.length === 1) asset = matches[0];
        }
        if (!asset && !sourcePath) {
            // Native recipes may encode a path before preview. Match only their
            // captured source paths and exact bytes to a unique project asset.
            const candidates = [];
            for (const file of new Set(item.provenance?.source_paths || [])) {
                const matches = db.prepare('SELECT * FROM film_assets WHERE project_id=? AND file_path=?').all(projectId, file);
                for (const candidate of matches) {
                    try { if (hash(fs.readFileSync(candidate.file_path)) === ref.sha256) candidates.push(candidate); } catch (_) {}
                }
            }
            if (candidates.length === 1) asset = candidates[0];
        }
        let look = ref.moodboard_entry_id && db.prepare('SELECT * FROM film_mood_board WHERE id=? AND project_id=?').get(ref.moodboard_entry_id, projectId);
        if (!asset && !look && sourcePath) {
            const matches = db.prepare('SELECT * FROM film_mood_board WHERE project_id=? AND image_path=?').all(projectId, sourcePath);
            if (matches.length === 1) look = matches[0];
        }
        let file = asset?.file_path || look?.image_path;
        if (!file && look?.asset_id) file = db.prepare('SELECT file_path FROM film_assets WHERE id=? AND project_id=?').get(look.asset_id, projectId)?.file_path;
        let sourceBytes = null; try { sourceBytes = file && fs.readFileSync(file); } catch (_) {}
        if ((!asset && !look) || !sourceBytes || !bytesOf(ref)) {
            unresolved.push({ order: ref.order || index + 1, role: ref.role, name: ref.name || null,
                reason: 'The composed reference lacks a unique readable same-project source identity. Attach it explicitly.' });
            return { unresolved: true, reference_role: ref.role, order: ref.order || index + 1 };
        }
        const selection = { ...(asset ? { asset_id: asset.id } : {}), ...(look ? { moodboard_entry_id: look.id } : {}),
            reference_role: ref.role, uri: ref.data, sha256: ref.sha256, source_sha256: hash(sourceBytes), byte_length: ref.byte_length };
        for (const key of ['name','tag','character_id','location_id','prop_id']) if (ref[key] !== undefined) selection[key] = ref[key];
        if (look) Object.assign(selection, { influence_roles: parse(look.influence_roles), influence_note: look.influence_note || '' });
        return selection;
    }
    function findRef(value) {
        const source = typeof value === 'string' ? value : value?.uri || value?.url || value?.file_path || value?.path;
        const bytes = typeof source === 'string' && source.startsWith('data:') ? Buffer.from(source.split(',')[1], 'base64') : null;
        return snapshot.references.find(ref => !used.has(ref) && (bytes ? ref.sha256 === hash(bytes) : ref.path === source || ref.source_path === source));
    }
    // Keep native endpoint/keyframe roles as endpoint controls, rather than doubling them as plates.
    for (const field of ['keyframes','promptImage','init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri']) {
        if (!item.payload[field]) continue;
        const values = Array.isArray(item.payload[field]) ? item.payload[field] : [item.payload[field]];
        const refs = values.map(value => { const ref = findRef(value); if (!ref) { unresolved.push({ field, reason: 'The endpoint source bytes cannot be identified' }); return { unresolved: true }; }
            used.add(ref); return { ...identify(ref, snapshot.references.indexOf(ref)), ...(value.position ? { position: value.position } : {}) }; });
        recipe[field] = Array.isArray(item.payload[field]) ? refs : refs[0];
    }
    snapshot.references.forEach((ref,index) => {
        if (used.has(ref)) return;
        const selection = identify(ref,index);
        if (ref.mime.startsWith('audio/')) recipe.audio_references.push(selection);
        else if (ref.mime.startsWith('video/')) { recipe.reference_videos ||= []; recipe.reference_videos.push(selection); }
        else recipe.reference_images.push(selection);
    });
    return { recipe, ready: !unresolved.length, unresolved, warnings: snapshot.metadata?.not_sent_input_fields || item.payload.__not_sent_input_fields || [] };
}
function resultReviewId(result) { return result?.final_request_review_id || result?.meta?.final_request_review_id || null; }
function deliveryOf(plan, capability) {
    return { kind: plan.owner.type === 'sequence' ? 'sequence_video' : capability === 'image' ? 'shot_image' : 'shot_video',
        project_id: plan.owner.project_id, node_key: plan.owner.node_key, shot_id: plan.owner.shot_id,
        sequence_id: plan.owner.sequence_id, source_shot_ids: plan.provenance.source_shot_ids,
        baseline: plan.baseline, production_draft: plan.provenance.production_draft };
}
function recordedPayload(db, reviewId, delivery) {
    const row = db.prepare('SELECT editable_json,snapshot_json FROM film_final_request_reviews WHERE id=?').get(reviewId);
    if (!row) fail('The generated result has no approved request identity');
    const editable = parse(row.editable_json), spec = editable.provenance || {};
    if (spec.project_id !== delivery.project_id || canonical(spec.production_draft) !== canonical(delivery.production_draft)
        || (delivery.sequence_id && spec.sequence_id !== delivery.sequence_id) || (delivery.shot_id && spec.shot_id !== delivery.shot_id)) fail('The result is not bound to its original Production target and draft');
    return { payload: editable.payload, snapshot: parse(row.snapshot_json) };
}
function markDelivered(db, jobId, filed) {
    if (!jobId) return filed;
    db.prepare("UPDATE film_generation_jobs SET status='completed',asset_id=?,delivered_json=?,error=NULL,settled_at=datetime('now') WHERE id=?")
        .run(filed.asset_id, JSON.stringify(filed), jobId);
    return filed;
}
function filedDelivery(db, delivery, reviewId, jobId) {
    const image = delivery.kind === 'shot_image', sequence = delivery.kind === 'sequence_video';
    const existing = db.prepare(`SELECT * FROM film_assets WHERE project_id=? AND asset_type=?
        AND json_valid(metadata) AND json_extract(metadata,'$.final_request_review_id')=?
        AND ${sequence ? "json_extract(metadata,'$.sequence_id')=?" : 'shot_id=?'}`)
        .get(delivery.project_id,image?'storyboard':'video_raw',reviewId,sequence?delivery.sequence_id:delivery.shot_id);
    if (!existing) return null;
    const result = {ok:true,asset_id:existing.id,version:existing.version,file_path:existing.file_path,
        historical:!!parse(existing.metadata).historical,final_request_review_id:reviewId,
        ...(parse(existing.metadata).activation_warning?{activation_warning:parse(existing.metadata).activation_warning}:{})};
    const url = require('./file-storage').urlForPath(existing.file_path);
    if(sequence)Object.assign(result,{sequence_id:delivery.sequence_id,url});
    else Object.assign(result,{shot_id:delivery.shot_id,...(image?{image_url:url}:{video_url:url})});
    return markDelivered(db,jobId,result);
}
function fileProductionDraftFrame(db, { delivery, result, sourcePath, bytes, provider, model, jobId, reviewId }) {
    const id = reviewId || resultReviewId(result), recorded = recordedPayload(db, id, delivery);
    const owner = recipes.nodeOwner(db, delivery.project_id, delivery.node_key);
    if (owner.type !== 'shot' || owner.id !== delivery.shot_id) fail('The image result has a different original target');
    const shot = db.prepare('SELECT shot_code FROM film_shots WHERE id=?').get(owner.id);
    const buffer = bytes || (sourcePath ? fs.readFileSync(sourcePath) : null);
    if (!Buffer.isBuffer(buffer) || !buffer.length) fail('The generated frame has no saved bytes');
    return db.transaction(() => {
        const prior = filedDelivery(db,delivery,id,jobId);if(prior)return prior;
        const unchanged = deliveryUnchanged(db, owner, delivery, jobId);
        const selected = require('./selected-frame').selectedFrame(db, owner.id);
        const version = (db.prepare("SELECT MAX(version) AS version FROM film_assets WHERE shot_id=? AND asset_type IN ('storyboard','keyframe')").get(owner.id).version || 0) + 1;
        const assetId = require('../db/database').generateId();
        const png = buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
        const jpeg = buffer[0] === 255 && buffer[1] === 216;
        const webp = buffer.toString('latin1',0,4) === 'RIFF' && buffer.toString('latin1',8,12) === 'WEBP';
        const format = png ? 'png' : jpeg ? 'jpg' : webp ? 'webp' : 'bin';
        const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : null;
        const fileName = `${shot.shot_code}_v${version}_${assetId.slice(0,8)}.${format}`;
        const dir = path.join(require('../lib/file-storage').ensureDir(owner.project_id, 'storyboards'), 'versions'); fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, fileName); fs.writeFileSync(filePath, buffer, { flag: 'wx' });
        const dimensions = require('./image-raster').dimensionsOfBuffer(buffer);
        const width = dimensions?.width || null, height = dimensions?.height || null;
        const metadata = { final_request_review_id: id, production_draft: delivery.production_draft,
            generation_job_id: jobId || null, prompt: recorded.payload.final_prompt || recorded.payload.prompt,
            seed: recorded.payload.seed ?? null, historical: !unchanged };
        db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,format,mime_type,width,height,version,provider,provider_model,metadata,input_refs) VALUES(?,?,?,'storyboard',?,?,?,?,?,?,?,?,?,?,?)")
            .run(assetId, owner.project_id, owner.id, filePath, fileName, format, mime, width, height, version, provider || recorded.snapshot.provider,
                model || recorded.snapshot.model, JSON.stringify(metadata), JSON.stringify(recorded.snapshot.references.map(r => r.asset_id || r.source_asset_id).filter(Boolean)));
        if (unchanged) db.prepare('UPDATE film_shots SET current_frame_version=?,status=? WHERE id=?').run(version, 'complete', owner.id);
        else if (selected) db.prepare('UPDATE film_shots SET current_frame_version=COALESCE(current_frame_version,?) WHERE id=?').run(selected.version, owner.id);
        return markDelivered(db, jobId, { ok: true, asset_id: assetId, shot_id: owner.id, version, file_path: filePath,
            image_url: `/film/storyboards/${owner.project_id}/${fileName}`, historical: !unchanged, final_request_review_id: id });
    }).immediate();
}
function fileProductionDraftVideo(db, { delivery, result, filePath, provider, model, jobId, reviewId }) {
    const id = reviewId || resultReviewId(result), recorded = recordedPayload(db, id, delivery);
    const owner = recipes.nodeOwner(db, delivery.project_id, delivery.node_key);
    if (owner.type !== 'shot' || owner.id !== delivery.shot_id) fail('The video result has a different original target');
    return db.transaction(() => {
        const prior = filedDelivery(db,delivery,id,jobId);if(prior)return prior;
        const unchanged = deliveryUnchanged(db, owner, delivery, jobId), selected = require('./conform').selectedClip(db, owner.id);
        const version = (db.prepare("SELECT MAX(version) AS version FROM film_assets WHERE shot_id=? AND asset_type LIKE 'video_%'").get(owner.id).version || 0) + 1;
        const assetId = require('../db/database').generateId();
        const durationMs = Number(recorded.snapshot.body.duration ?? recorded.payload.duration_s ?? recorded.payload.duration) * 1000 || null;
        const metadata = { final_request_review_id: id, production_draft: delivery.production_draft,
            generation_job_id: jobId || null, prompt: recorded.payload.final_prompt || recorded.payload.prompt,
            seed: recorded.payload.seed ?? null, historical: !unchanged };
        db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,format,mime_type,duration_ms,version,provider,provider_model,metadata,input_refs) VALUES(?,?,?,'video_raw',?,?,'mp4','video/mp4',?,?,?,?,?,?)")
            .run(assetId, owner.project_id, owner.id, filePath, path.basename(filePath), durationMs, version,
                provider || recorded.snapshot.provider, model || recorded.snapshot.model, JSON.stringify(metadata),
                JSON.stringify(recorded.snapshot.references.map(r => r.asset_id || r.source_asset_id).filter(Boolean)));
        if (unchanged) db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(assetId, owner.id);
        else if (selected) db.prepare('UPDATE film_shots SET selected_video_asset_id=COALESCE(selected_video_asset_id,?) WHERE id=?').run(selected.id, owner.id);
        return markDelivered(db, jobId, { ok: true, asset_id: assetId, shot_id: owner.id, version, file_path: filePath,
            video_url: require('./file-storage').getFileUrl('video', owner.project_id, path.basename(filePath)), historical: !unchanged, final_request_review_id: id });
    }).immediate();
}
function fileProductionDraftSequence(db, { delivery, result, filePath, provider, model, jobId, reviewId }) {
    const id = reviewId || resultReviewId(result), recorded = recordedPayload(db, id, delivery);
    const owner = recipes.nodeOwner(db, delivery.project_id, delivery.node_key);
    if (owner.type !== 'sequence' || owner.id !== delivery.sequence_id) fail('The sequence result has a different original target');
    const members = delivery.source_shot_ids || [], lead = members[0];
    if (!lead) fail('The captured sequence has no narrative shots');
    recipes.nodeOwner(db, owner.project_id, `shot:${lead}`);
    return db.transaction(() => {
        const prior = filedDelivery(db,delivery,id,jobId);if(prior)return prior;
        let unchanged = deliveryUnchanged(db, owner, delivery, jobId), activationWarning = null;
        const narrative=db.prepare(`SELECT sh.id FROM film_shots sh JOIN film_scenes s ON s.id=sh.scene_id WHERE s.project_id=? ORDER BY ${require('./running-order').ORDER_BY_SQL}`).all(owner.project_id).map(row=>row.id);
        if(unchanged && canonical(narrative.filter(id=>members.includes(id)))!==canonical(members)) {
            unchanged=false;activationWarning='The captured sequence order differs from the narrative cut. This version remains in history.';
        }
        const selectedLead = require('./conform').selectedClip(db,lead);
        const version = (db.prepare("SELECT MAX(version) AS version FROM film_assets WHERE project_id=? AND json_valid(metadata) AND json_extract(metadata,'$.sequence_id')=?").get(owner.project_id, owner.id).version || 0) + 1;
        const assetId = require('../db/database').generateId();
        const metadata = { sequence_id: owner.id, kind: delivery.asset_kind || 'production_sequence', final_request_review_id: id,
            production_draft: delivery.production_draft, generation_job_id: jobId || null, original_shot_ids: members,
            prompt: recorded.payload.final_prompt || recorded.payload.prompt, historical: !unchanged,
            ...(activationWarning?{activation_warning:activationWarning}:{}) };
        const durationMs = Number(recorded.snapshot.body.duration ?? recorded.payload.duration_s ?? recorded.payload.duration) * 1000 || null;
        db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,format,mime_type,duration_ms,version,provider,provider_model,metadata) VALUES(?,?,?,'video_raw',?,?,'mp4','video/mp4',?,?,?,?,?)")
            .run(assetId, owner.project_id, lead, filePath, path.basename(filePath), durationMs, version, provider || recorded.snapshot.provider,
                model || recorded.snapshot.model, JSON.stringify(metadata));
        if (unchanged) {
            try {
                db.transaction(() => {
                    const previous = db.prepare('SELECT selected_video_asset_id FROM film_sequences WHERE id=?').get(owner.id);
                    if (previous.selected_video_asset_id) require('./clip-coverage').setCoverage(db, previous.selected_video_asset_id, []);
                    require('./clip-coverage').setCoverage(db, assetId, members);
                    db.prepare('UPDATE film_shots SET selected_video_asset_id=? WHERE id=?').run(assetId, lead);
                    db.prepare("UPDATE film_sequences SET selected_video_asset_id=?,output_asset_id=?,status='complete' WHERE id=?").run(assetId, assetId, owner.id);
                })();
            } catch(error) {
                unchanged=false;activationWarning=error.message;
                metadata.historical=true;metadata.activation_warning=activationWarning;
                db.prepare('UPDATE film_assets SET metadata=? WHERE id=?').run(JSON.stringify(metadata),assetId);
            }
        }
        if(!unchanged && selectedLead)db.prepare('UPDATE film_shots SET selected_video_asset_id=COALESCE(selected_video_asset_id,?) WHERE id=?').run(selectedLead.id,lead);
        return markDelivered(db, jobId, { ok: true, asset_id: assetId, sequence_id: owner.id, version, file_path: filePath,
            url: require('./file-storage').getFileUrl('video', owner.project_id, path.basename(filePath)), historical: !unchanged,
            ...(activationWarning?{activation_warning:activationWarning}:{}),final_request_review_id: id });
    }).immediate();
}
module.exports = { resolveDraftRequest, plannedDraft, starterDraft, draftEvidence, selectionBaseline, selectionUnchanged, resultReviewId,
    deliveryOf, fileProductionDraftFrame, fileProductionDraftVideo, fileProductionDraftSequence };
