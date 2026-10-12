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
 * generation, but only while it recorded no output (a job that produced anything
 * keeps its row) and only when the marker names a review for a manual vendor (a
 * kept provider's job, Gridlight included, is never touched). Installed on every
 * job table, so a new one is covered too.
 */
function installReviewStopCleanup(db) {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%job%'").all().map(r => r.name);
    const manualList = [...MANUAL_PROVIDERS].map(id => `'${id}'`).join(', ');
    // The review table must exist for the trigger to name it.
    db.exec(require('fs').readFileSync(require('path').join(__dirname, '../db/migrations/141_final_request_reviews.sql'), 'utf8'));
    for (const table of tables) {
        const cols = db.prepare(`PRAGMA table_info("${table}")`).all().map(c => c.name);
        const column = ['error_message', 'error'].find(c => cols.includes(c));
        if (!column) continue;
        // A row that recorded any output is history and stays, whatever its error says.
        const outputs = ['output_path', 'result_path', 'result_json', 'result', 'asset_id', 'output_asset_id', 'file_path', 'request_id', 'provider_job_id']
            .filter(c => cols.includes(c)).map(c => ` AND (NEW."${c}" IS NULL OR NEW."${c}" = '')`).join('');
        for (const when of ['INSERT', 'UPDATE']) {
            db.exec(`DROP TRIGGER IF EXISTS "${table}_review_stop_${when.toLowerCase()}"`);
            // Only when the marker names a review for a manual vendor: a kept
            // provider's job (Gridlight, local tools) is never touched.
            db.exec(`CREATE TRIGGER "${table}_review_stop_${when.toLowerCase()}" AFTER ${when} ON "${table}"
                WHEN NEW."${column}" LIKE 'FINAL_REQUEST_REVIEW_REQUIRED:%'${outputs}
                AND EXISTS (SELECT 1 FROM film_final_request_reviews r
                    WHERE r.id = substr(NEW."${column}", instr(NEW."${column}", ':') + 1)
                    AND json_extract(r.snapshot_json, '$.provider') IN (${manualList})
                    AND COALESCE(json_extract(r.snapshot_json, '$.capability'), '') <> 'llm')
                BEGIN DELETE FROM "${table}" WHERE rowid = NEW.rowid; END`);
        }
    }
    return tables.length;
}

module.exports = { MANUAL_PROVIDERS, isManual, manualError, assertSendable, installReviewStopCleanup };
