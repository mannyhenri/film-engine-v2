// /film/release-gates/... — GRD-4670 release gates. Evidence and artifacts are recorded per track
// against an exact version set; the report is read for one version set; a release is a person's.
const { db } = require('../db/database');
const re = require('../lib/release-evidence');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
async function handleReleaseGates(req, res, parts) {
    const [trackName, action] = [parts[2], parts[3]], b = req.body || {};
    try {
        if (trackName === 'registry' && !action && req.method === 'GET') return json(res, 200, { tests: re.ACCEPTANCE_TESTS, tracks: re.TRACKS, artifacts: re.ARTIFACTS });
        if (req.method === 'POST' && parts.length === 4) {
            if (action === 'evidence') return json(res, 201, re.recordEvidence(db, trackName, b));
            if (action === 'artifacts') return json(res, 201, re.recordArtifact(db, trackName, b));
            if (action === 'report') return json(res, 200, re.gate(db, trackName, b.versions));
            if (action === 'requalify') return json(res, 200, re.requalify(db, trackName, b));
            if (action === 'release') {
                if (req.actor === 'agent') return json(res, 403, { error: 'A person records a release', code: 'forbidden' });
                return json(res, 201, re.release(db, trackName, b));
            }
        }
        return json(res, 405, { error: 'Method not allowed' });
    } catch (e) { return json(res, e.status || 500, { error: e.message, code: e.code }); }
}
module.exports = { handleReleaseGates };
