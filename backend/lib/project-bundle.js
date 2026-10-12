/**
 * Project Bundle — Export & Import
 *
 * Exports a complete project (DB rows + asset files) as a .tar.gz archive.
 * Imports a .tar.gz archive to recreate a project on another instance.
 *
 * Bundle structure:
 *   manifest.json              — All DB rows with ID mappings
 *   storyboards/<file>         — Storyboard images
 *   audio/<file>               — Voice audio files
 *   video/<file>               — Video files
 *   music/<file>               — Music/SFX/ambient files
 *   refsheets/<file>           — Character reference sheets
 *   provenance/<file>          — AI provenance/disclosure sidecars
 *
 * THE SCORE TRAVELS WHOLE (MUS-021). Every score-session table — sessions,
 * tracks, clips, emotion ranges, markers, automation, operations with their
 * job children, DAW links — and the picture sequences sessions sit on are
 * exported, and `manifest.files` names every carried file with its sha256.
 * On import: every file is verified before anything is written (a damaged one
 * refuses the whole import, naming it); every exported id is replaced by a
 * new one in columns and JSON references, so no row can point back at the
 * other machine; stored paths are rebuilt in this project's new folder while
 * carried filenames and bytes stay intact; mtimes are kept, so file identity survives
 * the copy; foreign keys are checked over the rows just inserted, inside the
 * transaction, so a broken reference rolls everything back; and a bounce that
 * was the session's current mix when exported is re-stamped against the new
 * ids, so an approved score is not reported stale for having moved.
 */

const { db, generateId } = require('../db/database');
const { DATA_DIR } = require('./file-storage');
const fs = require('fs');
const path = require('path');
const { CACHE_DIRNAME: THUMB_CACHE_DIR } = require('./thumbnails');
const { spawnSync } = require('child_process');
const crypto = require('crypto');


/*
 * Every kind of per-project file goes in a bundle — the project-folder layout's
 * own registry, not a list typed here. The bundle keeps them by kind
 * (`video/…`), which is portable whichever layout either machine uses.
 */
const folders = require('./project-folders');
const fileStorage = require('./file-storage');
const ASSET_SUBDIRS = Object.keys(folders.PROJECT_LAYOUT);

