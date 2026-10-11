const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
// Verify the gate is reached before the existing wildcard CORS/preflight or any dispatch.
test('server gates the new AI routes before CORS and body parsing; desktop binding is configurable', () => {
    const gate = serverSource.indexOf('aiRouteAuth.handle(req, res, pathname)');
    assert.ok(gate > 0, 'AI route authentication must run at the HTTP entry point');
    assert.ok(gate < serverSource.indexOf('// CORS'));
    assert.ok(gate < serverSource.indexOf('req.body = await readBody'));
    assert.match(serverSource, /server\.listen\(PORT, process\.env\.FILM_BACKEND_HOST/);
});

test('route capability permits the local app and blocks credentialless, foreign and LAN dispatch', async () => {
    const {createAIRouteAuth} = require('../lib/ai-route-auth');
    const {createAIConnectionsHandler} = require('../routes/ai-connections');
    let signs = 0;
    const handler = createAIConnectionsHandler({signIn: async () => {signs++; return {application: 'film-engine-v2'};}});
    const token = 'a'.repeat(64), auth = createAIRouteAuth({port: 3100, capability: token});
    const request = (extra = {}) => ({method: 'POST', headers: {host: 'localhost:3100', origin: 'null', 'x-film-ai-capability': token}, socket: {remoteAddress: '127.0.0.1'}, body: {provider: 'codex', human_confirmed: true}, ...extra});
    async function dispatch(req) {
        const res = response();
        if (auth.handle(req, res, '/film/ai-connections/sign-in')) await handler(req, res, ['film', 'ai-connections', 'sign-in']);
        return res;
    }
    assert.equal((await dispatch(request())).status, 200);
    assert.equal((await dispatch(request({headers: {host: '127.0.0.1:3100', 'x-film-ai-capability': token}}))).status, 200);
    for (const req of [
        request({headers: {host: 'localhost:3100', origin: 'null'}}),
        request({headers: {host: 'localhost:3100', 'x-film-ai-capability': 'wrong'}}),
        request({headers: {host: 'localhost:3100', origin: 'https://evil.test', 'x-film-ai-capability': token}}),
        request({headers: {host: 'evil.test:3100', origin: 'null', 'x-film-ai-capability': token}}),
        request({headers: {host: 'localhost:9999', 'x-film-ai-capability': token}}),
        request({socket: {remoteAddress: '192.168.1.7'}}),
        request({socket: {remoteAddress: '192.168.1.7'}, headers: {host: 'localhost:3100', 'x-forwarded-for': '127.0.0.1', 'x-film-ai-capability': token}}),
    ]) assert.ok([401, 403].includes((await dispatch(req)).status));
    assert.equal(signs, 2);
    assert.equal((await dispatch(request({socket: {remoteAddress: '::ffff:127.0.0.1'}}))).status, 200);
    for (const route of ['/film/ai-connections', '/film/ai-workspace/uploads/u1', '/film/projects/p1/ai-workspace/tasks/t1/execute']) assert.equal(auth.handles(route), true);
    for (const route of ['/film/projects/p1/script', '/film/projects/p1/screenplay-ai', '/api/health', '/film/ai-workspace-old']) assert.equal(auth.handles(route), false);
});

function response() {
    return {headers: {}, status: null, body: '', setHeader(key, value) {this.headers[key] = value;}, writeHead(status, headers = {}) {this.status = status; Object.assign(this.headers, headers);}, end(body = '') {this.body = body;}};
}

test('web bootstrap issues only an ephemeral capability to explicit trusted localhost development origins', () => {
    const {createAIRouteAuth} = require('../lib/ai-route-auth');
    const auth = createAIRouteAuth({port: 3100});
    function bootstrap(origin, host = 'localhost:3100', peer = '127.0.0.1', method = 'GET') {
        const res = response(); auth.handle({method, headers: {host, ...(origin === undefined ? {} : {origin})}, socket: {remoteAddress: peer}}, res, '/film/ai-capability'); return res;
    }
    const good = bootstrap('http://localhost:5173');
    assert.equal(good.status, 200); assert.match(JSON.parse(good.body).capability, /^[0-9a-f]{64}$/);
    assert.equal(good.headers['Cache-Control'], 'no-store'); assert.equal(good.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
    assert.equal(bootstrap('http://127.0.0.1:5173').status, 200);
    for (const origin of [undefined, 'null', 'https://evil.test', 'http://localhost:5174', 'http://localhost:5173.evil.test', 'http://192.168.1.7:5173']) assert.equal(bootstrap(origin).status, 403);
    assert.equal(bootstrap('http://localhost:5173', 'evil.test:3100').status, 403);
    assert.equal(bootstrap('http://localhost:5173', 'localhost:3100', '192.168.1.7').status, 403);
    assert.equal(bootstrap('http://localhost:5173', 'localhost:3100', '127.0.0.1', 'POST').status, 405);
    const desktop = createAIRouteAuth({port: 3100, capability: 'b'.repeat(64)}), res = response();
    desktop.handle({method: 'GET', headers: {host: 'localhost:3100', origin: 'http://localhost:5173'}, socket: {remoteAddress: '127.0.0.1'}}, res, '/film/ai-capability');
    assert.equal(res.status, 403);
});

test('explicit development origins stay local; preflights do not dispatch or disclose capability', () => {
    const {createAIRouteAuth} = require('../lib/ai-route-auth');
    assert.throws(() => createAIRouteAuth({devOrigins: ['https://evil.test']}), /localhost/);
    const auth = createAIRouteAuth({port: 3100, devOrigins: ['http://localhost:5184']}), res = response();
    assert.equal(auth.handle({method: 'OPTIONS', headers: {host: 'localhost:3100', origin: 'http://localhost:5184'}, socket: {remoteAddress: '::1'}}, res, '/film/ai-workspace'), false);
    assert.equal(res.status, 204); assert.equal(res.body, ''); assert.match(res.headers['Access-Control-Allow-Headers'], /X-Film-AI-Capability/);
    const bad = response(); auth.handle({method: 'OPTIONS', headers: {host: 'localhost:3100', origin: 'https://evil.test'}, socket: {remoteAddress: '127.0.0.1'}}, bad, '/film/ai-workspace');
    assert.equal(bad.status, 403); assert.equal(bad.headers['Access-Control-Allow-Origin'], undefined);
});
