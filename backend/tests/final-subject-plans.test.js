const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'final-subject-plans-'));
process.env.FILM_DATA_DIR = temp;
process.env.MUAPI_API_KEY = 'mock-only';
process.env.RUNWAY_API_KEY = 'mock-only';
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential = () => ({ apiKey: 'mock-only', meta: {} });
const contract = require('../lib/final-request-review');
const { prepareSubjectRequests } = require('../lib/final-subject-request-plans');
const project = crypto.randomUUID(), character = crypto.randomUUID(), location = crypto.randomUUID(), prop = crypto.randomUUID();
db.prepare('INSERT INTO film_projects (id,title,provider_config,target_resolution) VALUES (?,?,?,?)').run(project, 'Fixture', JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2' }), '2K');
db.prepare('INSERT INTO film_characters (id,project_id,name,description) VALUES (?,?,?,?)').run(character, project, 'Person', 'Red coat');
db.prepare('INSERT INTO film_locations (id,project_id,name,description) VALUES (?,?,?,?)').run(location, project, 'Room', 'Blue walls');
db.prepare('INSERT INTO film_props (id,project_id,name,description) VALUES (?,?,?,?)').run(prop, project, 'Cup', 'Green cup');
function response() { return { writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } }; }
async function approved(path, body) {
    const prepared = await prepareSubjectRequests({ path, body });
    const reviews = [], tokens = [];
    for (const item of prepared.items) {
        const review = await contract.store().preview(item);
        reviews.push(review);
        tokens.push(contract.store().approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true, cost_unknown_ack: true }));
    }
    return { prepared, reviews, tokens };
}
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
