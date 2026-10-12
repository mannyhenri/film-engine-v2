'use strict';
/*
 * MANUAL GENERATION. Film Engine prepares the exact prompt and gathers the
 * assets; the user generates on the vendor's own app (whose plans include
 * free generations the APIs do not). Nothing creative is sent to these vendors.
 *
 * Every road is closed separately — review approval, approval tokens already
 * stored, the creative transport and media uploads — because routes, MCP tools
 * and batch runners reach the adapters directly as well as through the registry.
 * Previews still run in full, so the final review shows exactly what would
 * have been sent.
 *
 * Kept: the Gridlight gateway, local tools (FluidSynth, ffmpeg, Blender) and
 * LLM text. OpenAI is manual for images only.
 */
const MANUAL_PROVIDERS = new Set([
    'muapi', 'muapi-upscale', 'seedance', 'higgsfield', 'runway', 'meshy',
    'elevenlabs', 'worldlabs', 'google', 'openai', 'magnific', 'topaz',
]);

function isManual(provider, capability) {
    if (capability === 'llm') return false;
    return MANUAL_PROVIDERS.has(String(provider || ''));
}

function manualError(provider) {
    const e = new Error(`Manual generation only: copy the prompt and assets from the final review into ${provider || 'the generator'}'s own app. Film Engine does not send this request.`);
    e.status = 409;
    e.code = 'MANUAL_GENERATION_ONLY';
    return e;
}

function assertSendable(provider, capability) {
    if (isManual(provider, capability)) throw manualError(provider);
}

/*
 * A route that opens a job row before calling the provider marks it failed when
 * the provider answers "review required". For a manual vendor that answer is the
 * hand-over, not a failure, so the row is removed rather than left as a failed
 * generation. Installed on every job table, so a new one is covered too.
 */
function installReviewStopCleanup(db) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%job%'").all().map(r => r.name);
    for (const table of tables) {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
        const column = ['error_message', 'error'].find(c => cols.includes(c));
        if (!column) continue;
        for (const when of ['INSERT', 'UPDATE']) {
            db.exec(`CREATE TRIGGER IF NOT EXISTS "${table}_review_stop_${when.toLowerCase()}" AFTER ${when} ON "${table}"
                WHEN NEW."${column}" LIKE 'FINAL_REQUEST_REVIEW_REQUIRED:%'
                BEGIN DELETE FROM "${table}" WHERE rowid = NEW.rowid; END`);
        }
    }
    return tables.length;
}

module.exports = { MANUAL_PROVIDERS, isManual, manualError, assertSendable, installReviewStopCleanup };
