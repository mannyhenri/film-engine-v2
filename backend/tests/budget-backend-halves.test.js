/**
 * The BACKEND halves of two film-engine sub-tests whose last line reads the legacy Budget page's text.
 *
 * production-estimate.test.js "the route, the tool and the Budget tab serve it, free" and
 * requested-size.test.js "a model that cannot reach 2K is not sold on its provider reaching it" each end
 * with a regex over the old page's template (film: 'budgetTabFilm', prodEstSet('resolution', max
 * ${esc(x.max_size)}). The Budget page is React, so those sub-tests are skipped (SKIPPED-SUBTESTS.json);
 * their backend assertions are kept HERE, verbatim, and the page halves run on the rendered page in
 * src/pages/budget/BudgetPage.test.jsx. v2 only; declared in tools/port-plan.json backendLocalChanges.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.FILM_DATA_DIR = process.env.FILM_DATA_DIR
    || path.join(os.tmpdir(), 'film-engine-budget-halves-' + crypto.randomUUID().slice(0, 8));
const { db, generateId } = require('../db/database');
require('../db/schema').ensureSchema();

test('production estimate: the route answers free at the asked resolution, and the agent tool serves it', async () => {
    const id = generateId();
    db.prepare(`INSERT INTO film_projects (id, title, target_resolution, aspect_ratio) VALUES (?, ?, '1920x1080', '16:9')`).run(id, 'Estimate');
    const scene = generateId();
    db.prepare('INSERT INTO film_scenes (id, project_id, scene_number, location) VALUES (?, ?, 1, ?)').run(scene, id, 'L0');
    db.prepare("INSERT INTO film_shots (id, scene_id, shot_code, duration_ms, status) VALUES (?, ?, '1A', 5000, 'pending')").run(generateId(), scene);
    const { handleBudget } = require('../routes/budget');
    const r = await new Promise(resolve => {
        const res = { statusCode: 200, writeHead(s) { this.statusCode = s; }, setHeader() {},
            end(c) { resolve({ status: this.statusCode, data: JSON.parse(String(c)) }); } };
        handleBudget({ method: 'GET', body: {} }, res, ['film', 'projects', id, 'budget', 'production'], { resolution: '4k_uhd', alternatives: 'false' });
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.free, true);
    assert.equal(r.data.resolution.id, '4k_uhd');
    const { callTool, isFailure, listTools } = require('../lib/mcp-tools');
    assert.ok(listTools().some(t => t.name === 'budget_production_estimate'));
    const t = await callTool('budget_production_estimate', { project_id: id, resolution: '720p' });
    assert.ok(!isFailure(t), JSON.stringify(t).slice(0, 300));
});

test('generator comparison: a model that cannot reach 2K is reported at its own maximum, every Google row says one', () => {
    const { compareGenerators } = require('../lib/generator-costs');
    const google = compareGenerators('image').rows.filter(r => r.provider === 'google');
    assert.ok(google.length, 'no google rows in the generator comparison; this check never ran');
    const draft = google.find(r => r.tier && r.tier.id === 'draft');
    assert.ok(draft, 'no draft-tier google row to check');
    assert.strictEqual(draft.max_size, '1K', 'the draft model is reported as reaching more than 1K — Google documents it as 1K only');
    assert.ok(google.filter(r => r.max_size && r.max_size !== '1K').length, 'no google model reports a size above 1K, so 2K is unreachable there too');
    for (const r of google) assert.ok(r.max_size, `${r.model}: no maximum size reported, so the tier cannot be judged`);
});
