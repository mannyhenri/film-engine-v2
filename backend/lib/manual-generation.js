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

/*
 * The dormant send path keeps its own tests (exact bytes, single charge,
 * recovery). Only a node:test file can reopen it, for its own process.
 */
let sendPathUnderTest = false;
function allowSendForTests() {
    const main = require.main && require.main.filename || '';
    if (!process.env.NODE_TEST_CONTEXT && !/\.test\.js$/.test(main)) throw new Error('The manual-generation gate can only be lifted by a test file');
    sendPathUnderTest = true;
}

function isManual(provider, capability) {
    if (sendPathUnderTest) return false;
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

module.exports = { MANUAL_PROVIDERS, isManual, allowSendForTests, manualError, assertSendable };