// Tables to export, in dependency order (parents before children)
const EXPORT_TABLES = [
    { table: 'film_projects', key: 'id', filter: 'id = ?' },
    { table: 'film_scripts', key: 'id', filter: 'project_id = ?' },
    { table: 'film_scenes', key: 'id', filter: 'project_id = ?' },
    { table: 'film_shots', key: 'id', filter: 'scene_id IN (SELECT id FROM film_scenes WHERE project_id = ?)' },
    { table: 'film_characters', key: 'id', filter: 'project_id = ?' },
    { table: 'film_locations', key: 'id', filter: 'project_id = ?' },
    { table: 'film_props', key: 'id', filter: 'project_id = ?' },
    { table: 'film_costumes', key: 'id', filter: 'character_id IN (SELECT id FROM film_characters WHERE project_id = ?)' },
    { table: 'film_voice_profiles', key: 'id', filter: 'character_id IN (SELECT id FROM film_characters WHERE project_id = ?)' },
    { table: 'film_shot_notes', key: 'id', filter: 'shot_id IN (SELECT id FROM film_shots WHERE scene_id IN (SELECT id FROM film_scenes WHERE project_id = ?))' },
    { table: 'film_shot_versions', key: 'id', filter: 'shot_id IN (SELECT id FROM film_shots WHERE scene_id IN (SELECT id FROM film_scenes WHERE project_id = ?))' },
    { table: 'film_milestones', key: 'id', filter: 'project_id = ?' },
    { table: 'film_assets', key: 'id', filter: 'project_id = ?' },
    // Processing parents and immutable versions travel with their registered assets.
    { table: 'production_depth_nodes', key: 'id', filter: 'project_id = ?' },
    { table: 'production_depth_jobs', key: 'id', filter: 'project_id = ?' },
    { table: 'production_depth_versions', key: 'id', filter: 'project_id = ?' },
    { table: 'production_composite_nodes', key: 'id', filter: 'project_id = ?' },
    { table: 'production_composite_jobs', key: 'id', filter: 'project_id = ?' },
    { table: 'production_composite_versions', key: 'id', filter: 'project_id = ?' },
    { table: 'production_composite_handoffs', key: 'id', filter: 'project_id = ?' },
    { table: 'film_music_cues', key: 'id', filter: 'project_id = ?' },
    { table: 'film_color_presets', key: 'id', filter: 'project_id = ?' },
    { table: 'film_rights', key: 'id', filter: 'project_id = ?' },
    { table: 'film_provenance_manifests', key: 'id', filter: 'project_id = ?' },
    { table: 'film_color_pipelines', key: 'id', filter: 'project_id = ?' },
    { table: 'film_dubbing_jobs', key: 'id', filter: 'project_id = ?' },
    { table: 'film_broadcast_qc_reports', key: 'id', filter: 'project_id = ?' },
    { table: 'film_script_elements', key: 'id', filter: 'script_id IN (SELECT id FROM film_scripts WHERE project_id = ?)' },
    { table: 'render_ledger', key: 'id', filter: 'shot_id IN (SELECT id FROM film_shots WHERE scene_id IN (SELECT id FROM film_scenes WHERE project_id = ?))' },
    { table: 'film_screenplay_comments', key: 'id', filter: 'script_id IN (SELECT id FROM film_scripts WHERE project_id = ?)' },
    // The score (MUS-021): the sequences sessions sit on, then every session table, parents first.
    { table: 'film_sequences', key: 'id', filter: 'project_id = ?' },
    // Cuts made in an editor, before the sessions written against them.
    { table: 'film_edits', key: 'id', filter: 'project_id = ?' },
    { table: 'film_music_sessions', key: 'id', filter: 'project_id = ?' },
    { table: 'film_music_tracks', key: 'id', filter: 'session_id IN (SELECT id FROM film_music_sessions WHERE project_id = ?)' },
    { table: 'film_music_clips', key: 'id', filter: 'track_id IN (SELECT t.id FROM film_music_tracks t JOIN film_music_sessions s ON s.id = t.session_id WHERE s.project_id = ?)' },
    { table: 'film_music_emotion_ranges', key: 'id', filter: 'session_id IN (SELECT id FROM film_music_sessions WHERE project_id = ?)' },
    { table: 'film_music_markers', key: 'id', filter: 'session_id IN (SELECT id FROM film_music_sessions WHERE project_id = ?)' },
    { table: 'film_music_automation', key: 'id', filter: 'track_id IN (SELECT t.id FROM film_music_tracks t JOIN film_music_sessions s ON s.id = t.session_id WHERE s.project_id = ?)' },
    { table: 'film_music_operations', key: 'id', filter: 'session_id IN (SELECT id FROM film_music_sessions WHERE project_id = ?)' },
    { table: 'film_music_daw_links', key: 'id', filter: 'session_id IN (SELECT id FROM film_music_sessions WHERE project_id = ?)' },
];


/**
 * Copy a project's asset directory, subdirectories and all.
 *
 * `readdirSync` + `copyFileSync` throws EISDIR the moment a subdirectory
 * appears, and one has been there since frames started being archived:
 * `storyboards/<project>/versions/` holds every superseded attempt. On a real
 * project that is 61 files, and exporting it threw rather than producing a
 * bundle — a backup that fails on exactly the projects worth backing up.
 *
 * `.thumbs` is skipped deliberately. It is a derived cache rebuilt on demand
 * from the pictures beside it, so bundling it would inflate every archive with
 * bytes the importing machine can regenerate for free.
 */
function copyAssetTree(srcDir, destDir, onFile) {
    for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
        if (entry.name === THUMB_CACHE_DIR) continue;
        const from = path.join(srcDir, entry.name);
        const to = path.join(destDir, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(to, { recursive: true });
            copyAssetTree(from, to, onFile);
        } else if (entry.isFile()) {
            fs.copyFileSync(from, to);
            // Keep the mtime: a file's identity (size and mtime) is part of
            // fingerprints and caches, and a copy that resets it reads as new work.
            try { const st = fs.statSync(from); fs.utimesSync(to, st.atime, st.mtime); } catch (_) { /* best effort */ }
            if (onFile) onFile();
        }
    }
}


