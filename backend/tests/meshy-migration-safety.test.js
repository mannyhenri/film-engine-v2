const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const backend = path.resolve(__dirname, '..');
const migration = '129_meshy6lite_config.sql';
const original = JSON.stringify({ model3d: 'meshy', model3d_model: 'meshy-5', image: 'muapi' });
function fixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-migration-safety-'));
    const db = new Database(path.join(dir, 'film-engine.db'));
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE film_projects (id TEXT PRIMARY KEY, provider_config TEXT); CREATE TABLE _film_migrations (name TEXT UNIQUE NOT NULL, applied_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    for (const f of fs.readdirSync(path.join(backend, 'db/migrations')).filter(f => f.endsWith('.sql') && f !== migration)) {
        db.prepare('INSERT INTO _film_migrations(name) VALUES (?)').run(f);
    }
    db.prepare('INSERT INTO film_projects VALUES (?,?)').run('project', original);
    db.close();
    return dir;
}
const startup = "require('./db/schema').ensureSchema(); require('./db/database').db.close();";
function run(dir) {
    execFileSync(process.execPath, ['-e', startup], { cwd: backend, env: { ...process.env, FILM_DATA_DIR: dir }, stdio: 'pipe' });
}
test('repeated runner startup and conditional rollback preserve backups and later edits', () => {
    const dir = fixture();
    try {
        run(dir); run(dir);
        const db = new Database(path.join(dir, 'film-engine.db'));
        assert.equal(db.prepare('SELECT count(*) n FROM _film_migrations WHERE name=?').get(migration).n, 1);
        assert.equal(db.prepare('SELECT count(*) n FROM film_meshy6lite_config_backup').get().n, 1);
        assert.equal(db.prepare('SELECT original_config FROM film_meshy6lite_config_backup').get().original_config, original);
        const rollback = fs.readFileSync(path.join(backend, '../docs/meshy6lite-rollback.sql'), 'utf8');
        db.exec(rollback); db.exec(rollback);
        assert.equal(db.prepare('SELECT provider_config FROM film_projects').get().provider_config, original);
        db.prepare('UPDATE film_projects SET provider_config=?').run('{"later":"edit"}');
        db.exec(rollback);
        db.close(); run(dir);
        const check = new Database(path.join(dir, 'film-engine.db'));
        assert.equal(check.prepare('SELECT provider_config FROM film_projects').get().provider_config, '{"later":"edit"}');
        check.close();
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('concurrent runners reading the same pending migration both finish with one backup', async () => {
    const dir = fixture();
    const children = [];
    const diagnostics = [];
    try {
        const code = `
            const fs = require('fs'); const path = require('path');
            const { db } = require('./db/database'); const prepare = db.prepare.bind(db);
            db.prepare = function(sql) {
                const statement = prepare(sql);
                if (sql !== 'SELECT name FROM _film_migrations ORDER BY name') return statement;
                return { all() {
                    const rows = statement.all();
                    fs.writeFileSync(path.join(process.env.FILM_DATA_DIR, process.env.PROBE_ID), 'ready');
                    const deadline = Date.now() + 10000;
                    while (!fs.existsSync(path.join(process.env.FILM_DATA_DIR, 'go'))) {
                        if (Date.now() > deadline) throw Error('barrier timed out');
                        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
                    }
                    return rows;
                }};
            };
            ${startup}
        `;
        const completions = ['one', 'two'].map(id => {
            const child = spawn(process.execPath, ['-e', code], { cwd: backend, env: { ...process.env, FILM_DATA_DIR: dir, PROBE_ID: id } });
            children.push(child);
            let output = ''; child.stderr.on('data', b => output += b);
            return new Promise(resolve => child.on('close', code => (diagnostics.push({ code, output }), resolve({ code, output }))));
        });
        const deadline = Date.now() + 10000;
        while (!['one', 'two'].every(id => fs.existsSync(path.join(dir, id)))) {
            if (Date.now() > deadline) throw Error('children did not reach barrier: ' + JSON.stringify(diagnostics));
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        fs.writeFileSync(path.join(dir, 'go'), 'go');
        for (const outcome of await Promise.all(completions)) assert.equal(outcome.code, 0, outcome.output);
        const db = new Database(path.join(dir, 'film-engine.db'));
        assert.equal(db.prepare('SELECT count(*) n FROM _film_migrations WHERE name=?').get(migration).n, 1);
        assert.equal(db.prepare('SELECT count(*) n FROM film_meshy6lite_config_backup').get().n, 1);
        assert.equal(JSON.parse(db.prepare('SELECT provider_config FROM film_projects').get().provider_config).model3d_model, 'meshy-6-lite');
        db.close();
    } finally { for (const child of children) if (child.exitCode === null) child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
});
