/**
 * Gridlight API Client
 *
 * Shared HTTP client for calling external generation endpoints
 * (image, video, music, voice, lipsync, postprocess, 3d) at the
 * Gridlight platform. All Film Engine generation routes use this.
 */

const GRIDLIGHT_URL = process.env.GRIDLIGHT_URL || process.env.GATEWAY_URL || 'http://localhost:8080';
const GRIDLIGHT_API_KEY = process.env.GRIDLIGHT_API_KEY || process.env.IMAGEGEN_API_KEY || 'dev-token';

if (!GRIDLIGHT_API_KEY) {
    console.warn('[security] GRIDLIGHT_API_KEY not set. External API calls will be sent without authentication.');
}

// ── Request Queue / Semaphore (FILM-034) ────────────────────────────
// Limits concurrent requests to external services to avoid overwhelming
// GPU workers. Each endpoint gets its own concurrency slot.

const MAX_CONCURRENT = parseInt(process.env.GRIDLIGHT_MAX_CONCURRENT || '2', 10);
const MAX_QUEUE_SIZE = parseInt(process.env.GRIDLIGHT_MAX_QUEUE || '50', 10);
const RETRY_ON_429_DELAY = parseInt(process.env.GRIDLIGHT_429_RETRY_MS || '5000', 10);
const MAX_429_RETRIES = parseInt(process.env.GRIDLIGHT_429_MAX_RETRIES || '3', 10);

// Gridlight 3D generation endpoints (dev branch: feature/3d-generation).
// Centralized here because the 3D family has more members than other domains.
const THREED_ENDPOINTS = {
    generate: '/3d/generate',
    fromImage: '/3d/from-image',
    batch: '/3d/batch',
    job: (jobId) => `/3d/job/${jobId}`,
    jobStream: (jobId) => `/3d/job/${jobId}/stream`,
    assets: '/3d/assets',
    asset: (assetId) => `/3d/assets/${assetId}`,
    rig: '/3d/rig',
    retexture: '/3d/retexture',
    animate: '/3d/animate',
    animations: '/3d/animations',
    queue: '/3d/queue',
};

// Per-endpoint semaphore state
const _queues = {};          // endpoint → { active: number, waiting: Array<{resolve, reject}> }

function _getQueue(endpoint) {
    if (!_queues[endpoint]) {
        _queues[endpoint] = { active: 0, waiting: [] };
    }
    return _queues[endpoint];
}

/**
 * Acquire a concurrency slot for an endpoint.
 * If all slots are busy, the caller is queued and receives its position.
 * Rejects immediately if the queue is full.
 *
 * @param {string} endpoint
 * @returns {Promise<{ position: number }>} - position 0 = running immediately
 */
function _acquireSlot(endpoint) {
    const q = _getQueue(endpoint);
    if (q.active < MAX_CONCURRENT) {
        q.active++;
        return Promise.resolve({ position: 0 });
    }
    if (q.waiting.length >= MAX_QUEUE_SIZE) {
        return Promise.reject(new Error('queue_full'));
    }
    return new Promise((resolve, reject) => {
        const position = q.waiting.length + 1;
        q.waiting.push({ resolve: () => { q.active++; resolve({ position }); }, reject });
    });
}

/**
 * Release a concurrency slot for an endpoint.
 * If callers are queued, the next one is admitted.
 */
function _releaseSlot(endpoint) {
    const q = _getQueue(endpoint);
    q.active = Math.max(0, q.active - 1);
    if (q.waiting.length > 0) {
        const next = q.waiting.shift();
        next.resolve();
    }
}

/**
 * Get queue status for all endpoints.
 * @returns {object} Map of endpoint → { active, queued, max_concurrent }
 */
function getQueueStatus() {
    const status = {};
    for (const [ep, q] of Object.entries(_queues)) {
        status[ep] = { active: q.active, queued: q.waiting.length, max_concurrent: MAX_CONCURRENT };
    }
    return status;
}

/**
 * Sleep helper for 429 retry backoff.
 */
function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function finalReviewRequired(endpoint) {
    return { ok: false, status: 428, data: null, contentType: null, code: 'FINAL_REQUEST_REVIEW_REQUIRED', error: `Final editable request review is unavailable for legacy Gridlight ${endpoint}. Nothing was submitted.` };
}

/**
 * Call a Gridlight endpoint (non-streaming).
 * Returns the response as a Buffer (for binary like images/video/audio)
 * or parsed JSON depending on content type.
 *
 * @param {string} endpoint - e.g. '/image', '/video', '/music'
 * @param {object} payload - Request body
 * @param {object} [options]
 * @param {number} [options.timeout=300000] - Timeout in ms (default 5 min)
 * @returns {Promise<{ ok: boolean, status: number, data: Buffer|object, contentType: string, error?: string }>}
 */
async function callGridlight(endpoint, payload, options) {
    // Legacy gateway submissions have no immutable adapter-resolved review.
    // Reject before queue acquisition or network; a caller-supplied flag is not consent.
    return finalReviewRequired(endpoint);
}

/** Streaming legacy generation is also blocked before opening a connection. */
async function relayGridlightSSE(endpoint, payload, res, callbacks) {
    const refusal = finalReviewRequired(endpoint);
    if (callbacks && callbacks.onError) callbacks.onError({ error: refusal.error });
    return { ...refusal, finalData: null };
}

/**
 * Check if a Gridlight endpoint is available.
 *
 * @param {string} endpoint - e.g. '/image', '/video'
 * @returns {Promise<{ available: boolean, latency_ms: number, error?: string }>}
 */
async function checkEndpointHealth(endpoint) {
    const url = `${GRIDLIGHT_URL}${endpoint}`;
    const start = Date.now();

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
        });

        clearTimeout(timer);
        return {
            available: response.status < 500,
            latency_ms: Date.now() - start,
        };
    } catch (err) {
        return {
            available: false,
            latency_ms: Date.now() - start,
            error: err.message,
        };
    }
}

/**
 * Build a service unavailable error response.
 */
function serviceUnavailableError(endpoint, serviceName) {
    return {
        error: 'service_unavailable',
        service: serviceName || endpoint.replace('/', ''),
        endpoint: `${GRIDLIGHT_URL}${endpoint}`,
        hint: `The ${serviceName || endpoint} service is not running. Start it at ${GRIDLIGHT_URL} or set GRIDLIGHT_URL env var.`,
    };
}

module.exports = {
    callGridlight,
    relayGridlightSSE,
    checkEndpointHealth,
    serviceUnavailableError,
    getQueueStatus,
    GRIDLIGHT_URL,
    GRIDLIGHT_API_KEY,
    MAX_CONCURRENT,
    MAX_QUEUE_SIZE,
    THREED_ENDPOINTS,
};
