const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-production-bundle-'));
process.env.FILM_DATA_DIR = dir;
delete process.env.FILM_PROJECTS_DIR;
const { db, generateId: id } = require('../db/database');
require('../db/schema').ensureSchema();
const bundle = require('../lib/project-bundle');
const storage = require('../lib/file-storage');
const folders = require('../lib/project-folders');
const media = require('../lib/depth-media');
const { createDepthService } = require('../lib/production-depth');
const { createCompositeService } = require('../lib/production-composite');
const TABLES = ['production_depth_nodes', 'production_depth_jobs', 'production_depth_versions',
    'production_composite_nodes', 'production_composite_jobs', 'production_composite_versions', 'production_composite_handoffs'];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const insert = (table, row) => {
    const cols = Object.keys(row);
    db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?')})`).run(...Object.values(row));
};
const rows = (table, pid) => db.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY rowid`).all(pid);
const timing = { width: 2, height: 2, coded_width: 2, coded_height: 2, display_rotation_degrees: 0,
    frame_count: 2, start_frame: 0, end_frame_exclusive: 2, start_pts: 0, duration_ticks: 2,
    time_base: { numerator: 1, denominator: 24 }, fps: { numerator: 24, denominator: 1 },
    frames: [{ index: 0, pts: 0, duration_ticks: 1 }, { index: 1, pts: 1, duration_ticks: 1 }] };

// Opaque media bytes keep this a storage unit test. Only media probing is injected;
// hashing, rows, archive files, service reads and composite recipe admission are real.
function fixture() {
    const pid = id(), root = path.join(dir, 'projects', 'Original ' + pid);
    insert('film_projects', { id: pid, title: 'Production bundle', assets_dir: root });
    folders.scaffold(root, 'Production bundle');
    const ids = Object.fromEntries(['source', 'plate', 'depthNode', 'depthJob', 'depthActive', 'depthVersion',
        'compositeNode', 'compositeJob', 'compositeActive', 'compositeVersion', 'handoff'].map(k => [k, id()]));
    const asset = (key, subdir, name, bytes, metadata = {}, type = 'other', format = path.extname(name).slice(1)) => {
        const aid = ids[key] ||= id(), file = path.join(storage.dirFor(pid, subdir), name);
        fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
        insert('film_assets', { id: aid, project_id: pid, asset_type: type, file_path: file, file_name: path.basename(file),
            format, width: 2, height: 2, metadata: JSON.stringify(metadata) });
        return file;
    };
    const sourceFile = asset('source', 'video', ids.source + '.mp4', 'unchanged source and audio bytes', {}, 'video_raw');
    asset('plate', 'refsheets', ids.plate + '.png', 'unchanged plate bytes', {}, 'reference_image');
    const source = { asset_id: ids.source, asset_version: 1, asset_type: 'video_raw', file_name: path.basename(sourceFile),
        sha256: hash(sourceFile), timing };
    source.fingerprint = media.digest(source);
    const compositeSource = { ...source }; delete compositeSource.asset_type; delete compositeSource.fingerprint;
    compositeSource.fingerprint = media.digest(compositeSource);
    const request = { project_id: pid, node_id: ids.depthNode, source_asset_id: ids.source,
        source_sha256: source.sha256, source_fingerprint: source.fingerprint, request_fingerprint: 'a'.repeat(64), timing };
    const depthBase = 'depth/' + ids.depthJob;
    const raw = asset('raw', 'exports', depthBase + '/depth.f32', Buffer.alloc(32),
        { typed_asset: 'DepthSequence', depth_node_id: ids.depthNode, depth_job_id: ids.depthJob, source_asset_id: ids.source,
            source_fingerprint: source.fingerprint, request_fingerprint: request.request_fingerprint });
    const preview = asset('depthPreview', 'exports', depthBase + '/depth-preview.mp4', 'depth preview bytes');
    const depthMetadata = { request, film_implementation: 'film-depth-node-v3-gpu', depth_kind: 'relative_inverse_depth',
        role: 'authoritative', fixture: true, backend: { fingerprint: 'b'.repeat(64), fixture: true },
        files: { width: 2, height: 2, raw_sha256: hash(raw), preview_sha256: hash(preview) } };
    const depthManifest = asset('depthManifest', 'exports', depthBase + '/manifest.json', JSON.stringify(depthMetadata));
    depthMetadata.manifest_sha256 = hash(depthManifest);
    insert('production_depth_nodes', { id: ids.depthNode, project_id: pid, source_asset_id: ids.source,
        source_json: JSON.stringify(source), settings_json: JSON.stringify({ start_frame: 0, end_frame_exclusive: 2 }) });
    for (const [jid, status] of [[ids.depthJob, 'complete'], [ids.depthActive, 'validating']]) {
        insert('production_depth_jobs', { id: jid, project_id: pid, node_id: ids.depthNode, node_revision: 1, mode: 'full',
            status, request_json: JSON.stringify(request), backend_json: '{}', owner_pid: process.pid, owner_token: 'original-depth-owner' });
    }
    insert('production_depth_versions', { id: ids.depthVersion, project_id: pid, node_id: ids.depthNode, job_id: ids.depthJob,
        version: 1, mode: 'full', raw_asset_id: ids.raw, preview_asset_id: ids.depthPreview, manifest_asset_id: ids.depthManifest,
        metadata_json: JSON.stringify(depthMetadata) });
    const compositeBase = 'composite/' + ids.compositeJob;
    const alpha = asset('alpha', 'exports', compositeBase + '/alpha.f32', Buffer.alloc(32),
        { typed_asset: 'AlphaSequence', source_asset_id: ids.source, production_node_id: ids.compositeNode,
            production_job_id: ids.compositeJob, source_sha256: source.sha256, raw_format: 'f32le', alpha_mode: 'straight', timing,
            provenance: { fixture: true } });
    const video = asset('video', 'exports', compositeBase + '/composite.mp4', 'composite video bytes');
    const foreground = asset('foreground', 'exports', compositeBase + '/foreground.mov', 'foreground bytes');
    const settings = { start_frame: 0, end_frame_exclusive: 2, width: 2, height: 2, plate_fit: 'contain' };
    const inputs = { source_asset_id: ids.source, alpha_asset_id: ids.alpha, background_asset_id: ids.plate, depth_asset_id: ids.raw };
    const inputFiles = { source: sourceFile, alpha, background: rows('film_assets', pid).find(a => a.id === ids.plate).file_path, depth: raw };
    const metadata = { node_type: 'composite', node_id: ids.compositeNode, node_revision: 1, timing, settings, fixture: true,
        source_sha256: source.sha256, cache_key: 'c'.repeat(64), inputs: Object.fromEntries(Object.entries(inputFiles).map(([k, file]) =>
            [k, { project_id: pid, asset_id: inputs[{ source: 'source_asset_id', alpha: 'alpha_asset_id', background: 'background_asset_id', depth: 'depth_asset_id' }[k]], file_path: file, sha256: hash(file) }])),
        outputs: { alpha: { sha256: hash(alpha) }, video: { sha256: hash(video) }, foreground: { sha256: hash(foreground) } } };
    const manifest = asset('compositeManifest', 'exports', compositeBase + '/manifest.json', JSON.stringify(metadata));
    metadata.manifest_sha256 = hash(manifest);
    insert('production_composite_nodes', { id: ids.compositeNode, project_id: pid, node_type: 'composite',
        inputs_json: JSON.stringify(inputs), source_json: JSON.stringify(compositeSource), settings_json: JSON.stringify(settings) });
    for (const [jid, status] of [[ids.compositeJob, 'complete'], [ids.compositeActive, 'cancelling']]) {
        insert('production_composite_jobs', { id: jid, project_id: pid, node_id: ids.compositeNode, node_revision: 1, status,
            phase: 'Original phase', plan_json: JSON.stringify({ project_id: pid, node_id: ids.compositeNode, source: compositeSource,
                operation: metadata, cache_key: metadata.cache_key, plan_fingerprint: 'd'.repeat(64) }), owner_pid: process.pid,
            owner_token: 'original-composite-owner' });
    }
    insert('production_composite_versions', { id: ids.compositeVersion, project_id: pid, node_id: ids.compositeNode,
        job_id: ids.compositeJob, version: 1, assets_json: JSON.stringify({ alpha: ids.alpha, video: ids.video, foreground: ids.foreground,
            manifest: ids.compositeManifest }), metadata_json: JSON.stringify(metadata) });
    const handoff = path.join(storage.dirFor(pid, 'exports'), 'resolve-layers-' + ids.handoff);
    fs.mkdirSync(path.join(handoff, 'Source'), { recursive: true });
    fs.copyFileSync(sourceFile, path.join(handoff, 'Source', 'original.mp4'));
    fs.writeFileSync(path.join(handoff, 'manifest.json'), JSON.stringify({ project_id: pid, version_id: ids.compositeVersion,
        package_id: ids.handoff, files: [{ name: 'Source/original.mp4', sha256: hash(sourceFile) }] }));
    insert('production_composite_handoffs', { id: ids.handoff, project_id: pid, version_id: ids.compositeVersion,
        directory: handoff, manifest_sha256: hash(path.join(handoff, 'manifest.json')) });
    return { pid, root, ids };
}
let carried;
function roundtrip() {
    if (carried) return carried;
    const f = fixture(), before = Object.fromEntries(['film_assets', ...TABLES].map(t => [t, rows(t, f.pid)]));
    const exported = bundle.exportProject(f.pid), bytes = fs.readFileSync(exported.archivePath);
    const out = bundle.importProject(bytes), after = Object.fromEntries(['film_assets', ...TABLES].map(t => [t, rows(t, out.project.id)]));
    return carried = { f, before, after, exported, bytes, out };
}
function altered(bytes, change) {
    const tmp = fs.mkdtempSync(path.join(dir, 'alter-')), archive = path.join(tmp, 'bundle.tar.gz'), tree = path.join(tmp, 'tree');
    fs.mkdirSync(tree); fs.writeFileSync(archive, bytes); execFileSync('tar', ['xzf', archive, '-C', tree]);
    const manifestFile = path.join(tree, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(manifestFile));
    change(manifest); fs.writeFileSync(manifestFile, JSON.stringify(manifest));
    execFileSync('tar', ['czf', archive, '-C', tree, '.']); return fs.readFileSync(archive);
}
test.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('all seven processing tables travel after assets in dependency order', () => {
    const tables = bundle.EXPORT_TABLES.map(t => t.table);
    for (const table of TABLES) {
        assert.ok(tables.includes(table), `${table} omitted`);
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
            assert.ok(tables.indexOf(fk.table) < tables.indexOf(table), `${table} before ${fk.table}`);
        }
    }
});

test('processing rows and files roundtrip with new owned references and byte-identical media/provenance', () => {
    const r = roundtrip(), pid = r.out.project.id;
    for (const table of TABLES) assert.equal(r.after[table].length, r.before[table].length, table);
    const mapped = new Map(Object.keys(r.before).flatMap(t => r.before[t].map((row, i) => [row.id, r.after[t][i].id])));
    mapped.set(r.f.pid, pid);
    for (const [old, next] of mapped) assert.notEqual(next, old);
    for (const table of TABLES) for (const row of r.after[table]) {
        assert.equal(row.project_id, pid);
        for (const fk of db.prepare(`PRAGMA foreign_key_list(${table})`).all()) {
            const target = db.prepare(`SELECT * FROM ${fk.table} WHERE ${fk.to}=?`).get(row[fk.from]);
            assert.ok(target, `${table}.${fk.from}`); assert.equal(target.project_id || target.id, pid);
        }
    }
    for (let i = 0; i < r.after.film_assets.length; i++) {
        const a = r.after.film_assets[i], old = r.before.film_assets[i];
        assert.equal(a.file_name, old.file_name, 'carried physical filenames stay intact');
        assert.ok(a.file_path.startsWith(r.out.project.assets_dir + path.sep));
        assert.equal(hash(a.file_path), hash(old.file_path), a.file_name);
    }
    const depth = r.after.production_depth_versions[0], meta = JSON.parse(depth.metadata_json);
    assert.equal(meta.request.source_asset_id, mapped.get(r.f.ids.source));
    assert.equal(meta.request.node_id, mapped.get(r.f.ids.depthNode));
    assert.equal(meta.request.project_id, pid);
    assert.equal(meta.request.source_fingerprint, null);
    assert.equal(meta.request.request_fingerprint, null);
    assert.equal(JSON.parse(r.after.film_assets.find(a => a.id === depth.raw_asset_id).metadata).source_fingerprint, null);
    const composite = JSON.parse(r.after.production_composite_versions[0].metadata_json);
    for (const entry of Object.values(composite.inputs)) {
        assert.equal(entry.project_id, pid); assert.ok(r.after.film_assets.some(a => a.id === entry.asset_id));
        assert.ok(entry.file_path.startsWith(r.out.project.assets_dir + path.sep)); assert.equal(hash(entry.file_path), entry.sha256);
    }
    const handoff = r.after.production_composite_handoffs[0];
    assert.equal(path.basename(handoff.directory), path.basename(r.before.production_composite_handoffs[0].directory));
    assert.equal(hash(path.join(handoff.directory, 'manifest.json')), handoff.manifest_sha256);
    assert.equal(hash(path.join(handoff.directory, 'Source/original.mp4')), hash(r.before.film_assets[0].file_path));
    for (const table of Object.keys(r.before)) assert.deepEqual(rows(table, r.f.pid), r.before[table], 'original ' + table);
    for (const table of ['production_depth_jobs', 'production_composite_jobs']) {
        assert.equal(r.after[table][0].status, 'complete');
        const active = r.after[table][1]; assert.equal(active.status, 'interrupted');
        assert.equal(active.owner_pid, 0); assert.equal(active.owner_token, ''); assert.ok(active.finished_at);
        assert.match(active.phase, /review/i);
    }
});

test('every imported active phase is interrupted even when its old PID is still alive', () => {
    const r = roundtrip();
    for (const status of ['running', 'validating', 'encoding', 'cancelling']) {
        const out = bundle.importProject(altered(r.bytes, m => {
            for (const t of ['production_depth_jobs', 'production_composite_jobs']) m.tables[t][1].status = status;
        }));
        for (const t of ['production_depth_jobs', 'production_composite_jobs']) {
            const jobs = rows(t, out.project.id);
            assert.equal(jobs[0].status, 'complete'); assert.equal(jobs[1].status, 'interrupted');
            for (const j of jobs) { assert.equal(j.owner_pid, 0); assert.equal(j.owner_token, ''); }
        }
    }
});

test('legacy storage paths inside processing JSON relocate to the actual carried filenames', () => {
    const r = roundtrip();
    const out = bundle.importProject(altered(r.bytes, m => {
        for (const tableRows of Object.values(m.tables)) for (const row of tableRows) for (const [key, value] of Object.entries(row)) {
            if (typeof value !== 'string') continue;
            let rewritten = value;
            for (const subdir of bundle.ASSET_SUBDIRS) rewritten = rewritten.split(folders.layoutDir(r.f.root, subdir) + path.sep)
                .join(`/origin/data/${subdir}/${r.f.pid}/`);
            row[key] = rewritten;
        }
        m.tables.film_projects[0].assets_dir = null;
    }));
    for (const a of rows('film_assets', out.project.id)) {
        assert.ok(a.file_path.startsWith(out.project.assets_dir + path.sep)); assert.ok(fs.existsSync(a.file_path));
    }
    const metadata = JSON.parse(rows('production_composite_versions', out.project.id)[0].metadata_json);
    for (const entry of Object.values(metadata.inputs)) assert.equal(hash(entry.file_path), entry.sha256);
    const h = rows('production_composite_handoffs', out.project.id)[0];
    assert.equal(hash(path.join(h.directory, 'manifest.json')), h.manifest_sha256);
});

test('imported versions reopen, depth provenance feeds composite, and old plans require fresh inspection', async () => {
    const r = roundtrip(), pid = r.out.project.id, inspect = async () => timing;
    const depth = createDepthService(db, { inspect, worker: { describe: async () => ({ available: false }) } });
    const composite = createCompositeService(db, { inspect, allowFixture: true, worker: { describe: async () => ({ available: false }) } });
    const dn = r.after.production_depth_nodes[0], cn = r.after.production_composite_nodes[0];
    assert.equal(depth.readNode(pid, dn.id).versions[0].raw_asset_id, r.after.production_depth_versions[0].raw_asset_id);
    for (const kind of ['raw', 'preview', 'manifest']) assert.ok(depth.versionFile(pid, r.after.production_depth_versions[0].id, kind).size > 0);
    for (const kind of ['alpha', 'video', 'foreground', 'manifest']) assert.ok(composite.versionFile(pid, r.after.production_composite_versions[0].id, kind).size > 0);
    assert.equal(hash(composite.handoffFile(pid, r.after.production_composite_handoffs[0].id).path), r.after.production_composite_handoffs[0].manifest_sha256);
    await assert.rejects(depth.plan(pid, dn.id, { expected_revision: 1, mode: 'full' }), /inspect.*save/i);
    await assert.rejects(composite.plan(pid, cn.id, { expected_revision: 1 }), /inspect.*save/i);
    const inspected = await composite.inspectSource(pid, JSON.parse(cn.inputs_json).source_asset_id);
    assert.equal(inspected.sha256, JSON.parse(cn.source_json).sha256);
    assert.notEqual(inspected.fingerprint, JSON.parse(cn.source_json).fingerprint);
    const saved = await composite.saveNode(pid, cn.id, { expected_revision: 1, source_fingerprint: inspected.fingerprint,
        inputs: JSON.parse(cn.inputs_json), settings: JSON.parse(cn.settings_json) });
    assert.equal(saved.revision, 2, 'recipe admission reads imported depth provenance');
    const plan = await composite.plan(pid, cn.id, { expected_revision: 2 });
    assert.equal(plan.cache, null); assert.equal(plan.operation.recipe.depth.source_sha256, inspected.sha256);
    assert.ok(plan.operation.recipe.depth.file_path.startsWith(fs.realpathSync(r.out.project.assets_dir) + path.sep));
});

for (const label of ['missing', 'unrelated existing']) test(`a ${label} production FK refuses atomically`, () => {
    const r = roundtrip(), unrelated = id();
    insert('film_projects', { id: unrelated, title: label });
    const alienAsset = id(); insert('film_assets', { id: alienAsset, project_id: unrelated, asset_type: 'other' });
    const bytes = altered(r.bytes, m => { m.tables.production_depth_versions[0].raw_asset_id = label === 'missing' ? id() : alienAsset; });
    const before = db.prepare('SELECT COUNT(*) n FROM film_projects').get().n, roots = fs.readdirSync(path.join(dir, 'projects'));
    assert.throws(() => bundle.importProject(bytes), /production_depth_versions.*(missing|bundle|reference)/i);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_projects').get().n, before);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'projects')), roots);
    assert.equal(rows('production_depth_versions', r.f.pid).length, 1);
});

test('incompatible processing rows refuse while older optional rows keep their tolerance', () => {
    const r = roundtrip(), count = db.prepare('SELECT COUNT(*) n FROM film_projects').get().n;
    assert.throws(() => bundle.importProject(altered(r.bytes, m => { m.tables.production_depth_jobs[0].unknown_future_column = 'x'; })), /production_depth_jobs.*could not be imported/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_projects').get().n, count);
    const old = bundle.importProject(altered(r.bytes, m => {
        for (const t of TABLES) delete m.tables[t];
        m.tables.film_rights = [{ id: id(), project_id: m.source_project_id, unknown_future_column: 'x' }];
    }));
    assert.equal(old.project.title, 'Production bundle');
    assert.ok(old.stats.skipped_rows.some(r => r.table === 'film_rights'));
    for (const t of TABLES) assert.equal(rows(t, old.project.id).length, 0);
});

test('an uninsertable required asset or missing embedded input refuses without partial rows', () => {
    const r = roundtrip();
    for (const change of [m => { m.tables.film_assets.find(a => a.id === r.f.ids.raw).unknown_future_column = 'x'; },
        m => { const inputs = JSON.parse(m.tables.production_composite_nodes[0].inputs_json); inputs.alpha_asset_id = id();
            m.tables.production_composite_nodes[0].inputs_json = JSON.stringify(inputs); }]) {
        const before = db.prepare('SELECT COUNT(*) n FROM film_projects').get().n;
        assert.throws(() => bundle.importProject(altered(r.bytes, change)), /production_.*(missing|bundle|reference)/i);
        assert.equal(db.prepare('SELECT COUNT(*) n FROM film_projects').get().n, before);
    }
});
