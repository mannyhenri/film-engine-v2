/*
 * The delivery pages reach every field their routes accept: the guarantee of the backend's
 * page-handlers sub-test of the same name, kept for pages that are now React.
 *
 * That sub-test reads `async function saveCredit` (and friends) out of the page's script; a React
 * page has no such function, so it is skipped in SKIPPED-SUBTESTS.json and checked HERE instead,
 * more strongly: the field set is derived from the route exactly as the backend test derives it,
 * and each React form is actually SAVED, so the request body is read rather than the source.
 * A page that is still legacy is held to the backend test's own rule against its chunk, so a page
 * is covered on whichever side of the conversion it stands.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';

const ROOT = path.resolve(__dirname, '../..');
const ROUTES = path.join(ROOT, 'backend/routes');
const require_ = createRequire(import.meta.url);

/** The fields a create route accepts: its exported EDITABLE, else every `body.<field>` in the function. */
function routeFields(route, fn) {
    let declared = {};
    try { declared = require_(path.join(ROUTES, route)); } catch { /* a route that needs the database to load: read its source */ }
    if (Array.isArray(declared.EDITABLE)) return declared.EDITABLE.filter(f => f !== 'project_id');
    const src = fs.readFileSync(path.join(ROUTES, route), 'utf8');
    const at = src.indexOf(`function ${fn}`);
    if (at < 0) throw new Error(`${fn} is gone from ${route}`);
    const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
    return [...new Set([...body.matchAll(/body\.([a-z_]+)/g)].map(m => m[1]))].filter(f => f !== 'project_id');
}
const isReact = (page) => fs.existsSync(path.join(ROOT, 'src/pages', page, 'react.json'));

async function savedBody(Page, loader, routes, postKey, fill, saveIndex = 0) {
    let posted;
    installLegacy({ routes: { ...routes, [postKey]: (b) => { posted = b; return { ok: true }; } } });
    render(<Page />);
    await act(async () => { await window[loader](); });
    await fill();
    await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[saveIndex]); });
    return posted;
}
const type = (id, value) => fireEvent.change(document.getElementById(id), { target: { value } });

const TITLES_ROUTES = { 'GET /projects/p1/credits': { sections: ['crew'], credits: [] }, 'GET /projects/p1/title-cards': { card_types: ['card'], title_cards: [] } };
const SURFACES = [
    { page: 'titles', route: 'credits.js', fn: 'createCredit', saver: 'saveCredit',
      body: async () => savedBody((await import('./titles/TitlesPage.jsx')).default, 'loadTitles', TITLES_ROUTES, 'POST /projects/p1/credits',
          async () => { fireEvent.click(screen.getByRole('button', { name: '+ Credit' })); type('creditName', 'Lee'); }, 0) },
    { page: 'titles', route: 'credits.js', fn: 'createTitleCard', saver: 'saveTitleCard',
      body: async () => savedBody((await import('./titles/TitlesPage.jsx')).default, 'loadTitles', TITLES_ROUTES, 'POST /projects/p1/title-cards',
          async () => { fireEvent.click(screen.getByRole('button', { name: '+ Title card' })); type('cardText', 'THE END'); }, 1) },
    { page: 'subtitles', route: 'subtitles.js', fn: 'createSubtitle', saver: 'saveSubtitle',
      body: async () => savedBody((await import('./subtitles/SubtitlesPage.jsx')).default, 'loadSubtitles', {
          'GET /projects/p1/languages': { languages: ['en'] }, 'GET /projects/p1/subtitles?language=en': { subtitles: [] }, 'GET /projects/p1/shotlist': { shots: [] },
      }, 'POST /projects/p1/subtitles', async () => {
          fireEvent.click(screen.getByRole('button', { name: '+ Cue' })); type('subText', 'Hi'); type('subStart', '1'); type('subEnd', '2');
      }) },
    { page: 'rights', route: 'assets.js', fn: 'createRight', saver: 'saveRight',
      body: async () => savedBody((await import('./rights/RightsPage.jsx')).default, 'loadRights', {
          'GET /projects/p1/rights': { rights: [], vocabulary: {} },
      }, 'POST /projects/p1/rights', async () => {
          fireEvent.click(screen.getByRole('button', { name: /\+/ })); type('rightSubject', 'Street');
      }) },
    { page: 'deliverables', route: 'deliverables.js', fn: 'insertRow', saver: 'saveDeliverable' },
];

describe('the delivery pages reach every field their routes accept', () => {
    for (const sf of SURFACES) {
        it(`${sf.page}: ${sf.saver} sends every field ${sf.fn} accepts`, async () => {
            const fields = routeFields(sf.route, sf.fn);
            expect(fields.length, `${sf.fn}: the scan is not reading the route`).toBeGreaterThanOrEqual(5);
            if (isReact(sf.page)) {
                expect(sf.body, `${sf.page} is React: this test must drive its form`).toBeTypeOf('function');
                const body = await sf.body();
                expect(body, `${sf.saver} sent nothing`).toBeTruthy();
                expect(fields.filter(f => !(f in body)), `${sf.saver} never sends these — the route accepts them and nothing on the page can set them`).toEqual([]);
            } else {
                // Still legacy: the backend test's own rule, against the chunk the page loads.
                const chunk = fs.readFileSync(path.join(ROOT, 'public/legacy/chunks', sf.page + '.js'), 'utf8');
                const at = chunk.indexOf(`async function ${sf.saver}`);
                expect(at, `${sf.saver} does not exist`).toBeGreaterThan(-1);
                const saver = chunk.slice(at, chunk.indexOf('\n    async function ', at + 10));
                expect(fields.filter(f => !new RegExp(`${f}\\s*:`).test(saver))).toEqual([]);
            }
        });
    }

    it('the credit and title-card lists serve their vocabularies, so the forms never offer a refused value', () => {
        const credits = fs.readFileSync(path.join(ROUTES, 'credits.js'), 'utf8');
        for (const [fn, key, constant] of [['listCredits', 'sections', 'VALID_SECTIONS'], ['listTitleCards', 'card_types', 'VALID_CARD_TYPES']]) {
            const at = credits.indexOf(`function ${fn}`);
            expect(at).toBeGreaterThan(-1);
            expect(credits.slice(at, credits.indexOf('\nfunction ', at + 10))).toMatch(new RegExp(`${key}:\\s*${constant}`));
        }
    });
});
