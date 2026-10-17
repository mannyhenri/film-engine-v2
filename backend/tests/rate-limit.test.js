/**
 * RATE LIMIT: the desktop app talks to its own backend over loopback, and a limit meant for outside callers
 * throttled the app itself ("Too many requests" while directing, slow screens for a minute after). So:
 *   - every loopback form (IPv4, IPv6, IPv4-mapped) is never limited on general requests;
 *   - generation routes stay limited for everyone, loopback included (they spend money and GPU);
 *   - anyone else keeps the general limit, and an X-Forwarded-For header claiming loopback does not exempt them.
 */
const test = require('node:test');
const assert = require('node:assert');
const { createRateLimiter, isLoopback } = require('../lib/rate-limit');

const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.42'];
const REMOTE = ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '2001:db8::1'];
const opts = { windowMs: 60000, maxGeneral: 200, maxGeneration: 10 };

test('every loopback address is loopback, and nothing else is', () => {
    for (const a of LOOPBACK) assert.strictEqual(isLoopback(a), true, a);
    for (const a of [...REMOTE, '', undefined, 'unknown']) assert.strictEqual(isLoopback(a), false, String(a));
});

test('loopback: general requests are never limited; generation still is', () => {
    for (const ip of LOOPBACK) {
        const rl = createRateLimiter(opts);
        for (let i = 0; i < 1000; i++) assert.strictEqual(rl.allow({ remoteAddress: ip, bucket: 'general', now: 1000 }), true, `${ip} general #${i + 1}`);
        let allowed = 0;
        for (let i = 0; i < 25; i++) if (rl.allow({ remoteAddress: ip, bucket: 'generation', now: 1000 })) allowed++;
        assert.strictEqual(allowed, 10, `${ip}: generation allowed ${allowed}`);
    }
});

test('anyone else keeps the general limit, and a forwarded-for header claiming loopback changes nothing', () => {
    for (const ip of REMOTE) for (const forwardedFor of [undefined, '127.0.0.1', '::1']) {
        const rl = createRateLimiter(opts);
        let allowed = 0;
        for (let i = 0; i < 300; i++) if (rl.allow({ remoteAddress: ip, forwardedFor, bucket: 'general', now: 1000 })) allowed++;
        assert.strictEqual(allowed, 200, `${ip} (xff ${forwardedFor}): ${allowed}`);
        assert.strictEqual(rl.allow({ remoteAddress: ip, forwardedFor, bucket: 'general', now: 1000 + 60001 }), true, `${ip}: window did not roll`);
    }
});

test('server.js uses this limiter and keeps no copy of its own', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /require\('\.\/lib\/rate-limit'\)/);
    assert.doesNotMatch(src, /function checkRateLimit\(/);
});