/**
 * Export a project to a .tar.gz bundle.
 * @param {string} projectId
 * @returns {{ archivePath: string, manifest: object }} Path to the .tar.gz and the manifest
 */
function exportProject(projectId) {
    // Verify project exists
    const project = db.prepare('SELECT * FROM film_projects WHERE id = ?').get(projectId);
    if (!project) throw new Error('Project not found');

    // Create temp staging directory
    const tmpBase = path.join(DATA_DIR, '.tmp-export');
    if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });
    const stagingDir = path.join(tmpBase, `export-${projectId}-${Date.now()}`);
    fs.mkdirSync(stagingDir, { recursive: true });

    // Export all table data
    const manifest = {
        version: 1,
        format: 'film-engine-bundle',
        exported_at: new Date().toISOString(),
        source_project_id: projectId,
        tables: {},
    };

    for (const { table, filter } of EXPORT_TABLES) {
        try {
            const rows = db.prepare(`SELECT * FROM ${table} WHERE ${filter}`).all(projectId);
            manifest.tables[table] = rows;
        } catch (e) {
            // Table might not exist yet (optional migration)
            if (PROCESSING_TABLES.has(table) && !e.message.includes(`no such table: ${table}`)) throw e;
            manifest.tables[table] = [];
        }
    }

    // Copy asset files
    for (const subdir of ASSET_SUBDIRS) {
        const srcDir = fileStorage.dirFor(projectId, subdir);
        if (fs.existsSync(srcDir)) {
            const destDir = path.join(stagingDir, subdir);
            fs.mkdirSync(destDir, { recursive: true });
            copyAssetTree(srcDir, destDir);
        }
    }

    // Every carried file with its hash, so a damaged bundle is refused rather than half-imported.
    manifest.files = listFiles(stagingDir).map(rel => {
        const buf = fs.readFileSync(path.join(stagingDir, rel));
        return { path: rel.split(path.sep).join('/'), size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
    });
    // Which sessions' latest bounce was their current mix, so the import can keep it current.
    manifest.music_sessions = (manifest.tables.film_music_sessions || []).map(scoreState);

    // Write manifest
    fs.writeFileSync(path.join(stagingDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Create tar.gz archive
    const safeTitle = (project.title || 'project').replace(/[^a-zA-Z0-9_-]/g, '_');
    const archiveName = `${safeTitle}-${projectId.slice(0, 8)}.tar.gz`;
    const archivePath = path.join(tmpBase, archiveName);
    const tarCreate = spawnSync('tar', ['czf', archivePath, '-C', stagingDir, '.'], { stdio: 'pipe' });
    if (tarCreate.status !== 0) {
        throw new Error('Failed to create archive: ' + (tarCreate.stderr?.toString() || 'unknown error'));
    }

    // Clean up staging directory
    fs.rmSync(stagingDir, { recursive: true, force: true });

    return { archivePath, manifest, archiveName };
}

/**
 * Import a project from a .tar.gz bundle.
 * @param {Buffer} archiveBuffer - The raw .tar.gz buffer
 * @returns {{ project: object, stats: object }} The new project and import stats
 */
function importProject(archiveBuffer) {
    // Create temp extraction directory
    const tmpBase = path.join(DATA_DIR, '.tmp-export');
    if (!fs.existsSync(tmpBase)) fs.mkdirSync(tmpBase, { recursive: true });
    const extractDir = path.join(tmpBase, `import-${Date.now()}`);
    fs.mkdirSync(extractDir, { recursive: true });

    // Write buffer to temp file and extract
    const tmpArchive = path.join(tmpBase, `import-${Date.now()}.tar.gz`);
    fs.writeFileSync(tmpArchive, archiveBuffer);
    const tarExtract = spawnSync('tar', ['xzf', tmpArchive, '-C', extractDir], { stdio: 'pipe' });
    if (tarExtract.status !== 0) {
        fs.unlinkSync(tmpArchive);
        throw new Error('Failed to extract archive: ' + (tarExtract.stderr?.toString() || 'unknown error'));
    }
    fs.unlinkSync(tmpArchive);

    // Read manifest
    const manifestPath = path.join(extractDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw new Error('Invalid bundle: manifest.json not found');
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (manifest.format !== 'film-engine-bundle' || manifest.version !== 1) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw new Error('Unsupported bundle format or version');
    }

    // Every file is what the manifest says it is, before anything is written.
    const damaged = verifyFiles(extractDir, manifest.files);
    if (damaged.length) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw new Error(`Damaged bundle, nothing imported: ${damaged.join('; ')}`);
    }

    // Build ID remap: old ID → new ID (new UUIDs for every row)
    const idMap = {};
    for (const { table } of EXPORT_TABLES) {
        const rows = manifest.tables[table] || [];
        for (const row of rows) {
            if (row.id && !idMap[row.id]) {
                idMap[row.id] = generateId();
            }
        }
    }

    const stats = { tables: {}, assets_copied: 0 };
    const newProjectId = manifest.tables.film_projects?.[0]?.id
        ? idMap[manifest.tables.film_projects[0].id]
        : null;

    if (!newProjectId) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw new Error('Invalid bundle: no project data');
    }

    /*
     * The imported film gets its OWN folder here, named after it — never the
     * folder the manifest names, which is on the machine it came from (and on
     * this one may belong to the project it was exported from).
     */
    const importedTitle = (manifest.tables.film_projects[0].title || 'Imported Film');
    const where = require('./project-storage').resolveRequested({}, importedTitle, newProjectId);
    if (!where.ok) {
        fs.rmSync(extractDir, { recursive: true, force: true });
        throw new Error(`Cannot make a folder for the imported project: ${where.error}`);
    }
    const destRoot = where.dir;

    // Required processing references must be carried by this bundle, rather
    // than accidentally resolving to rows/files in the exporting instance.
    try { validateProcessing(manifest, extractDir); }
    catch (e) { fs.rmSync(extractDir, { recursive: true, force: true }); throw e; }

    // Import in a transaction. Foreign keys are enforced by a check over the
    // rows just inserted rather than per statement, so rows may land in any
    // order and a self-reference (a retry naming its parent) cannot fail.
    const inserted = {};
    const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1;
    db.pragma('foreign_keys = OFF');
    const importAll = db.transaction(() => {
        for (const { table } of EXPORT_TABLES) {
            const rows = manifest.tables[table] || [];
            if (rows.length === 0) { stats.tables[table] = 0; continue; }
            const pathCols = new Set(PATH_COLUMNS.filter(c => c.table === table).map(c => c.column));
            if (table === 'production_composite_handoffs') pathCols.add('directory');
            inserted[table] = [];
            let count = 0;
            for (const row of rows) {
                const remapped = {};
                for (const [k, v] of Object.entries(row)) {
                    if (['__proto__', 'constructor', 'prototype'].includes(k)) continue;
                    let val = k === 'file_name' ? v : remapValue(v, idMap, destRoot, PROCESSING_TABLES.has(table), k);
                    if (pathCols.has(k) && typeof v === 'string' && v) {
                        // Rebuilt inside this project's folder from the kind and
                        // the rest of the path — whichever layout it came from.
                        const parsed = folders.parseStored(v);
                        if (parsed) val = relocatedPath(v, destRoot);
                        else {
                            const tail = tailOf(v);
                            if (tail) val = path.join(DATA_DIR, tail);
                        }
                    }
                    if (table === 'film_projects' && k === 'assets_dir') val = destRoot;
                    remapped[k] = val;
                }
                if (table === 'production_depth_jobs' || table === 'production_composite_jobs') {
                    // A transported PID/token never owns work on this instance.
                    remapped.owner_pid = 0;
                    remapped.owner_token = '';
                    if (PROCESSING_ACTIVE.has(remapped.status)) {
                        remapped.status = 'interrupted';
                        remapped.phase = 'Imported job interrupted; inspect and review before retry';
                        remapped.finished_at = new Date().toISOString();
                    }
                }
                const cols = Object.keys(remapped);
                try {
                    const info = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map(c => remapped[c]));
                    inserted[table].push(info.lastInsertRowid);
                    count++;
                } catch (e) {
                    // A required score or processing row cannot be silently lost.
                    if (STRICT_TABLES.has(table)) throw new Error(`${table} row ${row.id} could not be imported: ${e.message}`);
                    // Older tables keep their tolerance of a schema that moved on.
                    (stats.skipped_rows ||= []).push({ table, id: row.id, reason: e.message });
                }
            }
            stats.tables[table] = count;
        }
        enforceReferences(inserted, stats);
    });
    try { importAll(); }
    catch (e) { fs.rmSync(extractDir, { recursive: true, force: true }); throw e; }
    finally { if (fkWasOn) db.pragma('foreign_keys = ON'); }

    // Copy asset files to data directory with new project ID
    const oldProjectId = manifest.source_project_id;
    for (const subdir of ASSET_SUBDIRS) {
        const srcDir = path.join(extractDir, subdir);
        if (fs.existsSync(srcDir)) {
            const destDir = folders.layoutDir(destRoot, subdir);
            fs.mkdirSync(destDir, { recursive: true });
            copyAssetTree(srcDir, destDir, () => { stats.assets_copied++; });
        }
    }

    // Clean up extraction directory
    fs.rmSync(extractDir, { recursive: true, force: true });

    // A bundle from before project folders has no assets_dir column in its
    // row; the folder is recorded here whatever the manifest carried.
    db.prepare('UPDATE film_projects SET assets_dir = ? WHERE id = ?').run(destRoot, newProjectId);
    folders.scaffold(destRoot, importedTitle);

    // A bounce that was its session's current mix stays current under the new ids.
    stats.restamped_bounces = restampBounces(manifest.music_sessions, idMap);

    // Return the newly created project
    const project = db.prepare('SELECT * FROM film_projects WHERE id = ?').get(newProjectId);

    return { project, stats, id_map: { old: oldProjectId, new: newProjectId } };
}

