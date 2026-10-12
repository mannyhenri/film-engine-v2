'use strict';
require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'final-storyboard-seed-'));
process.env.FILM_DATA_DIR = dataDir;
const { db } = require('../db/database');
const log = console.log;
try {
    console.log = () => {};
    require('../db/schema').ensureSchema();
} finally {
    console.log = log;
}
const credentials = require('../lib/providers/credentials');
const originalCredential = credentials.getCredential;
credentials.getCredential = () => ({ apiKey: 'mock-only', meta: {} });
const { boardItem } = require('../lib/final-request-plans');
const contract = require('../lib/final-request-review');
const store = contract.createFinalRequestStore(db);

test.after(() => {
    credentials.getCredential = originalCredential;
    contract.enterExecutionContext([]);
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

function shotFixture() {
    const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
    db.prepare('INSERT INTO film_projects(id,title,provider_config,aspect_ratio) VALUES(?,?,?,?)')
        .run(project, 'Storyboard seed consent', JSON.stringify({ image: 'higgsfield', image_model: 'qwen-image-3' }), '16:9');
    db.prepare('INSERT INTO film_scenes(id,project_id,scene_number,location) VALUES(?,?,?,?)')
        .run(scene, project, 1, 'An empty room');
    db.prepare('INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,?)')
        .run(shot, scene, '1A', '{}');
    return shot;
}

async function approvedReplan(seed) {
    const shot = shotFixture();
    const body = { seed, prompt_override: 'A red ball in an empty room.', provider: 'higgsfield', model: 'qwen-image-3' };
    const first = await boardItem(shot, body);
    assert.equal(first.provider, 'higgsfield');
    assert.equal(first.payload.model, 'qwen-image-3');
    const reviewed = await store.preview(first);
    const token = store.approve(reviewed.id, { fingerprint: reviewed.fingerprint, human_confirmed: true, cost_unknown_ack: true });
    const second = await boardItem(shot, body);
    contract.enterExecutionContext([token], body);
    const authorized = await contract.authorizeWithStore(store, { ...second, approvals: [token] });
    return { first, second, authorized };
}

test('explicit storyboard seed zero survives the actual normalized Higgsfield path and matches its approval', async () => {
    const { first, second, authorized } = await approvedReplan(0);
    assert.equal(authorized.ok, true, JSON.stringify({ first_seed: first.payload.seed, second_seed: second.payload.seed, default_seed: first.provenance.default_seed, status: authorized.status }));
    assert.equal(first.payload.seed, 0);
    assert.equal(second.payload.seed, 0);
    assert.equal(first.provenance.default_seed, undefined);
});

test('null storyboard seed remains an ephemeral default and matches its approval after replanning', async () => {
    const { first, authorized } = await approvedReplan(null);
    assert.equal(authorized.ok, true, JSON.stringify({ seed: first.payload.seed, default_seed: first.provenance.default_seed, status: authorized.status }));
    assert.equal(first.provenance.default_seed, true);
});
