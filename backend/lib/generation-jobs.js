/**
 * A generation the host abandons is not lost.
 *
 * Every async provider here returns an id the moment it accepts a job, and that
 * id lived only in a local variable inside the poll loop. A tool call through
 * an MCP host is abandoned at sixty seconds; a generation still polling then is
 * not slow, it is LOST — the handler is torn down mid-await, nothing reaches
 * film_assets, and the caller is told the device did not respond. That reads
 * like a connection fault. It is not: the provider very likely finished and
 * billed for it, and the result had nowhere to be delivered.
 *
 * Measured across the adapters that poll: meshy and seedance budget FIFTEEN
 * MINUTES, bfl and runway five, against a sixty-second abort.
 *
 * NO TIMEOUT VALUE FIXES THIS. No budget is both longer than a 4K render and
 * shorter than the abort, so shortening them alone trades a lost result for a
 * failed one and still burns the money. What fixes it is writing the handle
 * down BEFORE polling: the process can die, the host can abort, and the job is
 * still collectable.
 *
 * The happy path is deliberately unchanged. The adapter still polls and still
 * returns bytes; this only means the id was written down first.
 */

/**
 * How long a caller may wait, and who decides.
 *
 * THE BUDGET BELONGS TO THE CALLER, NOT THE ADAPTER. An HTTP request can wait
 * fifteen minutes for a mesh and nothing abandons it. A tool call has sixty
 * seconds whatever the adapter would prefer. An adapter with a hardcoded budget
 * cannot be run safely from both, which is why every one of them now takes
 * `opts.timeout` and this decides what to pass.
 *
 * Declared by the MCP SERVER PROCESS rather than detected, because that process
 * is the one with the constraint — `backend/mcp-server.js` is a separate
 * program from `backend/server.js`, so an environment variable set at its own
 * startup is unambiguous and cannot leak into the HTTP path.
 */
const COLLECT_MARGIN_MS = 15000;
const collections = new Map();

