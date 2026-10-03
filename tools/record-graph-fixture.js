// Records src/pages/productiongraph/fixtures/graph.json: a real GET /projects/:id/production-graph answer, from
// the backend's own route over a temp database (two shots in one scene, a sequence over both, a music cue), so the
// Production graph page tests run against the shape the server really sends. Re-run when that shape changes:
//   node tools/record-graph-fixture.js
const os = require('os');
const path = require('path');
const fs = require('fs');
process.env.FILM_DATA_DIR = path.join(os.tmpdir(), 'fe-graph-fixture-' + process.pid);
const { db } = require('../backend/db/database');
require('../backend/db/schema').ensureSchema();
const { handleProductionGraph } = require('../backend/routes/production-graph');

// Fixed UUIDs (the routes refuse anything else), so the fixture is the same every time it is recorded.
const P = '00000000-0000-4000-8000-000000000001';
db.prepare(`INSERT INTO film_projects (id, title, aspect_ratio, target_resolution) VALUES (?, 'Fixture', '16:9', '1920x1080')`).run(P);
db.prepare(`INSERT INTO film_scenes (id, project_id, scene_number, location, int_ext, time_of_day) VALUES ('00000000-0000-4000-8000-0000000000a1', ?, 1, 'DINER', 'INT', 'NIGHT')`).run(P);
db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, status, sort_order) VALUES ('00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000a1', '1A', 4000, 'pending', 0)`).run();
db.prepare(`INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, status, sort_order) VALUES ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000a1', '1B', 3000, 'pending', 1)`).run();
db.prepare(`INSERT INTO film_sequences (id, project_id, name, shot_ids) VALUES ('00000000-0000-4000-8000-0000000000c1', ?, 'Arrival', '["00000000-0000-4000-8000-0000000000b1","00000000-0000-4000-8000-0000000000b2"]')`).run(P);
db.prepare(`INSERT INTO film_music_cues (id, project_id, scene_id, cue_type, title, description) VALUES ('00000000-0000-4000-8000-0000000000d1', ?, '00000000-0000-4000-8000-0000000000a1', 'score', 'Diner theme', 'sparse piano')`).run(P);

const res = { statusCode: 200, writeHead(s) { this.statusCode = s; }, setHeader() {},
    end(body) {
        if (this.statusCode !== 200) throw new Error('route answered ' + this.statusCode + ': ' + body);
        const out = path.join(__dirname, '..', 'src/pages/productiongraph/fixtures/graph.json');
        fs.writeFileSync(out, JSON.stringify(JSON.parse(String(body)), null, 2) + '\n');
        console.log('wrote', path.relative(process.cwd(), out));
        fs.rmSync(process.env.FILM_DATA_DIR, { recursive: true, force: true });
    } };
handleProductionGraph({ method: 'GET', body: {} }, res, ['film', 'projects', P, 'production-graph'], {});