// ── The helpers the score needed (MUS-021) ─────────────────────────────────

const { PATH_COLUMNS, tailOf } = require('./data-paths');
const SCORE_TABLES = new Set(['film_sequences', 'film_music_sessions', 'film_music_tracks', 'film_music_clips', 'film_music_emotion_ranges',
    'film_music_markers', 'film_music_automation', 'film_music_operations', 'film_music_daw_links']);
const PROCESSING_TABLES = new Set(EXPORT_TABLES.map(t => t.table).filter(t => t.startsWith('production_')));
const STRICT_TABLES = new Set([...SCORE_TABLES, ...PROCESSING_TABLES]);
const PROCESSING_ACTIVE = new Set(['running', 'validating', 'encoding', 'cancelling']);
const UUID_ANY = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Replace reference IDs; carried filenames are handled separately. */
function remapIds(value, idMap) {
    if (typeof value !== 'string' || !value) return value;
    return value.replace(UUID_ANY, m => idMap[m] || idMap[m.toLowerCase()] || m);
}

function relocatedPath(value, destRoot) {
    const parsed = folders.parseStored(value);
    return parsed ? path.join(folders.layoutDir(destRoot, parsed.subdir), ...parsed.rest.split('/')) : null;
}

/** Rewrite local references, keeping carried physical names and file bytes intact. */
function remapValue(value, idMap, destRoot, processing, column) {
    if (typeof value !== 'string' || !value) return value;
    if (!column.endsWith('_json') && column !== 'metadata') return relocatedPath(value, destRoot) || remapIds(value, idMap);
    let document;
    try { document = JSON.parse(value); } catch (_) { return relocatedPath(value, destRoot) || remapIds(value, idMap); }
    processing ||= !!(document && (document.depth_node_id || document.production_node_id));
    const visit = (v, key, parent) => {
        if (Array.isArray(v)) return v.map(x => visit(x, '', key));
        if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x, k, key)]));
        // The immutable manifests remain origin evidence. Local fingerprints
        // involving the old IDs are invalid: the service's existing source
        // inspection/save gate must run before retry, and caches cannot hit.
        if (processing && (['source_fingerprint', 'request_fingerprint', 'plan_fingerprint', 'cache_key'].includes(key)
            || (key === 'fingerprint' && ['source', 'source_json'].includes(parent)))) return null;
        if (typeof v !== 'string' || key === 'file_name') return v;
        return relocatedPath(v, destRoot) || remapIds(v, idMap);
    };
    return JSON.stringify(visit(document, column, ''));
}

