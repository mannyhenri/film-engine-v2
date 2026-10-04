import { useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import * as E from './engine.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACE from './list-surface.js';

/*
 * The project list, as React. Replaces the legacy list functions listed in react.json: the same routes,
 * bodies, markup and status lines. Core calls loadProjects() at boot (then applies the route) and after
 * every create, delete and import; the React loader answers and returns its promise.
 *
 * Kept in core, reached through legacy.js: PROJECT_LIST (the filter, which core restores from storage at
 * boot), opening a project (shared with the shell), and the project actions only this page offers (new, demo, delete,
 * delete all: engine.js, moved verbatim from core).
 */
const LIST_PREFS = 'fe_project_list';
function saveProjectListPrefs(list) {
    try { localStorage.setItem(LIST_PREFS, JSON.stringify({ status: list.status, archived: list.archived })); } catch { /* storage unavailable */ }
}
/** The new order of ids: `moving` taken out and put before or after `target`. Pure. */
function projectOrderAfterDrop(ids, moving, target, side) {
    if (!moving || moving === target || !ids.includes(moving) || !ids.includes(target)) return ids.slice();
    const out = ids.filter(i => i !== moving);
    const at = out.indexOf(target) + (side === 'after' ? 1 : 0);
    out.splice(at, 0, moving);
    return out;
}
const stageLabel = (st) => String(st).replace(/[-_]/g, ' ');
const stop = (e) => e.stopPropagation();
/*
 * The stages offered are the Settings page's own (#settingsStatus), which the server holds to the same set,
 * so the list and Settings can never offer different stages.
 */
function projectStages() {
    const sel = document.getElementById('settingsStatus');
    return sel ? [...sel.options].map(o => ({ id: o.value, label: o.textContent })) : [];
}

export default function ProjectsPage() {
    const [view, setView] = useState(null); // { projects, meta }
    const [picking, setPicking] = useState(null); // project id whose stage dropdown is open
    const pickRef = useRef(null);

    async function loadProjects() {
        const LIST = legacy.PROJECT_LIST;
        legacy.setStatus('Loading...');
        try {
            const q = [];
            if (LIST.archived) q.push('archived=only');
            if (LIST.status) q.push('status=' + encodeURIComponent(LIST.status));
            const data = await legacy.api('/projects' + (q.length ? '?' + q.join('&') : ''));
            legacy.state.projects = data.projects || [];
            legacy.state.projectListMeta = data;
            // The sidebar's project list (core markup, not this page): what is on the list, never the archive.
            if (!LIST.archived && !LIST.status) {
                const side = document.getElementById('sidebarProjects');
                if (side) side.innerHTML = legacy.state.projects.length === 0 ? '' : legacy.state.projects.map(p =>
                    `<button class="nav-item" onclick="openProject('${p.id}')"><span class="nav-icon">&#127916;</span>${legacy.esc(p.title)}</button>`).join('');
            }
            setPicking(null);
            setView({ projects: legacy.state.projects.slice(), meta: data, list: { status: LIST.status, archived: LIST.archived } });
            legacy.setStatus(legacy.state.projects.length + ' project(s)' + (LIST.archived ? ' archived' : '')
                + (data.archived_count && !LIST.archived ? ` · ${data.archived_count} archived` : ''));
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
    }
    usePageLoader('loadProjects', loadProjects);
    // The sidebar's "+ New Project" (legacy markup) calls it by name.
    usePageLoader('openNewProject', E.openNewProject);

    function setProjectFilter(status) {
        const LIST = legacy.PROJECT_LIST;
        LIST.status = LIST.status === status ? '' : status;
        saveProjectListPrefs(LIST);
        loadProjects();
    }
    function toggleArchivedView() {
        const LIST = legacy.PROJECT_LIST;
        LIST.archived = !LIST.archived;
        LIST.status = '';
        saveProjectListPrefs(LIST);
        loadProjects();
    }
    async function setProjectArchived(id, archive) {
        const p = (legacy.state.projects || []).find(x => x.id === id);
        try {
            await legacy.api('/projects/' + id + (archive ? '/archive' : '/unarchive'), { method: 'POST' });
            legacy.setStatus((p ? p.title : 'Project') + (archive ? ' archived — nothing was deleted; restore it from Archived.' : ' restored to the list.'));
        } catch (err) { legacy.setStatus('Could not ' + (archive ? 'archive' : 'restore') + ': ' + err.message); }
        loadProjects();
    }

    /* Drag to reorder: drop above or below a card, then the whole order is saved. */
    const dropSide = (e) => { const r = e.currentTarget.getBoundingClientRect(); return (e.clientY - r.top) < r.height / 2 ? 'before' : 'after'; };
    function projectDragStart(e, id) {
        legacy.PROJECT_LIST.dragId = id;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', id); } catch { /* not every drag carries data */ }
        e.currentTarget.classList.add('dragging');
    }
    function projectDragOver(e) {
        if (!legacy.PROJECT_LIST.dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const side = dropSide(e);
        e.currentTarget.classList.toggle('drop-before', side === 'before');
        e.currentTarget.classList.toggle('drop-after', side === 'after');
    }
    function projectDragEnd() {
        legacy.PROJECT_LIST.dragId = null;
        document.querySelectorAll('.project-card').forEach(c => c.classList.remove('dragging', 'drop-before', 'drop-after'));
    }
    async function projectDrop(e, targetId) {
        e.preventDefault();
        const moving = legacy.PROJECT_LIST.dragId;
        const side = dropSide(e);
        projectDragEnd();
        const before = (legacy.state.projects || []).map(p => p.id);
        const ids = projectOrderAfterDrop(before, moving, targetId, side);
        if (ids.join() === before.join()) return;
        // Shown at once, then saved; a refusal reloads the order the server holds.
        legacy.state.projects.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        setView(v => ({ ...v, projects: legacy.state.projects.slice() }));
        try {
            await legacy.api('/projects/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
            legacy.setStatus('Order saved');
        } catch (err) { legacy.setStatus('Could not save the order: ' + err.message); loadProjects(); }
    }

    /* THE STAGE, CHANGED WHERE IT IS READ: the badge becomes a dropdown; choosing a stage saves it at once. */
    function openStagePicker(id) {
        setPicking(id);
        setTimeout(() => pickRef.current && pickRef.current.focus(), 0);
    }
    async function setProjectStage(projectId, status) {
        try {
            await legacy.api('/projects/' + projectId, { method: 'PUT', body: JSON.stringify({ status }) });
            const p = (legacy.state.projects || []).find(x => x.id === projectId);
            if (p) p.status = status;
            if (legacy.state.currentProject && legacy.state.currentProject.id === projectId) legacy.state.currentProject.status = status;
            legacy.setStatus('Stage saved: ' + status.replace(/-/g, ' '));
        } catch (err) {
            legacy.setStatus('Could not change the stage: ' + err.message);
        }
        loadProjects();
    }

    const projects = view?.projects || [];
    const meta = view?.meta || {};
    const list = view?.list || { status: '', archived: false };
    const counts = meta.status_counts || {};
    const onList = Object.values(counts).reduce((a, b) => a + b, 0);
    const firstRun = view && !list.archived && !list.status && projects.length === 0 && !meta.archived_count;
    // Search, sort and filter within the stage chip and the Archived view (never re-read).
    const controls = useListControls(SURFACE, view ? projects : null);
    const shownProjects = controls.shown || [];
    const ownOrder = controls.sort === 'order' && !controls.narrowed;
    // A drag saves the WHOLE list's order, so it is offered only on the whole list in its own order: dragging a
    // searched, filtered or re-sorted list would save an order nobody chose.
    const canDrag = !list.archived && !list.status && ownOrder;
    const DRAG_OFF = 'Drag to reorder works on the whole list in My order: clear the search and filters and choose My order to reorder.';
    const chip = (st, label, n) => (
        <button key={'f:' + st} className={'project-filter' + (list.status === st ? ' active' : '')} onClick={() => setProjectFilter(st)}>{label}<span className="n">{n}</span></button>
    );

    return (
        <div className="page active" id="page-projects">
            <div className="flex-between mb-16">
                <h2>Projects</h2>
                <div>
                    <input type="file" id="projectBundleInput" accept=".tar.gz,.tgz" style={{ display: 'none' }} onChange={e => legacy.importBundle(e.target)} />
                    <button className="btn btn-secondary" onClick={() => document.getElementById('projectBundleInput').click()} style={{ marginRight: 8 }}>Import Bundle</button>
                    <button className="btn btn-primary" onClick={() => E.openNewProject()}>+ New Project</button>
                </div>
            </div>
            {/* importBundle (core) writes this element's text and display itself; React never sets either again. */}
            <div id="projectImportStatus" className="text-sm mb-8" style={{ display: 'none' }} />
            <div id="projectList">
                {firstRun && (
                    <div className="empty-state"><div className="icon">🎬</div><h3>No projects yet</h3><p>Create your first film project or load a demo.</p>
                        <div className="project-list-actions" style={{ justifyContent: 'center', marginTop: 12 }}>
                            <button className="btn btn-primary" onClick={() => E.openNewProject()}>New Project</button>
                            <button className="btn btn-secondary" onClick={() => E.loadDemoProject()}>Load Demo Project</button>
                        </div></div>
                )}
                {view && !firstRun && <>
                    {!list.archived && (
                        <div className="project-list-actions">
                            <button className="btn btn-secondary" onClick={() => E.loadDemoProject()}>Load Demo</button>
                            <button className="btn btn-secondary" style={{ color: 'var(--gl-error)', borderColor: 'var(--gl-error)' }} onClick={() => E.deleteAllProjects()}
                                disabled={controls.narrowed}
                                title={controls.narrowed
                                    ? 'Clear the search and filters first: Delete All deletes every project on the list, not only the ones shown.'
                                    : 'Deletes every project on the list. Archived projects are kept.'}>Delete All</button>
                        </div>
                    )}
                    <div className="project-filters" id="projectFilters">
                        {chip('', list.archived ? 'All archived' : 'All', onList)}
                        {(meta.statuses || Object.keys(counts)).filter(st => counts[st]).map(st => chip(st, stageLabel(st), counts[st]))}
                        <span className="project-filter-gap" />
                        <button className={'project-filter' + (list.archived ? ' active' : '')} onClick={toggleArchivedView}
                            title="Archived projects are off the list and kept whole; restore one from here">Archived<span className="n">{meta.archived_count || 0}</span></button>
                    </div>
                    <ListControlsBar list={controls} />
                    {!list.archived && !list.status && !ownOrder && projects.length > 1 && (
                        <p className="text-sm text-muted" data-drag-off title={DRAG_OFF}>Reordering is off while the list is searched, filtered or sorted.</p>
                    )}
                    {!projects.length && <div className="empty-state"><p>{list.archived ? 'Nothing archived' + (list.status ? ' at this stage' : '') + '.' : 'No project at this stage.'}</p></div>}
                    {projects.length > 0 && !shownProjects.length && <ListNoMatch list={controls} />}
                    {shownProjects.map(p => (
                        <div key={p.id} className={'project-card' + (p.archived_at ? ' archived' : '')} data-project-id={p.id} onClick={() => legacy.openProject(p.id)}
                            {...(canDrag ? {
                                draggable: true, onDragStart: e => projectDragStart(e, p.id), onDragOver: projectDragOver,
                                onDragLeave: e => e.currentTarget.classList.remove('drop-before', 'drop-after'), onDrop: e => projectDrop(e, p.id), onDragEnd: projectDragEnd,
                            } : {})}>
                            {canDrag && <span className="project-drag" title="Drag to reorder" onClick={stop}>⠿</span>}
                            <div className="project-icon">🎬</div>
                            <div className="project-info">
                                <h3>{p.title}</h3>
                                <p>{p.logline || 'No logline'}</p>
                                <div className="project-meta">{p.genre ? p.genre + ' · ' : ''}{new Date(p.created_at).toLocaleDateString()}{p.archived_at ? ' · archived ' + new Date(p.archived_at.replace(' ', 'T') + 'Z').toLocaleDateString() : ''}</div>
                            </div>
                            <span className="project-stage" onClick={stop}>
                                {picking === p.id ? (
                                    <select ref={pickRef} className="project-stage-select" id={'stagesel-' + p.id} aria-label={'Stage for ' + p.title} defaultValue={p.status}
                                        onClick={stop} onChange={e => setProjectStage(p.id, e.target.value)}
                                        onBlur={e => { if (e.target.value === p.status) loadProjects(); }}>
                                        {projectStages().map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                                    </select>
                                ) : (
                                    <button type="button" className={'badge ' + p.status + ' project-stage-btn'} id={'stagebtn-' + p.id}
                                        onClick={e => { stop(e); openStagePicker(p.id); }} title="Change this project's stage">{p.status.replace(/-/g, ' ')} ▾</button>
                                )}
                            </span>
                            {p.archived_at
                                ? <button className="project-archive-btn" onClick={e => { stop(e); setProjectArchived(p.id, false); }} title="Put it back on the project list">Restore</button>
                                : <button className="project-archive-btn" onClick={e => { stop(e); setProjectArchived(p.id, true); }} title="Take it off the list. Nothing is deleted; restore it from Archived.">Archive</button>}
                            <button className="project-delete-btn" onClick={e => { stop(e); E.deleteProjectById(p.id, p.title); }} title="Delete project">&times;</button>
                        </div>
                    ))}
                </>}
            </div>
        </div>
    );
}
