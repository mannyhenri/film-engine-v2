/*
 * The project list engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The project actions only the Projects page offers: new, the demo project, delete one, delete all. ProjectsPage.jsx calls them as E.x.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    api,
    confirmProjectDelete,
    loadProjects,
    openProject,
    previewProjectFolder,
    setStatus,
    showModal,
} = Object.fromEntries([
    'api',
    'confirmProjectDelete',
    'loadProjects',
    'openProject',
    'previewProjectFolder',
    'setStatus',
    'showModal',
].map(n => [n, (...a) => legacy[n](...a)]));

    /**
     * Open the new-project dialog with the place its files will go already
     * filled in — the person's own projects folder — so the question is asked
     * every time and answering it costs nothing when the default is right.
     */
    async function openNewProject() {
        showModal('newProjectModal');
        const loc = document.getElementById('newProjectLocation');
        if (loc && !loc.value) {
            try {
                const l = await api('/storage/layout');
                loc.value = l.default_parent || '';
            } catch (_) { /* the server picks the default */ }
        }
        previewProjectFolder();
    }

    async function deleteProjectById(id, title) {
        if (!await confirmProjectDelete(id, title)) return;
        try {
            await api('/projects/' + id, { method: 'DELETE' });
            await loadProjects();
            setStatus('Project deleted');
        } catch (err) {
            // Say plainly that nothing was removed. A failed delete that reads
            // like a generic error leaves the user unsure whether half of it
            // went.
            setStatus('Could not delete the project — nothing was removed. ' + err.message);
        }
    }

    async function deleteAllProjects() {
        if (!confirm('Delete ALL projects? This cannot be undone.')) return;
        if (!confirm('Are you sure? This will permanently remove every project and all associated data.')) return;
        try {
            await api('/projects', { method: 'DELETE' });
            await loadProjects();
            setStatus('All projects deleted');
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    async function loadDemoProject() {
        setStatus('Creating demo project...');
        try {
            const result = await api('/projects/demo', { method: 'POST' });
            await loadProjects();
            if (result.project_id) openProject(result.project_id);
            if (result.already_exists) {
                setStatus('Demo project already exists — opening Neon Requiem');
            } else {
                setStatus('Demo project loaded: Neon Requiem');
            }
        } catch (err) { setStatus('Error: ' + err.message); }
    }

export {
    openNewProject,
    deleteProjectById,
    deleteAllProjects,
    loadDemoProject,
};
