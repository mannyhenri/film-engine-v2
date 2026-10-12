'use strict';

// SQLite cannot roll back a file rename. Keep a durable undo journal while its
// immediate transaction owns the shot, then reconcile an interrupted operation
// from the committed shot/asset rows before allowing the next mutation.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const CONTRACT_VERSION = 'storyboard-activation-v1';
const IMPLEMENTATION_SHA256 = hash(fs.readFileSync(__filename));
const samePath = (a, b) => !!a && path.resolve(a) === path.resolve(b);
function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
function context(db, shotId) {
    const shot = db.prepare(`SELECT sh.*, sc.project_id FROM film_shots sh
        JOIN film_scenes sc ON sc.id=sh.scene_id WHERE sh.id=?`).get(shotId);
    if (!shot) fail('Shot not found', 404);
    const live = require('./file-storage').getFilePath(shot.project_id, 'storyboards', `${shot.shot_code}.png`);
    return { shot, live, journal: path.join(path.dirname(live), `.activation-${shotId}.json`) };
}
function assetRows(db, shotId) {
    return db.prepare(`SELECT * FROM film_assets WHERE shot_id=?
        AND asset_type IN ('storyboard','keyframe')
        AND (NOT json_valid(metadata) OR json_extract(metadata,'$.station_index') IS NULL)
        ORDER BY version DESC, created_at DESC, id DESC`).all(shotId);
}
function databaseHash(db, shotId) {
    return hash(JSON.stringify({ shot: context(db, shotId).shot, assets: assetRows(db, shotId) }));
}
function liveFrameEvidence(db, shotId) {
    const { live } = context(db, shotId);
    return { path: live, sha256: fileHash(live) };
}
function activationEvidence(db, shotId) {
    const { live, journal } = context(db, shotId);
    const selected = require('./selected-frame').selectedFrame(db, shotId);
    const liveSha = fileHash(live), selectedSha = selected?.file_path ? fileHash(selected.file_path) : null;
    return { version: CONTRACT_VERSION, implementation_sha256: IMPLEMENTATION_SHA256,
        live_sha256: liveSha, selected_asset_id: selected?.id || null,
        selected_sha256: selectedSha, live_matches_selected: !!liveSha && liveSha === selectedSha,
        recovery_pending: fs.existsSync(journal) };
}
function atomicWrite(file, bytes) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const staged = `${file}.activation-${crypto.randomUUID()}.tmp`;
    let fd;
    try {
        fd = fs.openSync(staged, 'wx');
        fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
        fs.renameSync(staged, file);
        // Directory fsync is unavailable on some platforms; file data is flushed.
        try { const dir = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } } catch (_) {}
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(staged)) fs.unlinkSync(staged);
    }
}
function rollbackFiles(journal) {
    // Never roll an external edit back over itself. Check every path first.
    for (const entry of journal.files) {
        const current = fileHash(entry.path);
        if (current !== entry.after && current !== entry.beforeHash)
            fail('Storyboard files changed during activation. The recovery journal was retained; do not overwrite the newer files.');
    }
    for (const entry of [...journal.files].reverse()) {
        if (fileHash(entry.path) === entry.beforeHash) continue;
        if (entry.before === null) fs.unlinkSync(entry.path);
        else atomicWrite(entry.path, Buffer.from(entry.before, 'base64'));
    }
}
function recover(db, shotId, journalPath) {
    if (!fs.existsSync(journalPath)) return;
    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    if (journal.shotId !== shotId || journal.version !== 1) fail('Invalid storyboard activation recovery journal.');
    const state = databaseHash(db, shotId);
    if (journal.afterDatabase && state === journal.afterDatabase) {
        if (journal.files.some(entry => fileHash(entry.path) !== entry.after))
            fail('Committed storyboard files changed. The recovery journal was retained.');
        if ((journal.reads || []).some(entry => fileHash(entry.path) !== entry.sha256))
            fail('Committed storyboard source changed. The recovery journal was retained.');
    } else if (state === journal.beforeDatabase) rollbackFiles(journal);
    else fail('The shot changed after an interrupted activation. The recovery journal was retained.');
    fs.unlinkSync(journalPath);
}
function withStoryboardMutation(db, shotId, work) {
    // An outer transaction could fail after our files were committed. All
    // callers must give this coordinator ownership of the transaction boundary.
    if (db.inTransaction) fail('Storyboard activation requires its own transaction boundary.');
    let journal, journalPath;
    const run = db.transaction(() => {
        const ctx = context(db, shotId); journalPath = ctx.journal;
        recover(db, shotId, journalPath);
        journal = { version: 1, shotId, beforeDatabase: databaseHash(db, shotId), afterDatabase: null, files: [], reads: [] };
        const persist = () => atomicWrite(journalPath, Buffer.from(JSON.stringify(journal)));
        const files = {
            expect(file, sha256) {
                if (fileHash(file) !== sha256) fail('Chosen storyboard source changed before activation.');
                const prior = journal.reads.find(entry => samePath(entry.path, file));
                if (prior && prior.sha256 !== sha256) fail('Chosen storyboard source changed during activation.');
                if (!prior) journal.reads.push({path:file,sha256});
            },
            write(file, bytes, immutable = false, expectedBeforeSha256) {
                const before = fs.existsSync(file) ? fs.readFileSync(file) : null;
                if (expectedBeforeSha256 !== undefined && (before ? hash(before) : null) !== expectedBeforeSha256)
                    fail('Live storyboard changed before its replacement. Keep the newer frame and refresh the selection.');
                if (immutable && before) {
                    if (!before.equals(bytes)) fail('Refusing to overwrite an immutable storyboard version.');
                    return;
                }
                if (before?.equals(bytes)) return;
                if (journal.files.some(entry => samePath(entry.path, file))) fail('Storyboard path written twice in one activation.');
                journal.files.push({ path: file, before: before ? before.toString('base64') : null,
                    beforeHash: before ? hash(before) : null, after: hash(bytes) });
                persist(); // Undo is durable before the live path can change.
                if (fileHash(file) !== (before ? hash(before) : null)) fail('Storyboard file changed before activation.');
                atomicWrite(file, bytes);
            },
        };
        const result = work(files);
        if (journal.files.length) { journal.afterDatabase = databaseHash(db, shotId); persist(); }
        if (journal.files.some(entry => fileHash(entry.path) !== entry.after))
            fail('Storyboard files changed before activation commit. The recovery journal was retained.');
        if (journal.reads.some(entry => fileHash(entry.path) !== entry.sha256))
            fail('Chosen storyboard source changed before activation commit. Its external edit was retained.');
        return result;
    });
    let result;
    try { result = run.immediate(); }
    catch (error) {
        if (journal?.files.length) {
            try { rollbackFiles(journal); if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath); }
            catch (rollbackError) { error.message += ` Recovery required: ${rollbackError.message}`; }
        }
        throw error;
    }
    // Failure to remove a committed journal is recoverable on the next call;
    // it must never turn a successful commit into a reported failed import.
    if (journal?.files.length) { try { fs.unlinkSync(journalPath); } catch (_) {} }
    return result;
}
function archiveLive(db, shotId, files) {
    const { shot, live } = context(db, shotId);
    if (!fs.existsSync(live)) return null;
    const bytes = fs.readFileSync(live);
    // The live-file owner can differ from the selection pointer after an old
    // handoff import. Older aliases predate archiving and cannot prove identity.
    const owner = assetRows(db, shotId).find(row => samePath(row.file_path, live));
    let destination = path.join(path.dirname(live), 'versions', owner
        ? `${shot.shot_code}_v${owner.version}.png`
        : `${shot.shot_code}_live_${hash(bytes)}.png`);
    if (fs.existsSync(destination) && fileHash(destination) !== hash(bytes)) {
        destination = path.join(path.dirname(destination), `${shot.shot_code}_${owner?.id || 'live'}_${hash(bytes)}.png`);
    }
    files.write(destination, bytes, true);
    if (fileHash(live) !== hash(bytes)) fail('Live storyboard changed while its prior version was being archived.');
    if (owner) db.prepare('UPDATE film_assets SET file_path=?,file_name=? WHERE id=?')
        .run(destination, path.basename(destination), owner.id);
    return destination;
}
function preserveLive(db, shotId) {
    // Generation collectors already own outer transactions. An archive-only
    // copy can survive their rollback safely; it never replaces an old image.
    if (db.inTransaction) return archiveLive(db, shotId, {
        write(file, bytes) {
            if (fs.existsSync(file)) {
                if (fileHash(file) !== hash(bytes)) fail('Refusing to overwrite an immutable storyboard archive.');
            } else atomicWrite(file, bytes);
        },
    });
    return withStoryboardMutation(db, shotId, files => archiveLive(db, shotId, files));
}
function activateAsset(db, shotId, assetId, files, options = {}) {
    const { shot, live } = context(db, shotId), rows = assetRows(db, shotId);
    const asset = rows.find(row => row.id === assetId);
    if (!asset || asset.project_id !== shot.project_id) fail('Chosen storyboard asset is not owned by this shot.');
    const selected = require('./selected-frame').selectedFrame(db, shotId);
    const owner = rows.find(row => samePath(row.file_path, live));
    const namesLive = samePath(asset.file_path, live);
    if (!asset.file_path || !fs.existsSync(asset.file_path)) fail(`The file for version ${asset.version} is no longer on disk.`);
    if (namesLive && owner?.id !== asset.id) fail(`Version ${asset.version}'s own picture was never kept — its row names the live file.`);
    const bytes = fs.readFileSync(asset.file_path), beforeLive = fileHash(live);
    if (!bytes.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))
        fail('Storyboard activation requires a PNG image. Keep the original and re-export it as PNG.',400);
    files.expect(asset.file_path,hash(bytes));
    if (options.expectedLiveSha256 !== undefined && beforeLive !== options.expectedLiveSha256)
        fail('Live storyboard changed. Refresh the frame selection before restoring.');
    if (options.expectedSelectedAssetId !== undefined && (selected?.id || null) !== options.expectedSelectedAssetId)
        fail('Selected storyboard changed. Refresh the frame selection before restoring.');
    const changed = selected?.id !== asset.id || beforeLive !== hash(bytes)
        || shot.current_frame_version !== asset.version || (options.complete && shot.status !== 'complete');
    if (!changed) return { changed: false, asset_id: asset.id, version: asset.version };
    if (options.requireUnlocked && db.prepare('SELECT board_locked_at,provider_config FROM film_projects WHERE id=?').get(shot.project_id)?.board_locked_at)
        fail('This board is locked. Unlock it before reconciling the captured frame.',423);
    archiveLive(db, shotId, files);
    if (fileHash(live) !== beforeLive || fileHash(asset.file_path) !== hash(bytes))
        fail('Storyboard source or live bytes changed during activation.');
    files.write(live, bytes, false, beforeLive);
    db.prepare(options.complete
        ? "UPDATE film_shots SET current_frame_version=?,status='complete' WHERE id=?"
        : 'UPDATE film_shots SET current_frame_version=? WHERE id=?').run(asset.version, shotId);
    return { changed: true, asset_id: asset.id, version: asset.version };
}
module.exports = { liveFrameEvidence, activationEvidence, withStoryboardMutation, archiveLive, preserveLive, activateAsset };
