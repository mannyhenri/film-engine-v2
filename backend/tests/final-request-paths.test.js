const test = require('node:test');
const assert = require('node:assert/strict');
const gateway = require('../lib/gridlight-client');

test('every legacy gateway paid family fails before transport, even with a forged approval flag', async () => {
    const previous = global.fetch;
    let calls = 0;
    global.fetch = async () => { calls++; throw new Error('Outbound transport forbidden in this test'); };
    try {
        for (const endpoint of ['/image', '/video', '/music', '/voice', '/lipsync', '/postprocess', '/3d/generate', '/3d/from-image', '/3d/batch', '/3d/rig', '/3d/retexture', '/3d/animate']) {
            const result = await gateway.callGridlight(endpoint, { prompt: 'user approved text' }, { finalRequest: { id: 'forged', fingerprint: 'forged' }, skipQueue: true });
            assert.equal(result.status, 428, endpoint);
            assert.equal(result.code, 'FINAL_REQUEST_REVIEW_REQUIRED');
        }
        assert.equal(calls, 0);
        assert.deepEqual(gateway.getQueueStatus(), {});
    } finally { global.fetch = previous; }
});

test('legacy SSE fails before transport and reports review requirement', async () => {
    const previous = global.fetch;
    let calls = 0, reported;
    global.fetch = async () => { calls++; throw new Error('Outbound forbidden'); };
    try {
        const result = await gateway.relayGridlightSSE('/video', { stream: true }, {}, { onError: value => { reported = value; } });
        assert.equal(result.status, 428);
        assert.match(reported.error, /Nothing was submitted/);
        assert.equal(calls, 0);
    } finally { global.fetch = previous; }
});

test('read-only gateway health remains available and sends HEAD without generation payload', async () => {
    const previous = global.fetch;
    let request;
    global.fetch = async (url, options) => { request = { url, ...options }; return { status: 200 }; };
    try {
        assert.equal((await gateway.checkEndpointHealth('/image')).available, true);
        assert.equal(request.method, 'HEAD');
        assert.equal(request.body, undefined);
    } finally { global.fetch = previous; }
});

test('separate gateway video, production and raw POST runners refuse before capability fetch or submit', async () => {
    const video = require('../lib/gridlight-video');
    let calls = 0;
    const opts = { fetch: async () => { calls++; throw new Error('Outbound forbidden'); } };
    for (const run of [() => video.generateVideo({ prompt: 'approved' }, opts), () => video.generateProduction({ shots: [{ prompt: 'approved' }] }, opts), () => video.postAndStream('/video', { prompt: 'approved' }, opts)]) {
        const result = await run();
        assert.equal(result.status, 428);
        assert.equal(result.code, 'FINAL_REQUEST_REVIEW_REQUIRED');
    }
    assert.equal(calls, 0);
});
