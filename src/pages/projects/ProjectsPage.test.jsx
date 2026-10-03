import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, createEvent, act, within } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ProjectsPage from './ProjectsPage.jsx';

// The project list, end to end against the fake core: the routes, bodies and lines the legacy list produced.
// Also holds two backend page sub-tests that read the legacy list's onclick text (see SKIPPED-SUBTESTS.json):
// project-list "the page drops a card where it was dropped, and draws the filter, archive and drag controls" and
// project-stage-picker "on the list, the badge opens the picker without opening the project, and a choice saves".
const LIST = {
    projects: [
        { id: 'a', title: 'From <the> Mist', logline: 'fog', genre: 'Horror', status: 'script', created_at: '2026-07-25T00:00:00Z' },
        { id: 'b', title: 'Drive-In', status: 'pre-production', created_at: '2026-09-24T00:00:00Z' },
        { id: 'c', title: 'Lodgers', status: 'storyboard', created_at: '2026-09-20T00:00:00Z' },
    ],
    status_counts: { script: 1, 'pre-production': 1, storyboard: 1 }, statuses: ['script', 'pre-production', 'storyboard', 'complete'], archived_count: 2,
};
function stagesOnSettings() {
    const sel = document.createElement('select');
    sel.id = 'settingsStatus';
    sel.innerHTML = '<option value="script">Script</option><option value="production">Production</option>';
    document.body.appendChild(sel);
    const side = document.createElement('div'); side.id = 'sidebarProjects'; document.body.appendChild(side);
}
async function openPage(routes = {}, list = {}) {
    stagesOnSettings();
    // A fresh copy per test: the page sorts state.projects in place (as the legacy list did), which is the response.
    const legacy = installLegacy({ routes: { 'GET /projects': structuredClone(LIST), ...routes } });
    Object.assign(legacy.fake.PROJECT_LIST, { status: '', archived: false, dragId: null }, list);
    render(<ProjectsPage />);
    await act(async () => { await window.loadProjects(); });
    return legacy;
}
const card = (id) => document.querySelector(`.project-card[data-project-id="${id}"]`);
afterEach(() => { document.getElementById('settingsStatus')?.remove(); document.getElementById('sidebarProjects')?.remove(); vi.restoreAllMocks(); });