/** Required processing rows/files are a whole unit; optional old tables remain tolerant. */
function validateProcessing(manifest, extractDir) {
    const carried = Object.fromEntries(EXPORT_TABLES.map(({ table }) => [table, new Map((manifest.tables[table] || []).map(r => [r.id, r]))]));
    const assets = new Set();
    const reference = (table, row, target, value, key) => {
        if (value == null) return; // NOT NULL constraints are checked during insertion.
        const found = carried[target]?.get(value);
        if (!found || (found.project_id && found.project_id !== manifest.source_project_id)) {
            throw new Error(`${table} row ${row.id} references ${target}.${key} outside the bundle or project`);
        }
        if (target === 'film_assets') assets.add(value);
    };
    for (const table of PROCESSING_TABLES) for (const row of manifest.tables[table] || []) {
        if (row.project_id !== manifest.source_project_id) throw new Error(`${table} row ${row.id} references another project`);
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) reference(table, row, fk.table, row[fk.from], fk.from);
        const kind = table.startsWith('production_depth_') ? 'depth' : 'composite';
        const visit = value => {
            if (!value || typeof value !== 'object') return;
            for (const [key, v] of Object.entries(value)) {
                let target;
                if (key === 'asset_id' || key.endsWith('_asset_id')) target = 'film_assets';
                else if (key === 'project_id') target = 'film_projects';
                else if (['node_id', 'job_id', 'version_id'].includes(key)) target = `production_${kind}_${key.replace('_id', 's')}`;
                else if (['depth_node_id', 'depth_job_id', 'production_node_id', 'production_job_id'].includes(key)) {
                    target = `production_${key.startsWith('depth_') ? 'depth' : 'composite'}_${key.includes('node') ? 'nodes' : 'jobs'}`;
                }
                if (target) reference(table, row, target, v, key);
                else visit(v);
            }
        };
        for (const [key, value] of Object.entries(row)) if (key.endsWith('_json')) {
            const doc = JSON.parse(value);
            if (key === 'assets_json') for (const [role, aid] of Object.entries(doc)) reference(table, row, 'film_assets', aid, role);
            else visit(doc);
        }
    }
    const carriedPath = (table, value) => {
        const parsed = folders.parseStored(value);
        if (!parsed || !ASSET_SUBDIRS.includes(parsed.subdir)) throw new Error(`${table} references a file outside the bundle`);
        const root = path.join(extractDir, parsed.subdir), file = path.resolve(root, parsed.rest);
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            throw new Error(`${table} references a missing carried file: ${value}`);
        }
        return file;
    };
    for (const aid of assets) carriedPath('film_assets', carried.film_assets.get(aid).file_path);
    for (const row of manifest.tables.production_composite_handoffs || []) {
        const file = carriedPath('production_composite_handoffs', path.join(row.directory, 'manifest.json'));
        if (crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== row.manifest_sha256) {
            throw new Error('production_composite_handoffs manifest checksum differs from the carried file');
        }
    }
}

