import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import MoodBoardPage, { MOOD_KINDS } from './MoodBoardPage.jsx';

const SPECS = { lens: { label: 'Lens', allowed: [24, 40, 85] }, aspect_ratio: { label: 'Aspect ratio', allowed: ['2.39:1', '16:9'] } };
const BOARD = { entries: [
    { id: 'e1', kind: 'palette', note: 'teal <shadows>' },
    { id: 'e2', kind: 'lens', spec_kind: 'lens', spec_value: '40' },
    { id: 'e3', kind: 'image', image_url: '/film/mood-board/p1/still.png', note: 'Blade Runner still' },
    { id: 'e4', kind: 'image', image_path: '/gone.png' },
] };
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/mood-board': BOARD, 'POST /projects/p1/mood-board/compose': { spec_kinds: SPECS }, ...routes } });
    render(<MoodBoardPage />);
    await act(async () => { await window.loadMoodBoardPage(); });
    return legacy;
}
const byId = (id) => document.getElementById(id);

describe('Mood Board', () => {
    it('offers the facets, and the spec kinds the server serves', async () => {
        await openPage();
        expect([...byId('moodKind').options].map(o => o.value)).toEqual(MOOD_KINDS);
        expect([...byId('moodSpecKind').options].map(o => o.textContent)).toEqual(['—', 'Lens', 'Aspect ratio']);
        fireEvent.change(byId('moodSpecKind'), { target: { value: 'lens' } });
        expect([...byId('moodSpecValue').options].map(o => o.value)).toEqual(['24', '40', '85']);
    });

    it('lists entries as text; a picture is a thumbnail that opens the full plate; a pathless one says so', async () => {
        await openPage();
        expect(screen.getByText('teal <shadows>')).toBeTruthy();
        expect(screen.getByText('40')).toBeTruthy();
        const img = document.querySelector('#moodEntries img');
        expect(img.getAttribute('src')).toBe('plate:/film/mood-board/p1/still.png@480');
        fireEvent.click(img);
        expect(window.openPlateViewer).toHaveBeenCalledWith('http://api.test/film/mood-board/p1/still.png', 'Blade Runner still');
        expect(screen.getByText('This reference has no servable location.')).toBeTruthy();
        fireEvent.error(img);
        expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    });

    it('adds a note with its facet, a spec with its value, then clears the note', async () => {
        const bodies = [];
        await openPage({ 'POST /projects/p1/mood-board': (b) => { bodies.push(b); return { ok: true }; } });
        fireEvent.change(byId('moodKind'), { target: { value: 'lighting' } });
        fireEvent.change(byId('moodNote'), { target: { value: 'sodium practicals' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
        expect(bodies[0]).toEqual({ kind: 'lighting', note: 'sodium practicals' });
        expect(byId('moodNote').value).toBe('');
        fireEvent.change(byId('moodSpecKind'), { target: { value: 'aspect_ratio' } });
        fireEvent.change(byId('moodSpecValue'), { target: { value: '16:9' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add' })); });
        expect(bodies[1]).toEqual({ kind: 'lighting', note: '', spec_kind: 'aspect_ratio', spec_value: '16:9' });
    });

    it('Preview composes without applying; Apply writes, and shows what reaches a prompt and the settings written', async () => {
        const bodies = [];
        const { status } = await openPage({ 'POST /projects/p1/mood-board/compose': (b) => {
            bodies.push(b);
            return b.apply ? { style_preset: 'teal noir', effective_style: 'teal noir, 40mm', applied_specs: [{ kind: 'lens' }], warnings: [{ detail: 'names a subject: dragon' }], spec_kinds: SPECS }
                : { style_preset: 'teal noir', spec_kinds: SPECS };
        } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Preview style' })); });
        expect(bodies.at(-1)).toEqual({ apply: false });
        expect(byId('moodComposed').textContent).toContain('Would apply');
        expect(status).toContain('Look previewed — not applied');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply look' })); });
        expect(bodies.at(-1)).toEqual({ apply: true });
        const shown = byId('moodComposed').textContent;
        expect(shown).toContain('Applied');
        expect(shown).toContain('names a subject: dragon');
        expect(shown).toContain('What actually reaches a prompt:teal noir, 40mm');
        expect(shown).toContain('Settings written: lens');
    });

    it('remove deletes the entry; an upload goes through the shared helper with the note', async () => {
        const { calls } = await openPage({ 'DELETE /mood-board/e1': { ok: true } });
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]); });
        expect(calls.find(c => c.method === 'DELETE').path).toBe('/mood-board/e1');
        fireEvent.change(byId('moodNote'), { target: { value: 'grade' } });
        const input = document.querySelector('[data-import-target="mood-board-image"]');
        fireEvent.change(input, { target: { files: [] } });
        expect(window.uploadReferenceImage).toHaveBeenCalledWith(expect.anything(), 'mood-board-image', '/projects/p1/mood-board/import', { note: 'grade' }, 'loadMoodBoardPage');
    });

    it('an empty board says so, across the whole grid row', async () => {
        await openPage({ 'GET /projects/p1/mood-board': { entries: [] } });
        expect(screen.getByText('Nothing on the board yet.')).toBeTruthy();
    });

    it('CHANGE: a board that cannot be read says so (the legacy loader had no catch)', async () => {
        const { status } = await openPage({ 'GET /projects/p1/mood-board': () => { throw new Error('down'); } });
        expect(status).toContain('Could not read the mood board: down');
    });
});