describe('Projects', () => {
    it('answers to the loader core calls at boot: the list, its meta, the sidebar list, and the status line', async () => {
        const { calls, fake, status } = await openPage();
        expect(calls).toEqual([{ method: 'GET', path: '/projects', body: undefined }]);
        expect(fake.state.projects.map(p => p.id)).toEqual(['a', 'b', 'c']);
        expect(fake.state.projectListMeta).toEqual(LIST);
        expect(document.getElementById('sidebarProjects').innerHTML).toContain('From &lt;the&gt; Mist');
        expect(status).toEqual(['Loading...', '3 project(s) · 2 archived']);
        expect(document.getElementById('page-projects').className).toBe('page active');
    });

    it('each card: title as text, logline, meta, stage badge; opening it opens the project', async () => {
        const { fake } = await openPage();
        expect(within(card('a')).getByText('From <the> Mist')).toBeTruthy();
        expect(card('a').querySelector('.project-meta').textContent).toMatch(/^Horror · /);
        expect(within(card('b')).getByText('No logline')).toBeTruthy();
        expect(card('b').querySelector('.project-stage-btn').textContent).toBe('pre production ▾');
        fireEvent.click(within(card('a')).getByText('From <the> Mist'));
        expect(fake.openProject).toHaveBeenCalledWith('a');
    });

    it('the filter chips: counts from the server; a chip filters (and is remembered); again clears it', async () => {
        const { calls } = await openPage({ 'GET /projects?status=script': { ...LIST, projects: [LIST.projects[0]] } });
        const chips = [...document.querySelectorAll('#projectFilters .project-filter')].map(b => b.textContent);
        expect(chips).toEqual(['All3', 'script1', 'pre production1', 'storyboard1', 'Archived2']);
        await act(async () => { fireEvent.click(within(document.getElementById('projectFilters')).getByText('script')); });
        expect(calls.at(-1).path).toBe('/projects?status=script');
        expect(JSON.parse(localStorage.getItem('fe_project_list'))).toEqual({ status: 'script', archived: false });
        expect(card('a').getAttribute('draggable')).toBeNull();                 // no drag inside a filter
        await act(async () => { fireEvent.click(within(document.getElementById('projectFilters')).getByText('script')); });
        expect(calls.at(-1).path).toBe('/projects');
    });

    it('Archived shows the archive; a card there restores; nothing archived says so', async () => {
        const archived = { ...LIST, projects: [{ id: 'z', title: 'Old', status: 'complete', created_at: '2026-01-01T00:00:00Z', archived_at: '2026-02-01 10:00:00' }] };
        const { calls, status } = await openPage({ 'GET /projects?archived=only': archived, 'POST /projects/z/unarchive': {} });
        await act(async () => { fireEvent.click(screen.getByText('Archived')); });
        expect(calls.at(-1).path).toBe('/projects?archived=only');
        expect(screen.queryByText('Delete All')).toBeNull();
        expect(card('z').className).toBe('project-card archived');
        await act(async () => { fireEvent.click(within(card('z')).getByText('Restore')); });
        expect(calls.find(c => c.path === '/projects/z/unarchive').method).toBe('POST');
        expect(status).toContain('Old restored to the list.');
        await openPage({ 'GET /projects?archived=only': { ...LIST, projects: [] } }, { archived: true });
        expect(screen.getByText('Nothing archived.')).toBeTruthy();
    });

    it('Archive takes a project off the list (and says nothing was deleted); a failure says why', async () => {
        const { calls, status, fake } = await openPage({ 'POST /projects/a/archive': {}, 'POST /projects/b/archive': () => { throw new Error('locked'); } });
        await act(async () => { fireEvent.click(within(card('a')).getByText('Archive')); });
        expect(calls[1]).toEqual({ method: 'POST', path: '/projects/a/archive', body: undefined });
        expect(status).toContain('From <the> Mist archived — nothing was deleted; restore it from Archived.');
        expect(fake.openProject).not.toHaveBeenCalled();
        await act(async () => { fireEvent.click(within(card('b')).getByText('Archive')); });
        expect(status).toContain('Could not archive: locked');
    });

    it('the first run offers New and the demo; the list offers Demo and Delete All; delete one goes to core', async () => {
        const { fake } = await openPage({ 'GET /projects': { projects: [], status_counts: {}, archived_count: 0 } });
        expect(screen.getByText('No projects yet')).toBeTruthy();
        fireEvent.click(screen.getByText('Load Demo Project'));
        expect(fake.loadDemoProject).toHaveBeenCalled();
        const again = await openPage();
        fireEvent.click(screen.getAllByText('Delete All')[0]);
        expect(again.fake.deleteAllProjects).toHaveBeenCalled();
        fireEvent.click(card('a').querySelector('.project-delete-btn'));
        expect(again.fake.deleteProjectById).toHaveBeenCalledWith('a', 'From <the> Mist');
        expect(again.fake.openProject).not.toHaveBeenCalled();
        fireEvent.click(screen.getAllByText('+ New Project')[1]);
        expect(again.fake.openNewProject).toHaveBeenCalled();
    });

    it('drag to reorder: the card drops where it was dropped, shown at once, then the whole order is saved', async () => {
        const { calls, status, fake } = await openPage({ 'POST /projects/reorder': {} });
        const dt = { setData() {}, effectAllowed: '', dropEffect: '' };
        fireEvent.dragStart(card('c'), { dataTransfer: dt });
        expect(fake.PROJECT_LIST.dragId).toBe('c');
        card('a').getBoundingClientRect = () => ({ top: 0, height: 100 });
        // jsdom has no DragEvent, so clientY is set on the event by hand: the top half of the card means "before".
        const drop = createEvent.drop(card('a'), { dataTransfer: dt });
        Object.defineProperty(drop, 'clientY', { value: 10 });
        await act(async () => { fireEvent(card('a'), drop); });
        expect(calls.at(-1)).toEqual({ method: 'POST', path: '/projects/reorder', body: { ids: ['c', 'a', 'b'] } });
        expect([...document.querySelectorAll('.project-card')].map(c => c.dataset.projectId)).toEqual(['c', 'a', 'b']);
        expect(status).toContain('Order saved');
        expect(fake.PROJECT_LIST.dragId).toBeNull();
    });

    it('the stage badge opens the picker WITHOUT opening the project; a choice saves through the project update', async () => {
        const { calls, fake, status } = await openPage({ 'PUT /projects/a': {} });
        fake.state.currentProject = { id: 'a', status: 'script' };
        fireEvent.click(card('a').querySelector('.project-stage-btn'));
        expect(fake.openProject).not.toHaveBeenCalled();
        const sel = document.getElementById('stagesel-a');
        expect([...sel.options].map(o => o.value)).toEqual(['script', 'production']);   // Settings' own stages
        await act(async () => { fireEvent.change(sel, { target: { value: 'production' } }); });
        expect(calls[1]).toEqual({ method: 'PUT', path: '/projects/a', body: { status: 'production' } });
        expect(fake.state.projects[0].status).toBe('production');
        expect(fake.state.currentProject.status).toBe('production');                     // the open project follows too
        expect(status).toContain('Stage saved: production');
        expect(calls.filter(c => c.path === '/projects').length).toBe(2);                // the list is redrawn
    });
});
