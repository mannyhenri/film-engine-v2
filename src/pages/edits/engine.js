/*
 * The Edits engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. What only the Edits page uses of the legacy core: the size of one piece of a resumable upload (moved, measured by tools/core-ownership.js). The page reads it as E.EDIT_CHUNK.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';

    /*
     * Sent in pieces, and resumed rather than restarted. An edit exported at
     * ProRes is gigabytes; one request that dies at 90% on a flaky connection
     * is a transfer that never finishes. The server says how much it holds,
     * and only that number is trusted.
     */
    const EDIT_CHUNK = 8 * 1024 * 1024;

export {
    EDIT_CHUNK,
};