function hostWindowMs() {
    const raw = Number(process.env.FILM_HOST_ABORT_MS || 0);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * The margin is not politeness. The adapter has to notice the deadline, stop
 * polling, write the handle, and return a message the model can act on — all
 * before the host stops listening. A budget equal to the window produces the
 * exact failure this exists to prevent, one layer down.
 */
function budgetFor(defaultMs) {
    const window = hostWindowMs();
    const asked = Number(defaultMs) || 0;
    if (!window) return asked;                       // nothing abandons this caller
    const room = Math.max(20000, window - COLLECT_MARGIN_MS);
    return asked ? Math.min(asked, room) : room;
}

/** Lazily, because lib modules are required by tests that never open a database. */
function handle() {
    const { db, generateId } = require('../db/database');
    return { db, generateId };
}

/**
 * Write the handle down.
 *
 * NEVER THROWS. By the time this runs the request has been made and the money
 * is gone; turning a paid, accepted generation into an error because the
 * bookkeeping failed is the worst trade available — the rule `stampAsset`
 * already documents for fingerprinting.
 *
 * A duplicate (provider, request_id) is the SAME job seen twice, so it returns
 * the existing row rather than recording a second one: two rows for one request
 * would offer a collect that has already happened.
 */
function record(job) {
    try {
        const j = job || {};
        if (!j.provider || !j.requestId) return null;
        const { db, generateId } = handle();
        const existing = db.prepare(
            'SELECT id FROM film_generation_jobs WHERE provider = ? AND request_id = ?'
        ).get(String(j.provider), String(j.requestId));
        if (existing) return existing.id;

        const id = generateId();
        db.prepare(`INSERT INTO film_generation_jobs
            (id, project_id, shot_id, scene_id, provider, capability, request_id, meta)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, j.projectId || null, j.shotId || null, j.sceneId || null,
                 String(j.provider), String(j.capability || 'unknown'), String(j.requestId),
                 JSON.stringify(j.meta || {}));
        return id;
    } catch (_) {
        // A generation must never fail because its receipt could not be filed.
        return null;
    }
}

function settle(jobId, status, patch) {
    try {
        if (!jobId) return false;
        const { db } = handle();
        db.prepare(`UPDATE film_generation_jobs
            SET status = ?, asset_id = ?, error = ?, settled_at = datetime('now')
            WHERE id = ?`)
            .run(status, (patch && patch.assetId) || null, (patch && patch.error) || null, jobId);
        return true;
    } catch (_) { return false; }
}

const complete = (jobId, patch) => settle(jobId, 'completed', patch || {});
const fail = (jobId, error) => settle(jobId, 'failed', { error: String(error || '').slice(0, 2000) });

/** What is still outstanding, newest first. */
function pending(projectId) {
    try {
        const { db } = handle();
        return projectId
            ? db.prepare(`SELECT * FROM film_generation_jobs
                 WHERE project_id = ? AND status = 'pending' AND collectable = 1 ORDER BY created_at DESC`).all(projectId)
            : db.prepare(`SELECT * FROM film_generation_jobs
                 WHERE status = 'pending' AND collectable = 1 ORDER BY created_at DESC`).all();
    } catch (_) { return []; }
}

/**
 * Jobs this engine settled as FAILED that the provider may still hold.
 *
 * Surfaced because `pending` alone cannot see them, and a failure caused by
 * this side -- a misread result field, a storage error -- leaves a rendered,
 * billed clip sitting on the provider's CDN with nothing pointing at it. Free
 * to ask about and free to collect, so the only cost of listing them is a line
 * of output; the cost of NOT listing them is re-buying footage that exists.
 *
 * Bounded to a week: a handle old enough that the provider has expired its
 * result is a false promise, and offering it is worse than silence.
 */
function recoverable(projectId) {
    try {
        const { db } = handle();
        const sql = `SELECT * FROM film_generation_jobs
             WHERE (status = 'failed' OR (status='completed' AND delivered_json IS NULL
               AND json_valid(meta) AND (json_extract(meta,'$.storyboard_frame.shot_id') IS NOT NULL
                 OR json_extract(meta,'$.production_delivery.node_key') IS NOT NULL
                 OR json_extract(meta,'$.sequence_id') IS NOT NULL)))
               AND request_id IS NOT NULL AND (collectable = 1 OR json_extract(meta,'$.approval_id') IS NOT NULL)
               AND created_at >= datetime('now', '-7 days')`;
        return projectId
            ? db.prepare(`${sql} AND project_id = ? ORDER BY created_at DESC`).all(projectId)
            : db.prepare(`${sql} ORDER BY created_at DESC`).all();
    } catch (_) { return []; }
}

function get(jobId) {
    try {
        const { db } = handle();
        return db.prepare('SELECT * FROM film_generation_jobs WHERE id = ?').get(jobId) || null;
    } catch (_) { return null; }
}

/** Preserve successful provider output before local delivery starts. */
function accepted(jobId, result) {
    if (!jobId || !result || !result.ok) return false;
    try {
        return !!handle().db.prepare(`UPDATE film_generation_jobs SET result_json=?,
            status='pending',collectable=1,error=NULL,settled_at=NULL WHERE id=? AND delivered_json IS NULL`)
            .run(JSON.stringify(result), jobId).changes;
    } catch (_) { return false; }
}

/** Meter the frozen native request, including edits made in its review. */
function meterPlan(provider, capability, payload, snapshot, result) {
    const body=snapshot?.body?.encoding==='multipart'
        ? Object.fromEntries(snapshot.body.fields.filter(f=>f.value!==undefined).map(f=>[f.name,f.value])) : snapshot?.body || {};
    const input={...snapshot?.metadata,...body,model:snapshot?.model};
    const duration=body.duration_seconds ?? body.duration_s ?? body.duration ?? snapshot?.metadata?.durationSeconds;
    if(duration!==undefined)input.duration_s=input.duration_seconds=input.duration=Number(duration);
    const sections=body.composition_plan?.sections || body.composition_plan?.chunks;
    if(Array.isArray(sections)&&sections.length)input.duration_ms=sections.reduce((sum,section)=>sum+Number(section.duration_ms),0);
    const usage=require('./providers').get(provider)?.meter?.(capability,input,result);
    if(usage?.provider_confirmed && Number(usage.quantity)>0)return {...usage};
    const quote=require('./final-request-review').quoteFor(snapshot),billing=quote.billing;
    if(quote.amount===null || !(billing?.quantity>0) || !billing.unit)return null;
    return {...usage,model:billing.model,unit:billing.unit,quantity:billing.quantity,
        ...(billing.native_charged!==undefined?{native_charged:billing.native_charged}:{}),
        provider_confirmed:false,estimated:true,estimate_basis:'Frozen approved native request and local rate book'};
}
function retainMeter(jobId,meter) {
    if(!jobId || !meter)return false;
    try { return !!handle().db.prepare("UPDATE film_generation_jobs SET meta=json_set(COALESCE(meta,'{}'),'$.meter',json(?)) WHERE id=?").run(JSON.stringify(meter),jobId).changes; }
    catch(_){return false;}
}

function restoredResult(value) {
    const out = typeof value === 'string' ? JSON.parse(value) : { ...value };
    if (out.data === undefined && out.url) out.data={url:out.url};
    const data = out && out.data;
    if (data && data.type === 'Buffer' && Array.isArray(data.data)) out.data = Buffer.from(data.data);
    // Older review canonicalization serialized Buffer as numeric object keys.
    // Decode only actual result.data, with contiguous keys and byte values.
    else if (data && typeof data === 'object' && !Array.isArray(data)) {
        const keys = Object.keys(data);
        if (keys.length && keys.every((k, i) => k === String(i) && Number.isInteger(data[k]) && data[k] >= 0 && data[k] <= 255)) {
            out.data = Buffer.from(keys.map(k => data[k]));
        }
    }
    return out;
}

/** Reconcile a durable approved receipt when the generation-job write failed. */
function reconcileReview(reviewId) {
    let review;
    try { review = require('./final-request-review').store().get(reviewId); } catch (_) { return null; }
    if (!['submitted', 'completed'].includes(review.state) || (!review.request_id && !review.result?.ok)) return null;
    const p = review.editable.provenance || {}, provider = review.snapshot.provider, capability = review.snapshot.capability;
    const { db } = handle();
    const receiptMeta=review.result?._final_request_receipt?.job_meta || {};
    let meta = { ...p, ...receiptMeta, approval_id: review.id };
    // A pipeline created after preview records the receipt-to-run binding in
    // its own durable state. Recover only that captured task and original shot.
    if (p.pipeline_task && !meta.pipeline_delivery) {
        const runs = db.prepare('SELECT id,project_id,params FROM film_pipeline_runs WHERE project_id=?').all(p.project_id);
        for (const run of runs) {
            let state; try { state = JSON.parse(run.params || '{}').final_pipeline; } catch (_) {}
            if (state?.recovery?.some(r => r.step_id === p.pipeline_task && r.receipts?.includes(review.id))) {
                meta.pipeline_delivery = { run_id: run.id, task_key: p.pipeline_task, step_id: p.node_id, item_index: p.item_index };
                break;
            }
        }
        if (!meta.pipeline_delivery) return null;
    }
    let meter = null;
    try { meter = meterPlan(provider,capability,review.editable.payload,review.snapshot,review.result); } catch (_) {}
    if (meter) meta.meter = meter;
    const requestId = review.request_id || 'review:' + review.id;
    let existing = db.prepare("SELECT * FROM film_generation_jobs WHERE json_valid(meta) AND json_extract(meta,'$.approval_id')=?").get(review.id);
    if (existing && (existing.provider !== provider || existing.capability !== capability || existing.project_id !== (p.project_id || null) || existing.shot_id !== (p.shot_id || null))) return null;
    if (existing && existing.request_id.startsWith('local:')) {
        db.prepare('UPDATE film_generation_jobs SET request_id=?,collectable=1 WHERE id=?').run(requestId, existing.id);
    }
    const id = existing?.id || record({ provider, capability, requestId, projectId: p.project_id, shotId: p.shot_id, sceneId: p.scene_id, meta });
    if (!id) return null;
    if(meter)retainMeter(id,meter);
    const saved=get(id);
    if (review.result?.ok && !saved.result_json && !saved.delivered_json && (!existing || existing.status !== 'completed' || meta.pipeline_delivery || meta.storyboard_frame || meta.production_delivery || meta.sequence_id)) accepted(id, restoredResult(review.result));
    return get(id);
}

function receiptSource(job, meta) { return meta.approval_id ? 'final-review:' + meta.approval_id : 'generation-job:' + job.id; }

function postUsage(job, meta) {
    if (meta?.meter && Number(meta.meter.quantity) > 0) {
        require('./usage-meter').recordUsage({
            provider:job.provider,capability:job.capability,model:meta.meter.model || '',
            unit:meta.meter.unit,quantity:meta.meter.quantity,parts:meta.meter.parts || null,
            estimated:!!meta.meter.estimated,estimate_basis:meta.meter.estimate_basis || '',
            native_charged:meta.meter.native_charged,provider_confirmed:meta.meter.provider_confirmed,
            projectId:job.project_id || null,shotId:meta.from_shot_id || job.shot_id || null,
            sceneId:job.scene_id || null,sourceRef:receiptSource(job,meta),
        });
    }
}

function retainedReceipts(projectId) {
    try {
        const sql=`SELECT r.id, r.id AS review_id, r.request_id,
            json_extract(r.snapshot_json,'$.provider') AS provider,
            json_extract(r.snapshot_json,'$.capability') AS capability, r.created_at
            FROM film_final_request_reviews r
            WHERE r.state IN ('submitted','completed') AND (r.request_id IS NOT NULL OR r.result_json IS NOT NULL)
            AND r.created_at>=datetime('now','-7 days')
            AND NOT EXISTS (SELECT 1 FROM film_generation_jobs j WHERE
                (j.provider=json_extract(r.snapshot_json,'$.provider') AND j.request_id=r.request_id)
                OR (json_valid(j.meta) AND json_extract(j.meta,'$.approval_id')=r.id))`;
        return projectId ? handle().db.prepare(sql+" AND json_extract(r.editable_json,'$.provenance.project_id')=?").all(projectId) : handle().db.prepare(sql).all();
    } catch (_) { return []; }
}

function checkBinding(opts, meta) {
    if (!opts?.belongs_to && !opts?.metaPatch) return;
    const supplied=[opts.belongs_to,opts.metaPatch].filter(Boolean);
    if (meta.production_delivery && supplied.some(value => Object.keys(value).length)) {
        throw Object.assign(new Error('This accepted Production request is bound to its captured recipe and target'), { status:409 });
    }
    const sequenceKeys=['sequence_id','from','to','from_shot_id'];
    const hasSequence=supplied.some(b=>sequenceKeys.some(k=>b[k]!==undefined));
    if(hasSequence && (plateBindingOf(null,meta)||frameBindingOf(null,meta)||meta.pipeline_delivery||meta.expression_delivery||meta.inbetween_id||meta.slot_id)) {
        throw Object.assign(new Error('This accepted job is bound to its captured delivery kind'),{status:409});
    }
    if(meta.sequence_id && supplied.some(b=>b.kind || sequenceKeys.some(k=>b[k]!==undefined && b[k]!==meta[k]))) {
        throw Object.assign(new Error('This accepted job is bound to its original sequence leg'),{status:409});
    }
    const canonical=require('./final-request-review').canonical;
    if (meta.recovery_binding && canonical(meta.recovery_binding)!==canonical(opts.belongs_to || legacyMetaPatch(opts,meta))) {
        throw Object.assign(new Error('This recovered job is bound to its first captured target'), {status:409});
    }
    if(!opts.belongs_to)return;
    const stored = plateBindingOf(null, meta) || frameBindingOf(null, meta);
    const requested = plateBindingOf(opts, {}) || frameBindingOf(opts, {});
    const mismatch = stored && requested && (stored.shot_id ? stored.shot_id !== requested.shot_id :
        stored.kind !== requested.kind || stored.subjectId !== requested.subjectId || (stored.view || '') !== (requested.view || (requested.kind==='character' ? 'front' : '')));
    if (mismatch) {
        throw Object.assign(new Error('This accepted job is bound to its original target'), { status: 409 });
    }
    if (meta.sequence_id && ['sequence_id','from','to','from_shot_id'].some(k => opts.belongs_to[k] !== undefined && opts.belongs_to[k] !== meta[k])) {
        throw Object.assign(new Error('This accepted job is bound to its original sequence leg'), { status: 409 });
    }
    if (meta.pipeline_delivery && Object.keys(opts.belongs_to).length) {
        throw Object.assign(new Error('This accepted pipeline job is bound to its original task'), { status: 409 });
    }
    if ((meta.inbetween_id || meta.slot_id) && Object.keys(opts.belongs_to).length) {
        throw Object.assign(new Error('This accepted job is bound to its original captured slot or span'), { status:409 });
    }
}

function legacyMetaPatch(opts,meta={}) {
    if(plateBindingOf(null,meta)||frameBindingOf(null,meta)||meta.production_delivery||meta.pipeline_delivery||meta.expression_delivery||meta.inbetween_id||meta.slot_id)return {};
    return Object.fromEntries(['sequence_id','from','to','from_shot_id'].filter(k=>opts?.metaPatch?.[k]!==undefined).map(k=>[k,opts.metaPatch[k]]));
}

/**
 * The result an adapter returns when it ran out of budget but the job is alive.
 *
 * `ok: false` because no bytes came back, and `pending: true` because that is a
 * different thing from a failure — the reported symptom was "the device did not
 * respond", which reads as a connection fault and sends the reader to the wrong
 * problem entirely. Naming the handle and the way to collect it is the whole
 * difference between a lost render and one that is simply not finished.
 */
function timedOut(info) {
    const i = info || {};
    const waited = i.waitedMs ? `${Math.round(i.waitedMs / 1000)}s` : 'its budget';
    const where = i.jobId ? `job ${i.jobId}` : `${i.provider} request ${i.requestId}`;
    return {
        ok: false,
        pending: true,
        status: 202,
        job_id: i.jobId || null,
        provider: i.provider || null,
        request_id: i.requestId || null,
        error: `${i.provider || 'the provider'} did not finish within ${waited}. `
            + `It is still running and has NOT been lost — collect it with `
            + `generation_collect (${where}). This call stopped early because the `
            + `agent host abandons a tool call at 60s.`,
    };
}


/**
 * Turn a stored handle back into a delivered asset.
 *
 * This is the half that makes the record worth keeping. It polls the provider
 * with the SAME function the live path uses, so a collected result cannot
 * differ from one that arrived normally, then files it where that capability's
 * output belongs -- read from `media-kinds`, the one registry that says so,
 * rather than restated here.
 *
 * A job that is still running stays `pending` and says so: collecting is
 * idempotent and safe to retry, which is the whole point of a handle. A job
 * whose provider reports failure is settled as failed, because a handle that
 * can never be collected must stop being offered.
 */
function safeMeta(job) {
    try { return JSON.parse((job && job.meta) || '{}'); } catch (_) { return {}; }
}

/**
 * The plate an untagged handle was bought for, named by the caller.
 *
 * `belongs_to: { kind, subject_id, view? }` — for a job recorded before the
 * engine stamped what it was, which is every plate generated before
 * `plate-delivery` existed. Those results are not lost; they are unclaimed.
 */
function plateBindingOf(opts, meta) {
    const b = opts && opts.belongs_to;
    if (b && b.kind && (b.subject_id || b.subjectId)) {
        return { kind: String(b.kind), subjectId: b.subject_id || b.subjectId, view: b.view || '' };
    }
    // A location or prop plate stamps itself under `plate`.
    const p = meta && meta.plate;
    if (p && p.kind && p.subject_id && !p.explore) {
        return { kind: String(p.kind), subjectId: p.subject_id, view: p.view || '' };
    }
    const stamped = meta && meta[require('./plate-delivery').JOB_META_KEY];
    if (stamped && stamped.character_id) {
        return { kind: 'character', subjectId: stamped.character_id, view: stamped.view || 'front',
                 styleApplied: stamped.style_applied };
    }
    return null;
}

/**
 * The shot whose LIVE frame a handle was bought for. The four board paths that
 * write a shot's frame stamp `storyboard_frame` on the handle; an older handle
 * can be named by the caller with `belongs_to: { kind: 'storyboard_frame', shot_id }`.
 */
function frameBindingOf(opts, meta) {
    const b = opts && opts.belongs_to;
    if (b && b.kind === 'storyboard_frame' && b.shot_id) return { shot_id: b.shot_id };
    const f = meta && meta.storyboard_frame;
    if (f && f.shot_id) return f;
    return null;
}

function matchingFiledFrame(job,meta,out) {
    const frame=meta.storyboard_frame;
    if(!frame)return null;
    const {db}=handle(),fs=require('fs');
    const candidates=db.prepare("SELECT * FROM film_assets WHERE project_id=? AND shot_id=? AND asset_type='storyboard'").all(job.project_id,frame.shot_id);
    const bytes=Buffer.isBuffer(out.data)?out.data:null;
    if(bytes)for(const asset of candidates){
        let evidence={};try{evidence=JSON.parse(asset.metadata||'{}');}catch(_){}
        if((evidence.generation_job_id && evidence.generation_job_id!==job.id)||(evidence.collected_from_job && evidence.collected_from_job!==job.id))continue;
        if((asset.provider||evidence.provider)!==job.provider || (asset.provider_model||evidence.provider_model)!==(out.provider_model||meta.meter?.model||''))continue;
        if(!(frame.width>0&&frame.height>0&&asset.width===frame.width&&asset.height===frame.height))continue;
        if(frame.direction_mode && evidence.direction_mode!==frame.direction_mode)continue;
        try{if(fs.readFileSync(asset.file_path).equals(bytes))return asset;}catch(_){}
    }
    // Older receipts cannot distinguish a conformed live save from a new frame.
    // Keep their accepted bytes available instead of creating an anonymous duplicate.
    const baseline=frame.delivery_baseline;
    const later=candidates.filter(asset=>!baseline || asset.id!==baseline.latest_asset_id && asset.version>(baseline.latest_version||0));
    const ambiguous=later.some(asset=>{let evidence={};try{evidence=JSON.parse(asset.metadata||'{}');}catch(_){}return !evidence.generation_job_id && !evidence.collected_from_job;});
    if(candidates.length && (!baseline || ambiguous))throw new Error('The original frame receipt has no filing identity; existing storyboard versions require explicit reconciliation. Its accepted output is retained.');
    return null;
}

/** File a frame a job delivered as that shot's live storyboard frame. */
function fileFrame(job, frame, sourcePath, meta) {
    const {db}=handle();
    return db.transaction(()=>{
        const baseline=frame.delivery_baseline;
        const selected=db.prepare('SELECT current_frame_version FROM film_shots WHERE id=?').get(frame.shot_id);
        const latest=db.prepare("SELECT id,version FROM film_assets WHERE shot_id=? AND asset_type IN ('storyboard','keyframe') ORDER BY version DESC LIMIT 1").get(frame.shot_id);
        const changed=baseline && (selected?.current_frame_version!==baseline.selected_version || (latest?.id||null)!==baseline.latest_asset_id);
        if(changed){
            const path=require('path'),fs=require('fs'),bytes=fs.readFileSync(sourcePath);
            const fitted=frame.width>0&&frame.height>0?require('./board-raster').conformBoardBuffer(bytes,{width:frame.width,height:frame.height}).buffer:bytes;
            fs.writeFileSync(sourcePath,fitted);
            const id=handle().generateId(),version=(latest?.version||0)+1;
            db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,format,mime_type,width,height,version,provider,provider_model,metadata) VALUES(?,?,?,'storyboard',?,?,'png','image/png',?,?,?,?,?,?)").run(id,job.project_id,frame.shot_id,sourcePath,path.basename(sourcePath),frame.width||null,frame.height||null,version,job.provider,meta.meter?.model||'',JSON.stringify({generation_job_id:job.id,collected_from_job:job.id,direction_mode:frame.direction_mode||'action',recovered_history:true}));
            if(selected?.current_frame_version===null&&latest)db.prepare('UPDATE film_shots SET current_frame_version=? WHERE id=?').run(latest.version,frame.shot_id);
            return {ok:true,asset_id:id,shot_id:frame.shot_id,file_path:sourcePath,historical:true};
        }
        const filed = require('../routes/storyboard').fileCollectedFrame({
            shotId: frame.shot_id, sourcePath,
            provider: job.provider, providerModel: (meta && meta.meter && meta.meter.model) || '',
            jobId: job.id, prompt: frame.prompt, negativePrompt: frame.negative_prompt, seed: frame.seed,
            width: frame.width, height: frame.height, directionMode: frame.direction_mode,
        });
        // registerStoryboardAsset keeps an explicit metadata allowlist. Stamp
        // the delivery identity in the same transaction as its asset insert.
        if(filed.ok)db.prepare("UPDATE film_assets SET metadata=json_set(COALESCE(metadata,'{}'),'$.collected_from_job',?,'$.generation_job_id',?) WHERE id=?").run(job.id,job.id,filed.asset_id);
        return filed;
    }).immediate();
}

/** File the picture a settled job left on disk as the plate it was bought for. */
async function adoptPlate(job, plate) {
    const meta = safeMeta(job);
    const delivery = require('./plate-delivery');
    const { PERSIST_EXT, SUBDIR } = require('./media-kinds');
    const { getFilePath } = require('./file-storage');
    const ext = (PERSIST_EXT && PERSIST_EXT[job.capability]) || 'bin';
    const subdir = (SUBDIR && SUBDIR[job.capability]) || 'storyboards';
    let onDisk = null;
    try { onDisk = getFilePath(job.project_id, subdir, `collected_${job.id}.${ext}`); } catch (_) { onDisk = null; }
    const filed = onDisk && await delivery.adoptFile({
        filePath: onDisk,
        kind: plate.kind, projectId: job.project_id, subjectId: plate.subjectId, view: plate.view,
        provider: job.provider, providerModel: (meta.meter && meta.meter.model) || '',
        providerJobId: job.request_id, collectedFromJob: job.id,
    });
    if (filed && filed.ok) {
        return { ok: true, job_id: job.id, adopted: true, plate: filed,
            note: 'This job had already been collected but never filed. The picture it left on disk '
                + 'is now the plate for that subject — nothing was regenerated or re-bought.' };
    }
    return { ok: false, status: 409, job_id: job.id,
        error: `job ${job.id} is ${job.status} and its collected file could not be adopted`
             + `${filed && filed.error ? ` — ${filed.error}` : ''}` };
}

async function collect(jobId, opts = {}) {
    let job = get(jobId);
    if (!job) job = reconcileReview(jobId);
    // A handle attachment can fail while leaving the local progress row.
    if (job && safeMeta(job).approval_id && (!job.collectable || !safeMeta(job).meter)) job = reconcileReview(safeMeta(job).approval_id) || job;
    if (!job) return { ok: false, status: 404, error: `no generation job ${jobId}` };
    const meta = safeMeta(job);
    const unfiledExpression=meta.expression_delivery&&!handle().db.prepare("SELECT id FROM film_assets WHERE json_valid(metadata) AND json_extract(metadata,'$.reference_role')='expression' AND json_extract(metadata,'$.collected_from_job')=?").get(job.id);
    if (!job.result_json && meta.approval_id && (job.status!=='completed' || meta.production_delivery || meta.sequence_id || meta.pipeline_delivery || meta.storyboard_frame || unfiledExpression)) {
        // A failed output-cache write still leaves the owner's complete native
        // receipt. Use those bytes before asking the provider for them again.
        let review;try{review=require('./final-request-review').store().get(meta.approval_id);}catch(_){}
        if(review?.state==='completed'&&review.result?.ok){accepted(job.id,restoredResult(review.result));job=get(job.id);}
    }
    try { checkBinding(opts, meta); } catch (error) { return { ok:false,status:error.status,error:error.message,job_id:job.id }; }
    // Callers in this process share the original delivery promise. The DB
    // lease below still arbitrates collectors in other server processes.
    if (collections.has(job.id)) return collections.get(job.id);
    // Lease acquisition is a single SQLite write, shared by HTTP and MCP.
    // Twenty minutes exceeds supported adapter poll budgets; a dead owner can
    // be recovered after that bound. Every write below checks its owner token.
    const token = handle().generateId(), now = Date.now();
    const claim = handle().db.prepare(`UPDATE film_generation_jobs SET collection_token=?,collection_claimed_at=?
        WHERE id=? AND (collection_token IS NULL OR collection_claimed_at<?)`)
        .run(token, now, job.id, now - 20 * 60 * 1000);
    if (!claim.changes) return {ok:false,pending:true,status:202,job_id:job.id,error:'This job is already being collected; try again after its delivery finishes.'};
    const legacyTarget=opts.belongs_to || legacyMetaPatch(opts,meta);
    if (Object.keys(legacyTarget).length && !meta.recovery_binding && !job.delivered_json && !meta.expression_delivery) {
        const captured={...legacyMetaPatch(opts,meta),...meta,recovery_binding:legacyTarget};
        handle().db.prepare('UPDATE film_generation_jobs SET meta=? WHERE id=? AND collection_token=?').run(JSON.stringify(captured),job.id,token);
    }
    const heartbeat=setInterval(()=>{
        try { handle().db.prepare('UPDATE film_generation_jobs SET collection_claimed_at=? WHERE id=? AND collection_token=?').run(Date.now(),job.id,token); } catch (_) {}
    },30000);
    heartbeat.unref();
    const work=(async()=>{
        try {
            const delivered=await collectOwned(get(job.id),opts,token);
            if(delivered.ok&&delivered.adopted)handle().db.prepare('UPDATE film_generation_jobs SET delivered_json=?,asset_id=? WHERE id=? AND collection_token=?').run(JSON.stringify(delivered),delivered.plate?.asset_id || delivered.frame?.asset_id || null,job.id,token);
            return delivered;
        }
        finally {
            clearInterval(heartbeat);
            handle().db.prepare('UPDATE film_generation_jobs SET collection_token=NULL,collection_claimed_at=NULL WHERE id=? AND collection_token=?').run(job.id,token);
        }
    })();
    collections.set(job.id,work);
    try { return await work; } finally { if(collections.get(job.id)===work)collections.delete(job.id); }
}

async function collectOwned(job, opts, token) {
    const owns = () => handle().db.prepare('SELECT 1 FROM film_generation_jobs WHERE id=? AND collection_token=?').get(job.id, token);
    if (job.delivered_json) {
        const response={...JSON.parse(job.delivered_json),already:'completed'};
        try { postUsage(job,safeMeta(job)); delete response.metering_pending; } catch (_) { response.metering_pending=true; }
        return response;
    }
    /*
     * A COMPLETED job is done: the bytes are filed and re-polling could only
     * file them twice.
     *
     * A FAILED one is not the same thing, and treating it as final is what
     * turned a rendered clip into a lost one. `failed` here means THIS ENGINE
     * gave up on the job — including when it gave up because of its own bug:
     * the poll read `data.output` while MuAPI answers `outputs`, so a finished,
     * billed clip was settled as a failure and then refused collection forever.
     * The provider is the source of truth about its own job, and asking it is
     * FREE. So a failed handle is re-polled: if the provider really did fail,
     * the same failure comes back and nothing changes; if it holds a result,
     * the money stops being wasted.
     */
    // A face request may finish before the response files its slot asset. Resume
    // that existing handle if the response was interrupted, without buying again.
    const completedExpressionUnfiled = job.status === 'completed' && job.capability === 'image'
        && safeMeta(job).expression_delivery && !handle().db.prepare("SELECT id FROM film_assets WHERE json_valid(metadata) AND json_extract(metadata,'$.reference_role')='expression' AND json_extract(metadata,'$.collected_from_job')=?").get(job.id);
    if (job.status === 'completed' && !safeMeta(job).production_delivery && !safeMeta(job).sequence_id && !completedExpressionUnfiled && !job.result_json) {
        if(safeMeta(job).expression_delivery)return {ok:true,already:job.status,job,note:'This expression was already filed in its captured face slot.'};
        /*
         * ADOPTION, not a re-buy.
         *
         * "The bytes are filed" was an assumption, and it was wrong for every
         * plate. A plate collected before `plate-delivery` existed was written
         * to `collected_<job>.png` and registered NOWHERE — nine of those
         * accumulated in one afternoon on this production, two of them better
         * than the plates actually in use, and refusing to look at them again
         * is what turned a filing gap into work bought twice.
         *
         * So when the caller NAMES what the job was for, the picture already on
         * disk becomes that plate. The provider is not asked for bytes this
         * engine already has: nothing is re-polled and nothing is spent.
         */
        const claimed = plateBindingOf(opts, safeMeta(job));
        if (claimed) return adoptPlate(job, claimed);
        const frameClaim = frameBindingOf(opts, safeMeta(job));
        if (frameClaim && job.capability === 'image') {
            const { getFilePath } = require('./file-storage');
            let onDisk = null;
            try { onDisk = getFilePath(job.project_id, 'storyboards', `collected_${job.id}.png`); } catch (_) { onDisk = null; }
            const filed = fileFrame(job, frameClaim, onDisk, safeMeta(job));
            if (filed.ok) {
                return { ok: true, job_id: job.id, adopted: true, frame: filed,
                    note: 'This job had already been collected but never filed. The frame it left on disk '
                        + 'is now the shot\'s current storyboard frame — nothing was regenerated or re-bought.' };
            }
            return { ok: false, status: 409, job_id: job.id,
                error: `job ${job.id} is completed and its collected frame could not be filed — ${filed.error}` };
        }
        return { ok: true, already: job.status, job, note: 'this job was already completed' };
    }
    const retryingFailed = job.status === 'failed';

    const providers = require('./providers');
    const adapter = providers.get(job.provider);
    if (!job.result_json && (!adapter || typeof adapter.collect !== 'function')) {
        return { ok: false, status: 501,
            error: `${job.provider} cannot collect a job by handle` };
    }

    let meta = {};
    try { meta = JSON.parse(job.meta || '{}'); } catch (_) { meta = {}; }
    // A caller may supply what an older handle could not record. The stored
    // meta still wins: what the engine wrote at the time is evidence, and a
    // caller's guess must never overwrite it.
    if (opts && opts.metaPatch) meta = Object.assign({}, legacyMetaPatch(opts,meta), meta);

    let out;
    try {
        out = job.result_json ? restoredResult(job.result_json)
            : await adapter.collect(job.request_id, Object.assign({ meta }, meta, opts || {}));
    } catch (err) {
        return { ok: false, status: 502, error: `${job.provider}: ${err.message}` };
    }
    if (!owns()) return {ok:false,pending:true,status:202,job_id:job.id,error:'Collection ownership expired; resume the existing job.'};

    // Still running. Left pending deliberately -- a handle is only useful if
    // asking again is safe.
    if (!out || (!out.ok && (out.pending || out.status === 504))) {
        return { ok: false, pending: true, status: 202, job_id: job.id,
            error: `${job.provider} has not finished job ${job.id} yet — it is still running, try again.` };
    }
    if (!out.ok) {
        fail(job.id, out.error);
        return { ok: false, status: out.status || 502, job_id: job.id, error: out.error };
    }
    if (job.capability==='video'&&typeof meta.audio==='boolean') {
        out.audio=meta.audio;
        if(out.data&&typeof out.data==='object')out.data.audio=meta.audio;
    }
    // Cache bytes/URL before touching storage. A failed saver retries the same
    // result without another poll or generation POST.
    handle().db.prepare('UPDATE film_generation_jobs SET result_json=? WHERE id=? AND collection_token=?').run(JSON.stringify(out),job.id,token);

    /*
     * File it. A collected result that is not persisted is the original defect
     * with an extra step: the provider finished, the money is gone, and there is
     * still nothing in film_assets.
     */
    let stored = null;
    let assetId = null;
    let plateFiled = null;
    let frameFiled = null;
    try {
        let prior = handle().db.prepare("SELECT * FROM film_assets WHERE json_valid(metadata) AND (json_extract(metadata,'$.collected_from_job')=? OR json_extract(metadata,'$.generation_job_id')=?)").get(job.id,job.id);
        if (!prior && meta.production_delivery && meta.approval_id) {
            prior = handle().db.prepare("SELECT * FROM film_assets WHERE project_id=? AND json_valid(metadata) AND json_extract(metadata,'$.final_request_review_id')=?").get(job.project_id, meta.approval_id);
        }
        /*
         * BYTES OR A URL. Seedance returns a CDN link and no buffer, and this
         * read `out.data` alone -- so the one adapter most likely to be
         * collected was the one whose result was silently never filed.
         */
        /*
         * A PLATE IS FILED AS A PLATE.
         *
         * Nano Banana Pro takes about two minutes; the host window is one. So
         * every character plate on that model timed out, was collected here,
         * and was written to `collected_<job>.png` in the storyboards directory
         * — a finished, billed reference picture with no film_assets row, no
         * entry in the character library, and `has_plate` still false. The
         * director sees "failed", regenerates, and buys it twice.
         *
         * The handle now carries what the generation was FOR, so this road can
         * do what the live road does. Same filing rule, one implementation, in
         * lib/plate-delivery.js — exactly the arrangement the sequence-leg
         * branch below already uses for the same reason.
         */
        if(!prior && meta.storyboard_frame && job.capability==='image')prior=matchingFiledFrame(job,meta,out);
        const plateDelivery = require('./plate-delivery');
        const plate = plateBindingOf(opts, meta);
        if (prior) {
            assetId=prior.id;stored={path:prior.file_path};
            if (meta.production_delivery?.kind === 'shot_image') {
                const evidence = JSON.parse(prior.metadata || '{}');
                frameFiled = { shot_id:prior.shot_id, historical:!!evidence.historical };
            }
        } else if (meta.production_delivery && (out.data || out.url)) {
            const delivery = meta.production_delivery;
            if (delivery.project_id !== job.project_id) throw new Error('Original Production project is unavailable');
            const expectedCapability = delivery.kind === 'shot_image' ? 'image' : 'video';
            if (!['shot_image','shot_video','sequence_video'].includes(delivery.kind) || job.capability !== expectedCapability) throw new Error('Original Production capability changed');
            const { persistCapabilityResult } = require('./capability-payloads');
            const { PERSIST_EXT } = require('./media-kinds');
            const fullSource = job.capability === 'video' ? {...out,audio:true} : out;
            stored = await persistCapabilityResult(job.capability, fullSource,
                { project:{id:job.project_id}, project_id:job.project_id }, `collected_${job.id}.${PERSIST_EXT[job.capability]}`);
            const filePath = typeof stored === 'string' ? stored : stored.path;
            const filing = require('./production-draft-request');
            const input = { delivery, result:out, provider:job.provider,
                model:out.provider_model || meta.meter?.model, jobId:job.id, reviewId:meta.approval_id };
            const filed = delivery.kind === 'shot_image'
                ? filing.fileProductionDraftFrame(handle().db, { ...input, sourcePath:filePath })
                : (delivery.kind === 'sequence_video' ? filing.fileProductionDraftSequence : filing.fileProductionDraftVideo)(handle().db, { ...input, filePath });
            assetId = filed.asset_id; stored = { path:filed.file_path };
            if (delivery.kind === 'shot_image') frameFiled = filed;
        } else if (meta.pipeline_delivery && (out.data || out.url)) {
            const delivery = meta.pipeline_delivery;
            const { db } = handle();
            const run = db.prepare('SELECT * FROM film_pipeline_runs WHERE id=?').get(delivery.run_id);
            let state; try { state=JSON.parse(run?.params || '{}').final_pipeline; } catch (_) {}
            if (!run || run.project_id !== job.project_id || !state?.tasks.some(t=>t.key===delivery.task_key && t.shot_id===job.shot_id && t.step_id===delivery.step_id)) throw new Error('Original pipeline delivery target is unavailable');
            const shot=db.prepare('SELECT * FROM film_shots WHERE id=?').get(job.shot_id),scene=db.prepare('SELECT * FROM film_scenes WHERE id=?').get(shot?.scene_id),project=db.prepare('SELECT * FROM film_projects WHERE id=?').get(job.project_id);
            if (!shot || !scene || scene.project_id !== job.project_id) throw new Error('Original pipeline shot is unavailable');
            const filed=await require('../routes/pipeline').persistStepResult(delivery.step_id,job.capability,out,{shot,scene,project,jobId:job.id});
            if (!filed.ok) throw new Error(filed.error);
            assetId=filed.assetId;stored={path:filed.path};
        } else if (meta.expression_delivery && job.capability === 'image' && (out.data || out.url)) {
            const filed = await require('./character-expressions').deliverGenerated(meta.expression_delivery,out.data || out,{collected_from_job:job.id,provider:job.provider});
            assetId = filed.asset_id;
            stored = {path:require('../db/database').db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(assetId).file_path};
        } else if (plate && (out.data || out.url)) {
            const filed = await plateDelivery.fileSubjectPlate({
                kind: plate.kind,
                projectId: job.project_id,
                subjectId: plate.subjectId,
                view: plate.view,
                data: out.data || out,
                provider: out.provider || job.provider,
                providerModel: out.provider_model || (meta.meter && meta.meter.model) || '',
                providerJobId: job.request_id,
                styleApplied: plate.styleApplied,
                collectedFromJob: job.id,
            });
            if (!filed.ok) {
                return { ok: false, status: 500, job_id: job.id,
                    error: `${job.provider} returned the plate and it could not be filed — ${filed.error}` };
            }
            assetId = filed.asset_id;
            plateFiled = filed;
            stored = { path: filed.file_path };
        } else if (out.data || out.url) {
            const { persistCapabilityResult } = require('./capability-payloads');
            // PERSIST_EXT is what the registry actually calls it.
            const { PERSIST_EXT } = require('./media-kinds');
            const ext = (PERSIST_EXT && PERSIST_EXT[job.capability]) || 'bin';
            /*
             * A leg of a sequence is stored under the name that sequence looks
             * it up by -- never `collected_<job>.mp4`, which is a file on disk
             * that the sequence it was bought for cannot see.
             */
            const leg = meta && meta.sequence_id && meta.from && meta.to ? meta : null;
            const name = leg
                ? require('./sequence-delivery').clipFileName(leg.sequence_id, leg.from, leg.to, job.id)
                : `collected_${job.id}.${ext}`;
            const fullSource = leg ? { ...out, audio:undefined,
                ...(out.data && !Buffer.isBuffer(out.data) && typeof out.data === 'object' ? { data:{...out.data,audio:undefined} } : {}) } : out;
            stored = await persistCapabilityResult(job.capability, fullSource,
                { project: { id: job.project_id }, project_id: job.project_id }, name);
            const frame = !leg && job.capability === 'image' ? frameBindingOf(opts, meta) : null;
            if (frame) {
                const filed = fileFrame(job, frame,
                    typeof stored === 'string' ? stored : (stored && stored.path) || '', meta);
                if (!filed.ok) {
                    return { ok: false, status: 500, job_id: job.id,
                        error: `${job.provider} returned the frame and it could not be filed — ${filed.error}` };
                }
                assetId = filed.asset_id;
                stored = { path: filed.file_path };
                plateFiled = null;
                frameFiled = filed;
            }
            if (leg) {
                assetId = require('./sequence-delivery').fileSequenceClip({
                    projectId: job.project_id,
                    sequenceId: leg.sequence_id, from: leg.from, to: leg.to,
                    shotId: leg.from_shot_id || job.shot_id || null,
                    fileName: name,
                    filePath: typeof stored === 'string' ? stored : (stored && stored.path) || '',
                    jobId:job.id, reviewId:meta.approval_id,
                    baseline:meta.sequence_baseline, sourceShotIds:meta.source_shot_ids,
                    extra: { collected_from_job: job.id },
                });
            }
        }
    } catch (err) {
        // The bytes arrived and could not be filed. Reported rather than
        // swallowed: the job stays pending so it can be collected again.
        return { ok: false, status: 500, job_id: job.id,
            error: `${job.provider} returned the result and it could not be stored — ${err.message}` };
    }

    /*
     * POST THE SPEND. This is the other half of the stamp `resolve()` writes at
     * handle time.
     *
     * The live meter fires on a successful result, and a job that reached here
     * did NOT return one to the caller — it timed out, or it was recorded as
     * failed. So nothing has been billed on this side yet, and there is no
     * double-count to guard against: a job that genuinely succeeded live was
     * settled `completed` and never gets this far.
     *
     * Money the provider took and the ledger never saw is worse than no ledger:
     * a spend report that reads $0 for video is believed.
     */
    let meteringPending=false;
    try {
        postUsage(job,meta);
    } catch (err) {
        // Bookkeeping never fails the delivery it is keeping books on.
        console.error('[generation-jobs] collected but could not record spend:', err.message);
        meteringPending=true;
    }

    const response = { ok: true, job_id: job.id, provider: job.provider, capability: job.capability,
             ...(meteringPending?{metering_pending:true}:{}),
             ...(retryingFailed ? { recovered: true,
                 note: 'This job had been settled as failed by this engine. The provider still '
                     + 'held the result, so it was re-polled and delivered rather than re-bought.' } : {}),
             ...(assetId ? { asset_id: assetId,
                 ...(meta.sequence_id || meta.production_delivery?.sequence_id ? { sequence_id: meta.sequence_id || meta.production_delivery.sequence_id } : {}) } : {}),
             ...(plateFiled ? { plate: {
                 kind: plateFiled.kind, subject_id: plateFiled.subject_id, view: plateFiled.view,
                 file_name: plateFiled.file_name, image_url: plateFiled.image_url,
                 filed: 'This plate finished after the call was abandoned and is now the reference '
                      + `for that view — it is in the ${plateFiled.kind || 'subject'}'s library, not a loose file.` } } : {}),
             ...(frameFiled ? { frame: {
                 shot_id: frameFiled.shot_id, shot_code: frameFiled.shot_code, image_url: frameFiled.image_url,
                 ...(frameFiled.historical?{historical:true}:{}),
                 filed: frameFiled.historical ? 'The accepted frame was retained as a storyboard version; the newer selected frame is preserved.' : 'This frame finished after the call was abandoned and is now the shot\'s current '
                      + 'storyboard frame, as a new version — not a loose file.' } } : {}),
             stored: stored ? stored.path : null, url: out.url || null };
    handle().db.prepare(`UPDATE film_generation_jobs SET status='completed',asset_id=?,error=NULL,
        settled_at=datetime('now'),delivered_json=? WHERE id=? AND collection_token=?`)
        .run(assetId,JSON.stringify(response),job.id,token);
    return response;
}

module.exports = {    collect,
    budgetFor, record, accepted, meterPlan, retainMeter, complete, fail, pending, recoverable, retainedReceipts, get, timedOut,};
