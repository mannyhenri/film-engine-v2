const test = require('node:test');
const assert = require('node:assert/strict');
const gateway = require('../lib/gridlight-client');



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

