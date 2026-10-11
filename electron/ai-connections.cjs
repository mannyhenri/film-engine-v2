/** Desktop lease for Film's provider supervisor. It never stops a reused backend. */
const http = require('http');
const crypto = require('crypto');
function createDesktopAILease({getApiBase, getCapability = () => '', disabled = false, request = null, heartbeatMs = 25000} = {}) {
    const owner = crypto.randomUUID();
    let timer = null, pending = null, stopped = true;
    async function call(action) {
        const headers = {'Content-Type': 'application/json', 'X-Film-AI-Capability': getCapability()};
        if (request) return request(action, {owner}, {headers});
        const url = new URL('/film/ai-connections/' + action, getApiBase());
        const body = JSON.stringify({owner});
        return new Promise((resolve, reject) => {
            const req = http.request(url, {method: 'POST', headers: {...headers, 'Content-Length': Buffer.byteLength(body)}}, res => {
                let value = '';
                res.on('data', chunk => {value += chunk; if (value.length > 50000) req.destroy(Error('Film connection response was too large.'));});
                res.on('end', () => {try {const data = JSON.parse(value); if (res.statusCode !== 200 || data.application !== 'film-engine-v2') throw Error(data.error || 'Updated Film AI connections are unavailable.'); resolve(data);} catch (e) {reject(e);}});
            });
            req.setTimeout(30000, () => req.destroy(Error('Film AI connection setup timed out.')));
            req.on('error', reject); req.end(body);
        });
    }
    async function heartbeat() {
        if (stopped || pending) return;
        pending = call('attach');
        try {return await pending;} finally {pending = null;}
    }
    return {
        async start() {
            if (disabled) return;
            stopped = false;
            if (!stopped && !timer) {timer = setInterval(() => heartbeat().catch(e => console.warn('[Film AI]', e.message)), heartbeatMs); timer.unref?.();}
            return await heartbeat();
        },
        async stop() {
            if (disabled || stopped) return;
            stopped = true; clearInterval(timer); timer = null;
            try {await pending;} catch {}
            await call('detach');
        },
    };
}
module.exports = {createDesktopAILease};
