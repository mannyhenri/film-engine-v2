import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ShotBoardPage, { COLUMNS, cardFacts } from './ShotBoardPage.jsx';

const shot = (i, status, extra = {}) => ({ id: 's' + i, shot_code: `${i}A`, scene_number: i, status, location: 'DINER', duration_ms: 4000, transition_in_type: 'cut', ...extra });
const SHOTS = [shot(1, 'pending'), shot(2, 'complete', { transition_in_type: 'dissolve' }), shot(3, 'failed'), shot(4, 'approved'), shot(5, 'weird')];
const list = (rows, total = rows.length) => ({ shots: rows, total });
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: {
        'GET /projects/p1/deliverables/check': { target_duration_ms: 0 },
        'GET /projects/p1/shotlist?limit=200&page=1': list(SHOTS),
        ...routes,
    } });
    render(<ShotBoardPage />);
    await act(async () => { await window.loadShotBoard(); });
    return legacy;
}
const column = (status) => document.querySelector(`.kanban-column[data-status="${status}"]`);
const card = (id) => document.querySelector(`.kanban-card[data-shot="${id}"]`);
const dt = () => ({ dataTransfer: { effectAllowed: '', dropEffect: '' } });

describe('Shot Board', () => {
    it('five columns, one per status the database allows; an unknown status files under Pending', async () => {
        const { status } = await openPage();
        expect([...document.querySelectorAll('.kanban-column-header span:first-child')].map(s => s.textContent)).toEqual(COLUMNS.map(c => c[1]));
        expect(column('pending').querySelectorAll('.kanban-card').length).toBe(2); // s1 and the unknown s5
        expect(column('failed').querySelector('.count').textContent).toBe('1');
        expect(column('generating').textContent).toContain('Empty');
        expect(card('s2').textContent).toContain('· dissolve');
        expect(card('s1').querySelector('img').getAttribute('src')).toBe('http://api.test/film/storyboards/p1/1A.png?w=480');
        expect(window.state.shots.length).toBe(5);
        expect(status).toContain('5 shot(s)');
    });

    it('FIX: every page of the shot list is read (the route answers 50 unless asked; the legacy board never asked)', async () => {
        const many = Array.from({ length: 230 }, (_, i) => shot(i + 1, 'pending'));
        const { calls } = await openPage({
            'GET /projects/p1/shotlist?limit=200&page=1': list(many.slice(0, 200), 230),
            'GET /projects/p1/shotlist?limit=200&page=2': list(many.slice(200), 230),
        });
        expect(document.querySelectorAll('.kanban-card').length).toBe(230);
        expect(calls.filter(c => c.path.includes('shotlist')).length).toBe(2);
    });

    it('the runtime against the bought length shows over/under; a film with no target shows nothing', async () => {
        await openPage({ 'GET /projects/p1/deliverables/check': { target_duration_ms: 30000, cut_duration_ms: 32500, on_target: false } });
        expect(document.getElementById('shotboardRuntime').textContent).toBe('32.5s / 30.0s · over by 2.5s');
    });

    it('dragging a card to another column changes its status; dropping on its own column writes nothing', async () => {
        let put;
        const { calls, status } = await openPage({ 'PUT /shots/s1': (b) => { put = b; return {}; } });
        fireEvent.dragStart(card('s1'), dt());
        await act(async () => { fireEvent.drop(column('pending'), dt()); });
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
        fireEvent.dragStart(card('s1'), dt());
        await act(async () => { fireEvent.drop(column('approved'), dt()); });
        expect(put).toEqual({ status: 'approved' });
        expect(status).toContain('1A → approved');
    });

    it('dropping a card on another reorders the WHOLE running order, and is not also a status move', async () => {
        let body;
        const { calls } = await openPage({ 'POST /projects/p1/shots/reorder': (b) => { body = b; return {}; } });
        fireEvent.dragStart(card('s4'), dt());
        await act(async () => { fireEvent.drop(card('s2'), dt()); });
        expect(body).toEqual({ shot_ids: ['s1', 's4', 's2', 's3', 's5'] });
        expect(calls.some(c => c.method === 'PUT')).toBe(false);
    });

    it('FIX: the drawer reads the shot, so camera, lighting, cast and the scene card are shown (the list carries none of them)', async () => {
        await openPage({
            'GET /shots/s2': { card: { camera: { shot_type: 'close-up', lens: '85mm', movement: 'static' }, lighting: { type: 'night', technique: 'rembrandt' }, characters: ['RAY', 'JUNE'] } },
            'GET /shots/s2/notes': { notes: [{ id: 'n1', note_type: 'direction', content: 'hold <longer>', created_at: '2026-10-01' }] },
        });
        await act(async () => { fireEvent.click(card('s2')); });
        const panel = document.getElementById('shotDetailPanel');
        expect(panel.querySelector('img')).toBeTruthy(); // frameBusy finds the frame here
        await waitFor(() => expect(panel.textContent).toContain('close-up · 85mm'));
        expect(panel.textContent).toContain('night · rembrandt');
        expect(panel.textContent).toContain('RAY, JUNE');
        expect(panel.textContent).toContain('Scene Card');
        expect(screen.getByText('hold <longer>')).toBeTruthy();
        expect(cardFacts({})).toEqual({ camera: '-', lighting: '-', characters: '-' });
    });

    it('the drawer saves transitions, adds a direction note, regenerates through core, and runs the pipeline', async () => {
        const writes = [];
        const { fake, status } = await openPage({
            'GET /shots/s1': { card: {} }, 'GET /shots/s1/notes': { notes: [] },
            'PUT /shots/s1/transition': (b) => { writes.push(['transition', b]); return {}; },
            'POST /shots/s1/notes': (b) => { writes.push(['note', b]); return {}; },
            'POST /shots/s1/render': (b) => { writes.push(['render', b]); return {}; },
        });
        fake.regenerateStoryboard = window.regenerateStoryboard;
        await act(async () => { fireEvent.click(card('s1')); });
        await act(async () => { fireEvent.change(document.getElementById('shotTransitionIn'), { target: { value: 'dip-to-black' } }); });
        fireEvent.change(document.getElementById('shotTransitionInMs'), { target: { value: '500' } });
        await act(async () => { fireEvent.blur(document.getElementById('shotTransitionInMs')); });
        expect(writes[0][1]).toEqual({ transition_in_type: 'dip-to-black', transition_in_duration_ms: 0, transition_out_type: 'cut', transition_out_duration_ms: 0 });
        expect(writes[1][1].transition_in_duration_ms).toBe(500);
        fireEvent.change(document.getElementById('shotDetailNoteInput'), { target: { value: ' tighter ' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add Note' })); });
        expect(writes[2]).toEqual(['note', { content: 'tighter', note_type: 'direction' }]);
        fireEvent.click(screen.getByRole('button', { name: 'Regenerate Storyboard' }));
        expect(window.regenerateStoryboard).toHaveBeenCalledWith('s1');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run Pipeline' })); });
        expect(writes[3]).toEqual(['render', { step: 'keyframe' }]);
        expect(status).toContain('Pipeline run started');
        fireEvent.click(document.querySelector('#shotDetailPanel .btn-secondary'));
        expect(document.getElementById('shotDetailPanel')).toBeNull();
    });

    it('A/B compare needs two versions, and says so', async () => {
        const { status } = await openPage({
            'GET /shots/s1': { card: {} }, 'GET /shots/s1/notes': { notes: [] },
            'GET /shots/s1/versions': { versions: [{ version_number: 1, created_at: '2026-10-01' }] },
        });
        await act(async () => { fireEvent.click(card('s1')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'A/B Compare' })); });
        expect(status).toContain('Need at least 2 versions to compare');
    });

    it('A/B compare with two versions: both pictures, the crossfade, and the parameter differences', async () => {
        await openPage({
            'GET /shots/s2': { card: {} }, 'GET /shots/s2/notes': { notes: [] },
            'GET /shots/s2/versions': { versions: [{ version_number: 1, created_at: '2026-10-01' }, { version_number: 2, created_at: '2026-10-02' }] },
            'GET /shots/s2/versions/compare?a=1&b=2': { version_a: { thumbnail_path: 'thumbs/a.png' }, version_b: {}, param_diff: { seed: { a: 1, b: 2 } } },
        });
        await act(async () => { fireEvent.click(card('s2')); });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'A/B Compare' })); });
        await waitFor(() => expect(document.getElementById('abDiffPanel').textContent).toContain('seed'));
        expect(document.getElementById('shotDetailPanel')).toBeNull();
        expect(document.querySelector('#abImgA img').getAttribute('src')).toBe('http://api.test/film/thumbs/a.png');
        expect(document.getElementById('abImgB').textContent).toContain('No image');
        fireEvent.change(document.getElementById('abSlider'), { target: { value: '80' } });
        expect(document.getElementById('abImgB').style.opacity).toBe('0.8');
    });

    it('MOVED: every status the schema allows has a column, and every column accepts a drop', async () => {
        // Derived from the migration's own CHECK, as backend sheet-and-board-affordances does: a status with
        // no column files its shots under a fallback, and a failed shot reading as "not started" is worse.
        const migrations = path.resolve(__dirname, '../../../backend/db/migrations');
        const sql = fs.readdirSync(migrations).filter(f => f.endsWith('.sql')).sort().map(f => fs.readFileSync(path.join(migrations, f), 'utf8')).join('\n');
        const m = /CREATE TABLE[^;]*film_shots[\s\S]*?status[\s\S]*?CHECK \(status IN \(([\s\S]*?)\)\)/.exec(sql);
        expect(m, 'the film_shots status CHECK is gone').toBeTruthy();
        const statuses = [...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]);
        expect(statuses.length).toBeGreaterThanOrEqual(5);
        expect(COLUMNS.map(c => c[0]).sort()).toEqual([...statuses].sort());
        await openPage({ 'PUT /shots/s1': {} });
        for (const status of statuses) {
            fireEvent.dragStart(card('s1'), dt());
            await act(async () => { fireEvent.drop(column(status), dt()); });
        }
        expect(window.api.mock.calls.filter(c => (c[1] || {}).method === 'PUT').map(c => JSON.parse(c[1].body).status).sort())
            .toEqual(statuses.filter(s => s !== 'pending').sort()); // its own column (pending) writes nothing
    });

    it('search, filter and sort narrow the cards each column shows; no match says so; the running order is untouched', async () => {
        await openPage();
        const cards = () => [...document.querySelectorAll('.kanban-card')].map(c => c.dataset.shot);
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'DISSOLVE' } });
        expect(cards()).toEqual(['s2']);
        expect(document.querySelector('[data-list-count]').textContent).toBe('1 of 5 shots');
        expect(column('complete').querySelector('.count').textContent).toBe('1');
        fireEvent.change(document.querySelector('[data-list-search]'), { target: { value: 'zzz' } });
        expect(cards()).toEqual([]);
        expect(document.querySelector('[data-list-nomatch]')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(cards().length).toBe(5);
        fireEvent.change(document.querySelector('[data-list-filter="scene"]'), { target: { value: '3' } });
        expect(cards()).toEqual(['s3']);
        expect(window.state.shots.length).toBe(5); // the shared list is still every shot
    });
});
