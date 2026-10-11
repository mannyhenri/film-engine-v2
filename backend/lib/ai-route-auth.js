const crypto = require('node:crypto');
const CAPABILITY_HEADER = 'X-Film-AI-Capability';
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopbackAPI(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'http:' && localHosts.has(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    } catch {return false;}
}

function trustedDevelopmentOrigins(values = DEFAULT_DEV_ORIGINS) {
    return values.map(value => {
        const origin = String(value).trim();
        if (!isLoopbackAPI(origin) || new URL(origin).origin !== origin) throw Error('Film AI development origins must be explicit http localhost origins.');
        return origin;
    });
}

/** Auth is limited to the newly introduced AI account/control and workspace APIs. */
function createAIRouteAuth({port = 3100, capability, devOrigins = DEFAULT_DEV_ORIGINS, developmentBootstrap = !capability} = {}) {
    const token = capability || crypto.randomBytes(32).toString('hex');
    if (!/^[0-9a-f]{64}$/i.test(token)) throw Error('Film AI capability must be a random 32-byte hex value.');
    const trustedOrigins = new Set(trustedDevelopmentOrigins(devOrigins));
    const portSuffix = Number(port) === 80 ? '' : ':' + String(port);
    const trustedHosts = new Set([...localHosts].map(host => host + portSuffix));
    const handles = pathname => pathname === '/film/ai-capability'
        || /^\/film\/(?:ai-connections|ai-workspace)(?:\/|$)/.test(pathname)
        || /^\/film\/projects\/[^/]+\/ai-workspace(?:\/|$)/.test(pathname);
    function deny(res, status, error) {
        res.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
        res.end(JSON.stringify({error}));
        return false;
    }
    function handle(req, res, pathname) {
        const peer = req.socket?.remoteAddress, host = req.headers.host;
        const origin = req.headers.origin;
        const localPeer = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
        if (!localPeer || typeof host !== 'string' || !trustedHosts.has(host.toLowerCase())) return deny(res, 403, 'Film AI requests must come from the local app.');
        if (origin !== undefined && origin !== 'null' && !trustedOrigins.has(origin)) return deny(res, 403, 'Film AI origin is not trusted.');
        const bootstrap = pathname === '/film/ai-capability';
        // A desktop token is delivered by main's trusted-window IPC, never this endpoint.
        if (bootstrap && (!developmentBootstrap || !trustedOrigins.has(origin))) return deny(res, 403, 'Open Film from a trusted local development origin.');
        res.setHeader('Cache-Control', 'no-store');
        if (origin !== undefined) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, ' + CAPABILITY_HEADER);
        if (req.method === 'OPTIONS') {res.writeHead(204); res.end(); return false;}
        if (bootstrap) {
            if (req.method !== 'GET') return deny(res, 405, 'Film AI capability bootstrap requires GET.');
            res.writeHead(200, {'Content-Type': 'application/json'});
            res.end(JSON.stringify({capability: token}));
            return false;
        }
        const supplied = req.headers[CAPABILITY_HEADER.toLowerCase()];
        if (typeof supplied !== 'string' || !/^[0-9a-f]{64}$/i.test(supplied)
            || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(token))) return deny(res, 401, 'Film AI app capability is missing or invalid. Reopen Film.');
        return true;
    }
    return {handles, handle};
}

module.exports = {createAIRouteAuth, CAPABILITY_HEADER, DEFAULT_DEV_ORIGINS, isLoopbackAPI, trustedDevelopmentOrigins};
