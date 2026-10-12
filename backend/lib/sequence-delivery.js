/**
 * Where a sequence leg's finished clip goes.
 *
 * ONE definition of the filename and ONE of the film_assets row, because the
 * clip can now arrive by two roads and they must agree. The live road is
 * `routes/sequences.js`, which polls and files what comes back. The other is
 * `generation-jobs.collect()`, which delivers a job the agent host abandoned
 * — or, as happened here, one the engine wrongly marked failed while the
 * provider held a rendered, PAID-FOR clip.
 *
 * If those two roads name the file differently or stamp different metadata,
 * a collected leg is invisible to the sequence that bought it: `sequence_plan`
 * reports the leg as still missing, `sequence_stitch` skips it, and the only
 * symptom is a bill for footage nobody can find. So neither road states these
 * facts itself; both read them from here.
 */

const SAFE = value => String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'shot';

/** The name a leg's clip is stored under. */
function clipFileName(sequenceId, from, to, deliveryId) {
    const suffix = deliveryId ? `_${require('crypto').createHash('sha256').update(String(deliveryId)).digest('hex').slice(0,24)}` : '';
    return `sequence_${SAFE(String(sequenceId || '').slice(0, 8))}_${SAFE(from)}_${SAFE(to)}${suffix}.mp4`;
}

/**
 * The metadata that makes a stored clip FINDABLE as a leg.
 *
 * `sequence_plan` looks a leg up by exactly these three keys, so a row without
 * them is a file on disk and nothing more.
 */
function clipMetadata(o) {
    return { sequence_id: o.sequenceId, from: o.from, to: o.to };
}

/**
 * File a leg's clip. Returns the asset id.
 *
 * Adopt an exact job/review delivery once. New generations always insert a
 * version; no old path, bytes, prompt or approval identity is rewritten.
 */
function fileSequenceClip(o) {
    const { db, generateId } = require('../db/database');
    const jobId = o.jobId || o.extra?.generation_job_id || o.extra?.collected_from_job;
    const reviewId = o.reviewId || o.extra?.final_request_review_id;
    const deliveryId = o.deliveryId || jobId || reviewId;
    return db.transaction(() => {
        let existing;
        if (jobId || reviewId) existing = db.prepare(`SELECT id FROM film_assets
            WHERE project_id=? AND asset_type='video_raw' AND json_valid(metadata)
              AND json_extract(metadata,'$.sequence_id')=? AND json_extract(metadata,'$.from')=? AND json_extract(metadata,'$.to')=?
              AND ((? IS NOT NULL AND (json_extract(metadata,'$.generation_job_id')=? OR json_extract(metadata,'$.collected_from_job')=?))
                OR (? IS NOT NULL AND json_extract(metadata,'$.final_request_review_id')=?))`)
            .get(o.projectId,o.sequenceId,o.from,o.to,jobId||null,jobId||null,jobId||null,reviewId||null,reviewId||null);
        else if (o.fileName) existing = db.prepare(`SELECT id FROM film_assets
            WHERE project_id=? AND file_name=? AND asset_type='video_raw' AND json_valid(metadata)
              AND json_extract(metadata,'$.sequence_id')=? AND json_extract(metadata,'$.from')=? AND json_extract(metadata,'$.to')=?`)
            .get(o.projectId,o.fileName,o.sequenceId,o.from,o.to);
        if (existing) return existing.id;
        const fileName = o.fileName || clipFileName(o.sequenceId,o.from,o.to,deliveryId || generateId());
        const metadata = Object.assign(clipMetadata(o),o.extra || {},
            jobId ? { generation_job_id:jobId } : {},reviewId ? { final_request_review_id:reviewId } : {});
        if (o.baseline) {
            const drafts = require('./production-draft-request');
            const owner = require('./production-recipes').nodeOwner(db,o.projectId,`seq:${o.sequenceId}`);
            metadata.historical = !drafts.selectionUnchanged(db,owner,o.baseline);
        }
        if (jobId) {
            const job=db.prepare('SELECT meta,error FROM film_generation_jobs WHERE id=?').get(jobId);
            let jobMeta;try{jobMeta=JSON.parse(job?.meta||'{}');}catch(_){jobMeta={};}
            if(jobMeta.stopped_waiting || job?.error==='cancelled by the director')metadata.historical=true;
        }
        if (o.sourceShotIds) metadata.original_shot_ids = o.sourceShotIds;
        const selected = metadata.historical && o.shotId ? require('./conform').selectedClip(db,o.shotId) : null;
        const version = (db.prepare(`SELECT MAX(version) AS version FROM film_assets
            WHERE project_id=? AND asset_type='video_raw' AND json_valid(metadata)
              AND json_extract(metadata,'$.sequence_id')=? AND json_extract(metadata,'$.from')=? AND json_extract(metadata,'$.to')=?`)
            .get(o.projectId,o.sequenceId,o.from,o.to).version || 0) + 1;
        const id = generateId();
        db.prepare(`INSERT INTO film_assets
            (id, project_id, shot_id, asset_type, file_path, file_name, format, version, metadata)
            VALUES (?, ?, ?, 'video_raw', ?, ?, 'mp4', ?, ?)`)
            .run(id,o.projectId,o.shotId || null,o.filePath || '',fileName,version,JSON.stringify(metadata));
        if (selected) db.prepare('UPDATE film_shots SET selected_video_asset_id=COALESCE(selected_video_asset_id,?) WHERE id=?').run(selected.id,o.shotId);
        return id;
    }).immediate();
}

module.exports = { clipFileName, clipMetadata, fileSequenceClip };
