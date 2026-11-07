'use strict';
const { db } = require('../db/database');
const { buildStoryboardPrint } = require('../lib/storyboard-print');
function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
}

/** Read-only snapshot; register before the generic project storyboard route. */
function handleStoryboardPrint(req, res, parts, query = {}) {
    if (req.method !== 'GET') return json(res, 405, { error: 'Storyboard print is read-only' });
    try {
        const plan = buildStoryboardPrint(db, parts[2], { paper: query.paper || 'letter', perPage: query.per_page || 4 });
        return plan ? json(res, 200, plan) : json(res, 404, { error: 'Project not found' });
    } catch (error) {
        if (!error.status) throw error;
        return json(res, error.status, { error: error.message });
    }
}
module.exports = { handleStoryboardPrint };