function listFiles(root, rel = '') {
    const out = [];
    for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
        const r = path.join(rel, e.name);
        if (e.isDirectory()) out.push(...listFiles(root, r));
        else if (e.isFile() && r !== 'manifest.json') out.push(r);
    }
    return out.sort();
}

function verifyFiles(root, files) {
    if (!Array.isArray(files)) return [];      // a bundle made before hashes were carried
    const bad = [];
    for (const f of files) {
        const p = path.join(root, ...String(f.path).split('/'));
        if (!p.startsWith(root + path.sep)) { bad.push(`${f.path}: outside the bundle`); continue; }
        if (!fs.existsSync(p)) { bad.push(`${f.path}: missing`); continue; }
        const h = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        if (h !== f.sha256) bad.push(`${f.path}: its sha256 does not match the manifest`);
    }
    return bad;
}

/**
 * Foreign keys over the rows just inserted. A score/processing row with a broken
 * reference refuses the import; an older table's dangling reference (to
 * something the bundle does not carry) is cleared where the column allows it,
 * and the row dropped where it does not — the tolerance it always had.
 */
function enforceReferences(inserted, stats) {
    const tables = Object.keys(inserted);
    const order = [...tables.filter(t => !STRICT_TABLES.has(t)), ...tables.filter(t => STRICT_TABLES.has(t))];
    for (const table of order) {
        const mine = new Set(inserted[table].map(Number));
        const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        const bad = db.prepare(`PRAGMA foreign_key_check(${table})`).all().filter(v => mine.has(Number(v.rowid)));
        for (const v of bad) {
            const fk = fks.filter(f => f.id === v.fkid);
            if (STRICT_TABLES.has(table)) throw new Error(`${table} row ${v.rowid} references a missing ${v.parent} (${fk.map(f => f.from).join(', ')})`);
            const nullable = fk.every(f => (cols.find(c => c.name === f.from) || {}).notnull === 0);
            if (nullable) db.prepare(`UPDATE ${table} SET ${fk.map(f => `${f.from} = NULL`).join(', ')} WHERE rowid = ?`).run(v.rowid);
            else db.prepare(`DELETE FROM ${table} WHERE rowid = ?`).run(v.rowid);
            (stats.cleared_references ||= []).push({ table, rowid: v.rowid, parent: v.parent, action: nullable ? 'cleared' : 'dropped' });
        }
    }
}

