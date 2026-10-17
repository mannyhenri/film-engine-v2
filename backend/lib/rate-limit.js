/**
 * RATE LIMITING, sliding window per client.
 *
 * Two buckets: 'generation' (routes that spend GPU or provider money) and 'general' (everything else).
 * The desktop app talks to this backend over loopback, so a general limit meant for outside callers only ever
 * throttled the app itself: a few window focuses on Production (each re-reads the graph and every asset's
 * provenance) used up 200 a minute, and then every screen and every save was refused for up to a minute.
 * Loopback is therefore never limited on general requests. Generation stays limited for everyone.
 *
 * Loopback is decided by the SOCKET's address only. X-Forwarded-For is a header anyone can send; it still keys
 * the bucket (as before) but can never exempt a caller.
 */
function isLoopback(addr) {
    const a = String(addr || '').trim().toLowerCase();
    return a === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a) || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

function createRateLimiter({ windowMs = 60000, maxGeneral = 200, maxGeneration = 10 } = {}) {
    const buckets = {};  // client → { general: [timestamps], generation: [timestamps] }
    const prune = (arr, now) => { const cutoff = now - windowMs; while (arr.length && arr[0] <= cutoff) arr.shift(); };
    /** True when the request may go ahead (and is counted), false when it is over the limit. */
    function allow({ remoteAddress, forwardedFor, bucket = 'general', now = Date.now() }) {
        if (bucket !== 'generation' && isLoopback(remoteAddress)) return true;
        const key = String(forwardedFor || '').split(',')[0].trim() || remoteAddress || 'unknown';
        const b = buckets[key] || (buckets[key] = { general: [], generation: [] });
        const arr = b[bucket === 'generation' ? 'generation' : 'general'];
        prune(arr, now);
        if (arr.length >= (bucket === 'generation' ? maxGeneration : maxGeneral)) return false;
        arr.push(now);
        return true;
    }
    /** Drops clients with nothing in the window (called on a timer). */
    function sweep(now = Date.now()) {
        for (const k of Object.keys(buckets)) {
            prune(buckets[k].general, now); prune(buckets[k].generation, now);
            if (!buckets[k].general.length && !buckets[k].generation.length) delete buckets[k];
        }
    }
    return { allow, sweep };
}

module.exports = { createRateLimiter, isLoopback };
