// /film/stereo/... — GRD-4667 stereo qualification. A worker posts its raw measurements per clip;
// the build/reuse/no-go decision is a person's (an agent over MCP is refused).
const { db } = require('../db/database');
const sq = require('../lib/stereo-qualification');
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
async function handleStereo(req, res, parts) {
    const [area, id, action] = [parts[2], parts[3], parts[4]], b = req.body || {};
    try {
        if (area === 'candidates' && !id && req.method === 'GET') return json(res, 200, { candidates: sq.candidates(db) });
        if (area === 'candidates' && action === 'evidence' && req.method === 'POST') return json(res, 200, sq.recordEvidence(db, id, b));
        if (area === 'candidates' && action === 'decide' && req.method === 'POST') {
            if (req.actor === 'agent') return json(res, 403, { error: 'A person makes the stereo decision', code: 'forbidden' });
            return json(res, 200, sq.decide(db, id, b));
        }
        if (area === 'reels' && !id && req.method === 'POST') return json(res, 201, await sq.defineReel(db, b));
        if (area === 'profiles' && !id && req.method === 'POST') return json(res, 201, sq.defineProfile(db, b));
        if (area === 'benchmarks' && !id && req.method === 'POST') {
            // Measurements made on the worker, per clip: { candidate_id, reel_id, cost_per_hour_usd, measurements: { clip_id: {...} } }.
            const m = b.measurements || {};
            return json(res, 201, await sq.runBenchmark(db, b.candidate_id, b.reel_id, { cost_per_hour_usd: b.cost_per_hour_usd, runAdapter: async clip => m[clip.id] || {} }));
        }
        if (area === 'benchmarks' && id && action === 'notes' && req.method === 'POST') return json(res, 200, sq.addReviewNote(db, id, b));
        if (area === 'benchmarks' && id && req.method === 'GET') return json(res, 200, sq.benchmark(db, id));
        return json(res, 405, { error: 'Method not allowed' });
    } catch (e) { return json(res, e.status || 500, { error: e.message, code: e.code }); }
}
module.exports = { handleStereo };
