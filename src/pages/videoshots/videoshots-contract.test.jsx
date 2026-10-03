/*
 * Two backend sub-tests read Video Shots' legacy SHAPE, which the React page does not have:
 *   background-replace.test.js "the page offers it on the shot, gated, and shows the control working"
 *     (an onclick="replaceBackground(" on the card) and
 *   background-replace.test.js "the button is only offered where there is footage to edit"
 *     (the legacy `const proActions` block).
 * Both are skipped (SKIPPED-SUBTESTS.json) and EVERY assertion is held here: replaceBackground itself is
 * still core, so its body is read from the reassembled page exactly as the backend reads it; the card's
 * control and its gate are behaviour of the React page.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, fireEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import VideoShotsPage from './VideoShotsPage.jsx';

const ROOT = path.resolve(__dirname, '../../..');
function coreBody(name) {
    const UI = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
    const at = UI.indexOf(`async function ${name}(`);
    expect(at, `${name} is not defined, so the button calls nothing`).toBeGreaterThan(-1);
    let i = UI.indexOf('{', at), depth = 0, end = -1;
    for (let j = i; j < UI.length; j++) { if (UI[j] === '{') depth++; else if (UI[j] === '}') { depth--; if (!depth) { end = j + 1; break; } } }
    return UI.slice(at, end);
}
const ROUTES = (assets) => ({
    'GET /projects/p1/shotlist': { shots: [{ id: 'a', shot_code: '1A', scene_number: 1 }, { id: 'b', shot_code: '1B', scene_number: 1 }] },
    'GET /projects/p1/video': { jobs: [], assets }, 'GET /projects/p1/providers': { effective: {} },
});

describe('background replace on the Video Shots card (the backend page sub-tests, moved)', () => {
    it('core’s replaceBackground goes through the shared confirmation, priced from its own preview, then posts the generate route', () => {
        const body = coreBody('replaceBackground');
        expect(body).toMatch(/confirmPaidImage\s*\(/);
        expect(body).toMatch(/background\/preview/);
        expect(body).toMatch(/background\/generate/);
    });

    it('the card’s Background… reaches core with the shot, and is offered only where there is footage', async () => {
        const { fake } = installLegacy({ routes: ROUTES([{ shot_id: 'b', asset_type: 'video_raw', url: '/film/video/p1/1B.mp4' }]) });
        render(<VideoShotsPage />);
        await act(async () => { await window.loadVideoShots(); });
        const a = document.querySelector('[data-shot-id="a"]'), b = document.querySelector('[data-shot-id="b"]');
        expect(within(a).queryByText('Background…')).toBeNull();          // no clip: not offered
        const button = within(b).getByText('Background…');
        fireEvent.click(button);
        expect(fake.replaceBackground).toHaveBeenCalledWith('b', button);
    });
});
