import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import { installLegacy } from '../../test/setup.js';
import PlaybackPage, { ENGINE } from './PlaybackPage.jsx';
import * as P from './player.js';

/*
 * The legacy page's own markup, from the reference the split is generated from: the set of ids the engine
 * writes into and the set of inline handlers it was driven by. Derived, so the React page cannot quietly
 * drop one.
 */
const REF = fs.readFileSync(path.resolve(__dirname, '../../../reference/fb8c770/src/index.html'), 'utf8');
const LEGACY = (() => {
    const start = REF.indexOf('<div class="page" id="page-playback">');
    const end = REF.indexOf('<div class="page" id="page-', start + 10);
    return REF.slice(start, end);
})();
const LEGACY_IDS = [...LEGACY.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const LEGACY_HANDLERS = [...new Set([...LEGACY.matchAll(/\bon[a-z]+="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];
// Every function the engine itself names in the HTML it renders (playlist rows, notes, markers).
const ENGINE_SRC = fs.readFileSync(path.resolve(__dirname, 'player.js'), 'utf8');
const RENDERED_HANDLERS = [...new Set([...ENGINE_SRC.matchAll(/\bon[a-z]+="([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]))];

const TIMELINE = {
    entries: [
        { index: 0, shot_id: 's1', shot_code: '1A', kind: 'missing', missing: true, start_ms: 0, duration_ms: 4000, start_timecode: '00:00:00:00' },
        { index: 1, shot_id: 's2', shot_code: '1B <b>', kind: 'missing', missing: true, start_ms: 4000, duration_ms: 4000, start_timecode: '00:00:04:00' },
    ],
    playable_count: 0, shot_count: 2, total_timecode: '00:00:08:00', total_duration_ms: 8000, fps: 24, aspect: 16 / 9, beds: [],
};
const ROUTES = {
    'GET /projects/p1/deliverables': { deliverables: [] },
    'GET /projects/p1/timeline': TIMELINE,
    'GET /projects/p1/timeline/notes': { notes: [{ absolute_ms: 1000, absolute_timecode: '00:00:01:00', shot_code: '1A', note_type: 'camera', content: 'too <dark>' }] },
};
const byId = (id) => document.getElementById(id);

beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    legacy.fake.refreshProtectOptions = vi.fn();
    Object.assign(window, { refreshProtectOptions: legacy.fake.refreshProtectOptions });
    legacy.fake.pb.timeline = null; legacy.fake.pb.notes = []; legacy.fake.pb.index = 0; legacy.fake.pb.playing = false;
    const view = render(<PlaybackPage />);
    await act(async () => { await window.loadPlayback(); });
    return { legacy, view };
}

describe('Playback: the page keeps everything the engine drives', () => {
    it('the reference markup was read (this check runs over something)', () => {
        expect(LEGACY_IDS.length).toBeGreaterThan(25);
        expect(LEGACY_HANDLERS.length).toBeGreaterThan(10);
        expect(RENDERED_HANDLERS.length).toBeGreaterThan(1);
    });
    it('renders every id the legacy page had, once', async () => {
        await openPage();
        for (const id of LEGACY_IDS) expect(document.querySelectorAll(`[id="${id}"]`).length, id).toBe(1);
    });
    it('every handler the legacy markup and the engine HTML call is an engine function on window while mounted, and gone after', async () => {
        const { view } = await openPage();
        const engine = new Set(ENGINE.map(([n]) => n));
        for (const name of [...LEGACY_HANDLERS, ...RENDERED_HANDLERS]) {
            expect(engine.has(name), `${name} is not an engine function`).toBe(true);
            expect(window[name], name).toBe(P[name]);
        }
        view.unmount();
        for (const name of RENDERED_HANDLERS) expect(window[name], name).toBeUndefined();
    });
});

describe('Playback: it plays the cut', () => {
    it('loads the timeline: summary, playlist, notes, all escaped', async () => {
        await openPage();
        expect(byId('playbackSummary').textContent).toBe('0 of 2 shots playable · 00:00:08:00 total · 1 timecoded note');
        expect(byId('playbackMain').classList.contains('hidden')).toBe(false);
        expect(byId('playbackEmpty').classList.contains('hidden')).toBe(true);
        expect(byId('pbTotalTimecode').textContent).toBe('00:00:08:00');
        const rows = byId('pbPlaylist').querySelectorAll('.pb-playlist-item');
        expect(rows.length).toBe(2);
        expect(rows[1].textContent).toContain('1B <b>');
        expect(byId('pbNoteList').textContent).toContain('too <dark>');
    });
    it('an empty project shows the empty state', async () => {
        await openPage({ 'GET /projects/p1/timeline': { ...TIMELINE, entries: [] } });
        expect(byId('playbackEmpty').classList.contains('hidden')).toBe(false);
        expect(byId('playbackSummary').textContent).toBe('No shots in this project yet.');
    });
    it('the transport buttons drive the engine: next shot, play / pause', async () => {
        await openPage();
        fireEvent.click(document.querySelector('[title="Next shot"]'));
        expect(window.pb.index).toBe(1);
        fireEvent.click(byId('pbPlayBtn'));
        expect(byId('pbPlayBtn').textContent).toBe('Pause');
        fireEvent.click(byId('pbPlayBtn'));
        expect(byId('pbPlayBtn').textContent).toBe('Play');
    });
    it('Space plays only while the page is mounted', async () => {
        const { view } = await openPage();
        fireEvent.keyDown(window, { key: ' ' });
        expect(byId('pbPlayBtn').textContent).toBe('Pause');
        fireEvent.keyDown(window, { key: ' ' });
        view.unmount();
        const before = window.pb.playing;
        fireEvent.keyDown(window, { key: ' ' });
        expect(window.pb.playing).toBe(before);
    });
    it('a note is pinned to the shot on screen, with its type and text', async () => {
        const { legacy } = await openPage({ 'POST /shots/s1/notes': { ok: true } });
        fireEvent.change(byId('pbNoteType'), { target: { value: 'vfx' } });
        fireEvent.change(byId('pbNoteText'), { target: { value: 'flicker on the lamp' } });
        await act(async () => { fireEvent.click(document.querySelector('.pb-note-box .btn-primary')); });
        const post = legacy.calls.find(c => c.method === 'POST');
        expect(post.path).toBe('/shots/s1/notes');
        expect(post.body).toMatchObject({ content: 'flicker on the lamp', note_type: 'vfx' });
    });
});

describe('Playback: Redo dialogue spends only through the shared confirmation, and forces a new take', () => {
    // Held here from backend director-controls A5 (skipped there: it read onclick text out of the page).
    it('goes through confirmPaidImage; the send buys every shot of the scene with regenerate: true', async () => {
        const scened = { ...TIMELINE, entries: TIMELINE.entries.map(e => ({ ...e, scene_id: 'sc1' })) };
        const { legacy } = await openPage({
            'GET /projects/p1/timeline': scened,
            'POST /shots/s1/voice/generate': { ok: true }, 'POST /shots/s2/voice/generate': { ok: true },
        });
        legacy.fake.confirmPaidImage = vi.fn();
        window.confirmPaidImage = legacy.fake.confirmPaidImage;
        fireEvent.click(document.querySelector('.btn-warning'));
        expect(legacy.fake.confirmPaidImage).toHaveBeenCalledTimes(1);
        expect(legacy.calls.some(c => c.method === 'POST'), 'it spent before the confirmation').toBe(false);
        const opts = legacy.fake.confirmPaidImage.mock.calls[0][0];
        expect(opts).toMatchObject({ capability: 'voice', previewUrl: '/shots/s1/voice/preview' });
        expect(opts.note).toMatch(/NEW take/);
        await act(async () => { await opts.send({ voice_model: 'm' }); });
        const posts = legacy.calls.filter(c => c.method === 'POST');
        expect(posts.map(c => c.path)).toEqual(['/shots/s1/voice/generate', '/shots/s2/voice/generate']);
        for (const p of posts) expect(p.body).toEqual({ voice_model: 'm', regenerate: true });
    });
});
