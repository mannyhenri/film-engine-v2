/*
 * The backend's edits.test.js sub-test "the page: an Edit page in Post, the score monitor follows the
 * playhead, and a session can be opened on an edit" reads `function loadEditsPage(` and friends out of
 * the page script. The Edit page is React now, so that sub-test is skipped (SKIPPED-SUBTESTS.json) and
 * every one of its guarantees is held HERE: the nav item, and the music workstation's half, which is
 * still legacy (public/legacy/chunks/music.js). The Edit page's own half (the loader, chunked import with
 * X-Upload-Offset, the cut, re-match, delete, Score this edit) is behaviour in EditsPage.test.jsx.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const music = read('public/legacy/chunks/music.js');
const body = (fn) => {
    const at = music.indexOf(`function ${fn}(`);
    expect(at, `${fn} is not defined`).toBeGreaterThan(-1);
    return music.slice(at, music.indexOf('\n    }\n', at));
};

describe('the Edit page and the score that follows it (the backend page sub-test, moved)', () => {
    it('the Edit page is in the nav, and is a React page with its loader', () => {
        expect(read('src/components/Sidebar/sidebar.html')).toMatch(/data-page="edits" onclick="navigateTo\('edits'\)"/);
        expect(JSON.parse(read('src/pages/edits/react.json')).loader).toBe('loadEditsPage');
        expect(read('src/pages/edits/EditsPage.jsx')).toMatch(/usePageLoader\('loadEditsPage', loadEditsPage\)/);
        expect(read('src/pages/edits/EditsPage.jsx')).toMatch(/'X-Upload-Offset': String\(at\)/);
    });

    it('the score monitor follows the playhead, and a session can be put on an edit', () => {
        for (const fn of ['mwPictureHtml', 'mwPictureFollow', 'mwMoveToEdit']) body(fn);
        expect(body('mwPlay')).toMatch(/mwPictureFollow\(true\)/);
        expect(body('mwPause')).toMatch(/mwPictureFollow\(false\)/);
        expect(body('mwCreateSession')).toMatch(/\/edits'/);
        expect(body('mwCreateSessionSubmit')).toMatch(/body\.edit_id = id/);
        expect(body('mwDriftHtml')).toMatch(/newer_edit/);
    });
});
