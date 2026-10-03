/*
 * Every /film/projects/:id/<report> route that routes/production-reports.js handles is REACHABLE:
 * server.js hands the request to handleProductionReports only for the names on its own list, and a
 * name the handler serves but the list forgot falls through to a 405 (shots-resync and shot-audit
 * did: the Resync dialog, the MCP shots_resync tool and the Sync screenplay button all got "Method
 * not allowed"). Set-based: the names are read from the handler, never typed here.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const handler = fs.readFileSync(path.join(ROOT, 'routes/production-reports.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

/** The project-scoped report names the handler serves (urlParts[3] === '<name>' and its simple map). */
function served() {
    const names = new Set([...handler.matchAll(/urlParts\[1\] === 'projects'[^\n]*?urlParts\[3\] === '([a-z-]+)'/g)].map(m => m[1]));
    const simple = handler.match(/const simple = \{([\s\S]*?)\};/);
    if (simple) for (const m of simple[1].matchAll(/'([a-z-]+)'\s*:/g)) names.add(m[1]);
    return names;
}
/** The names server.js routes to handleProductionReports for /film/projects/:id/<name>. */
function routed() {
    const at = server.indexOf("parts[1] === 'projects' && parts[2] && ['staleness'");
    assert.ok(at > -1, 'the report route list moved: this check is not reading server.js');
    const open = server.indexOf("['staleness'", at);
    const list = server.slice(open, server.indexOf(']', open));
    return new Set([...list.matchAll(/'([a-z-]+)'/g)].map(m => m[1]).filter(n => n !== 'projects'));
}

test('every project report the handler serves is routed to it', () => {
    const s = served();
    assert.ok(s.size >= 10, `only ${s.size} report names found: the scan is not reading the handler`);
    assert.ok(s.has('shots-resync') && s.has('screenplay-drift'), 'the scan misses known routes');
    const missing = [...s].filter(n => !routed().has(n));
    assert.deepStrictEqual(missing, [], 'served by production-reports.js but never routed there by server.js (they answer 405)');
});
