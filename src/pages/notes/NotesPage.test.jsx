import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import NotesPage from './NotesPage.jsx';

// Behaviour of Notes & Reviews, end to end against the fake core: the same routes, bodies and
// status lines the legacy page produced.
const BOARD = { scenes: [
    { id: 's1', scene_number: 1, location: 'DINER', shots: [{ id: 'sh1', shot_code: '1A', status: 'draft' }, { id: 'sh2', shot_code: '1B', status: 'approved' }] },
    { id: 's2', scene_number: 2, location: 'STREET', shots: [] },
] };
const NOTES = { notes: [
    { id: 'n1', note_type: 'direction', priority: 'high', author: 'Manny', created_at: '2026-10-03T08:00:00Z', resolved: 0, content: 'Hold on her face <longer>' },
    { id: 'n2', note_type: 'camera', priority: 'normal', author: null, created_at: '2026-10-03T08:00:00Z', resolved: 1, content: 'Lower' },
] };

async function openPage(extraRoutes = {}) {
    const legacy = installLegacy({ routes: { 'GET /projects/p1/status-board': BOARD, 'GET /shots/sh1/notes': NOTES, ...extraRoutes } });
    render(<NotesPage />);
    await act(async () => { await window.loadNotesPage(); });
    return legacy;
}
const pickShot = async () => {
    fireEvent.change(document.getElementById('noteSceneSelect'), { target: { value: 's1' } });
    await act(async () => { fireEvent.change(document.getElementById('noteShotSelect'), { target: { value: 'sh1' } }); });
};

describe('Notes & Reviews', () => {
    it('answers to the loader navigateTo calls, and lists the scenes of the status board', async () => {
        const { calls } = await openPage();
        expect(calls[0]).toEqual({ method: 'GET', path: '/projects/p1/status-board', body: undefined });
        const scenes = [...document.querySelectorAll('#noteSceneSelect option')].map(o => o.textContent);
        expect(scenes).toEqual(['Select scene...', 'Sc 1 — DINER', 'Sc 2 — STREET']);
        expect(screen.getByText('Select a scene and shot to view notes.')).toBeTruthy();
    });

    it('does nothing without a project, as the legacy loader did', async () => {
        const legacy = installLegacy({ project: null });
        render(<NotesPage />);
        await act(async () => { await window.loadNotesPage(); });
        expect(legacy.calls).toEqual([]);
    });

    it('a scene offers its shots; a shot loads its notes, escaped as text, newest state shown', async () => {
        await openPage();
        await pickShot();
        expect([...document.querySelectorAll('#noteShotSelect option')].map(o => o.textContent)).toEqual(['Select shot...', '1A (draft)', '1B (approved)']);
        await waitFor(() => expect(document.querySelectorAll('.note-item').length).toBe(2));
        expect(screen.getByText('Hold on her face <longer>')).toBeTruthy(); // text, not markup
        expect(document.querySelector('.note-item.resolved')).toBeTruthy();
        expect(screen.getByText('unknown')).toBeTruthy();
    });

    it('a shot with no notes says so', async () => {
        await openPage({ 'GET /shots/sh1/notes': { notes: [] } });
        await pickShot();
        await waitFor(() => expect(screen.getByText('No notes for this shot.')).toBeTruthy());
    });

    it('+ Note and Review Shot need a shot first', async () => {
        const { status, fake } = await openPage();
        fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
        fireEvent.click(screen.getByRole('button', { name: 'Review Shot' }));
        expect(status).toEqual(['Select a shot first', 'Select a shot first']);
        expect(fake.showModal).not.toHaveBeenCalled();
    });

    it('adds a note through the shared modal stack, with the fields the route takes', async () => {
        let posted;
        const { fake, status } = await openPage({ 'POST /shots/sh1/notes': (b) => { posted = b; return { ok: true }; } });
        await pickShot();
        fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
        expect(fake.showModal).toHaveBeenCalledWith('addNoteModal');
        const modal = document.getElementById('addNoteModal');
        expect(modal.classList.contains('modal-overlay') && modal.classList.contains('open')).toBe(true);
        fireEvent.change(modal.querySelectorAll('select')[0], { target: { value: 'lighting' } });
        fireEvent.change(modal.querySelector('textarea'), { target: { value: 'Warmer key' } });
        fireEvent.change(modal.querySelector('input'), { target: { value: 'DP' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add Note' })); });
        expect(posted).toEqual({ note_type: 'lighting', priority: 'normal', content: 'Warmer key', author: 'DP' });
        expect(fake.closeModal).toHaveBeenCalledWith('addNoteModal');
        expect(status).toContain('Note added');
    });

    it('an open modal stays open while the page re-renders (React must not take the stack\'s class away)', async () => {
        await openPage();
        await pickShot();
        fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
        const modal = document.getElementById('addNoteModal');
        fireEvent.change(modal.querySelector('textarea'), { target: { value: 'a' } });
        fireEvent.change(modal.querySelector('textarea'), { target: { value: 'ab' } });
        expect(modal.classList.contains('open')).toBe(true);
    });

    it('an empty note is not sent', async () => {
        const { calls } = await openPage();
        await pickShot();
        fireEvent.click(screen.getByRole('button', { name: '+ Note' }));
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add Note' })); });
        expect(calls.some(c => c.method === 'POST')).toBe(false);
    });

    it('resolves a note and reloads the list', async () => {
        const { calls, status } = await openPage({ 'PUT /notes/n1': { ok: true } });
        await pickShot();
        await waitFor(() => screen.getByText('Resolve'));
        await act(async () => { fireEvent.click(screen.getByText('Resolve')); });
        expect(calls.find(c => c.method === 'PUT')).toEqual({ method: 'PUT', path: '/notes/n1', body: { resolved: true } });
        expect(status).toContain('Note resolved');
        expect(calls.filter(c => c.path === '/shots/sh1/notes').length).toBe(2);
    });

    it('submits a review with the decision and trimmed notes', async () => {
        let posted;
        const { status } = await openPage({ 'POST /shots/sh1/review': (b) => { posted = b; return { ok: true }; } });
        await pickShot();
        fireEvent.click(screen.getByRole('button', { name: 'Review Shot' }));
        fireEvent.change(document.getElementById('reviewDecision'), { target: { value: 'reject' } });
        fireEvent.change(document.getElementById('reviewNotes'), { target: { value: '  too dark  ' } });
        await act(async () => { fireEvent.click(screen.getByText('Submit Review')); });
        expect(posted).toEqual({ approved: false, notes: 'too dark' });
        expect(status).toContain('Review submitted — shot rejected');
        expect(document.getElementById('reviewNotes').value).toBe('');
    });

    it('an API failure is said on the status bar, not swallowed', async () => {
        const legacy = installLegacy({ routes: {} });
        render(<NotesPage />);
        await act(async () => { await window.loadNotesPage(); });
        expect(legacy.status[0]).toMatch(/^Error: no fake route/);
    });
});