/**
 * For each stems mode a session has a complete bounce in, the fingerprint the
 * session would bounce to NOW. A bounce whose recorded fingerprint equals it
 * was current when exported, and is re-stamped on import against the new ids.
 */
function scoreState(session) {
    const out = { id: session.id, current: [] };
    try {
        const renderer = require('./music-renderer');
        const modes = [...new Set(renderer.listBounces(db, session.id).filter(b => b.status === 'complete').map(b => b.stems_mode || 'none'))];
        for (const mode of modes) {
            const plan = renderer.planBounce(db, session.id, { stems: mode });
            if (plan && plan.ok !== false && plan.fingerprint) out.current.push({ stems_mode: mode, fingerprint: plan.fingerprint });
        }
    } catch (_) { /* a session that cannot be planned carries nothing to re-stamp */ }
    return out;
}

function restampBounces(states, idMap) {
    let n = 0;
    const renderer = require('./music-renderer');
    for (const st of states || []) {
        const sid = idMap[st.id];
        for (const c of st.current || []) {
            let fp = null;
            try { fp = renderer.planBounce(db, sid, { stems: c.stems_mode }).fingerprint; } catch (_) { fp = null; }
            if (!fp) continue;
            for (const op of db.prepare("SELECT id, params_json FROM film_music_operations WHERE session_id = ? AND kind = 'bounce'").all(sid)) {
                let p; try { p = JSON.parse(op.params_json || '{}'); } catch (_) { continue; }
                if (p.fingerprint !== c.fingerprint || (p.stems_mode || 'none') !== c.stems_mode) continue;
                p.fingerprint = fp;
                db.prepare('UPDATE film_music_operations SET params_json = ? WHERE id = ?').run(JSON.stringify(p), op.id);
                n++;
            }
        }
    }
    return n;
}

module.exports = {
    // Exposed so the tree copy can be exercised directly: the fault it fixes
    // only appears on a project that has archived frames.
    __copyAssetTree: copyAssetTree, exportProject, importProject, EXPORT_TABLES, ASSET_SUBDIRS };
