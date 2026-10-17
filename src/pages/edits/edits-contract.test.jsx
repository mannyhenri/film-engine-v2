/*
 * The backend's edits.test.js sub-test "the page: an Edit page in Post …" reads `function loadEditsPage(` and friends
 * out of the page script. The Edit page is React now, so that sub-test is skipped (SKIPPED-SUBTESTS.json) and its
 * guarantee is held HERE: the nav item, the page and its loader. The Edit page's own behaviour (chunked import with
 * X-Upload-Offset, the cut, re-match, delete) is in EditsPage.test.jsx. Its score half went with the Score workstation
 * (tools/split-lib.js RETIRED).
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
// The upload piece size moved from core into the page's engine; tiny here, so a test file travels in several pieces.
vi.mock('./engine.js', () => ({ EDIT_CHUNK: 4 }));

const ROOT = path.resolve(__dirname, '../../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the Edit page (the backend page sub-test, moved)', () => {
    it('the Edit page is in the nav, and is a React page with its loader', () => {
        expect(read('src/components/Sidebar/sidebar.html')).toMatch(/data-page="edits" onclick="navigateTo\('edits'\)"/);
        expect(JSON.parse(read('src/pages/edits/react.json')).loader).toBe('loadEditsPage');
        expect(read('src/pages/edits/EditsPage.jsx')).toMatch(/usePageLoader\('loadEditsPage', loadEditsPage\)/);
        expect(read('src/pages/edits/EditsPage.jsx')).toMatch(/'X-Upload-Offset': String\(at\)/);
    });
});
