/**
 * What pressing Generate will cost, worked out locally and before anything runs.
 *
 * Deliberately NOT a call to a provider's estimate endpoint. A local estimate
 * works before you have signed in, works when the network does not, and cannot
 * itself fail in a way that blocks the check it exists to provide.
 *
 * Priced from Higgsfield's own credit quotes for each app model (one quote per
 * resolution and sound setting, kept in providers/higgsfield-app-models.json),
 * which is the only video vendor Film Engine generates with since Runway was
 * removed (2026-10-24). Resolution changes the rate, and by a lot — Seedance
 * 2.5 is 3 credits a second at 480p and 16 at 1080p — so the tier the frame
 * lands on is part of every estimate.
 *
 * A model with no quote says so rather than pricing at zero.
 */
const catalog = require('./higgsfield-app-catalog');

const USD_PER_CREDIT = catalog.SNAPSHOT.credit_usd.usd_per_credit;

/** The tier a delivered frame lands on: the smallest the model offers that covers the frame's short edge. */
function tierForFrame(model, frame) {
    const m = catalog.MODELS[String(model || '').trim()];
    if (!m || !m.resolution) return null;
    const f = /^(\d+)\s*[x:]\s*(\d+)$/i.exec(String(frame || ''));
    if (!f) return null;
    const short = Math.min(Number(f[1]), Number(f[2]));
    const edge = label => {
        const k = /^(\d+)\s*k$/i.exec(label);
        if (k) return { 1: 1080, 2: 1440, 4: 2160 }[Number(k[1])] || 0;
        const p = /^(\d+)\s*p$/i.exec(label);
        return p ? Number(p[1]) : 0;
    };
    const tiers = Object.keys(m.resolution.values).map(l => ({ l, e: edge(l) })).sort((a, b) => a.e - b.e);
    const fit = tiers.find(t => t.e >= short);
    return (fit || tiers[tiers.length - 1]).l;
}

/** The per-second credits a model is quoted at, at a resolution (its default when none is given). */
function ratesFor(model, resolution) {
    const m = catalog.MODELS[String(model || '').trim()];
    if (!m) return null;
    const price = catalog.priceFor(model, { duration_s: 10, resolution: resolution || undefined });
    return { model: m, resolution: (price && price.resolution) || null,
        creditsPerSecond: price && price.per_second !== null ? price.per_second : null };
}

function estimateVideoCost(opts) {
    const o = opts || {};
    const m = catalog.MODELS[String(o.model || '').trim()];
    if (!m) {
        return { model: o.model || null, credits: 0, usd: 0, lines: [],
            unknownModel: true,
            note: `no Higgsfield quote for "${o.model}" — it is not a model in the Higgsfield app catalogue` };
    }
    const seconds = Number(o.durationSeconds) > 0 ? Number(o.durationSeconds) : 0;
    const resolution = o.resolution || tierForFrame(o.model, o.frame) || undefined;
    const price = catalog.priceFor(o.model, { duration_s: seconds || 5, resolution, audio: o.audio });
    if (!price || price.credits === null) {
        return { model: o.model, credits: 0, usd: 0, lines: [], unknownModel: false, unpriced: true,
            note: (price && price.note) || `no Higgsfield quote for ${o.model} at this setting` };
    }
    const credits = price.credits;
    return {
        model: o.model,
        resolution: price.resolution,
        durationSeconds: price.billed_seconds,
        credits,
        usd: Math.round(credits * USD_PER_CREDIT * 100) / 100,
        usdPerCredit: USD_PER_CREDIT,
        minimumApplied: price.billed_seconds > seconds,
        exact: price.exact,
        lines: [{ label: `${price.billed_seconds}s of video`, credits, usd: Math.round(credits * USD_PER_CREDIT * 100) / 100,
            detail: (price.per_second !== null ? `${price.per_second} credits/second` : 'credits per clip') + (price.resolution ? ` at ${price.resolution}` : '') }],
        note: price.note,
        source: 'https://higgsfield.ai/pricing',
    };
}

function compareVideoModels(opts) {
    return Object.keys(catalog.MODELS)
        .map(model => estimateVideoCost({ ...(opts || {}), model }))
        .filter(e => !e.unpriced)
        .sort((a, b) => a.credits - b.credits);
}

module.exports = { tierForFrame, estimateVideoCost, compareVideoModels, ratesFor, USD_PER_CREDIT };
