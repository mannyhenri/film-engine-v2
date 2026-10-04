/*
 * The folder picker engine, shared. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The folder picker (choose a project's assets folder, preview what a folder holds), shared by its dialog (CoreDialogs), Settings and the project list. FolderPicker (boot-mounted, no dialogs) puts every name here on window.
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
    esc,
    jsAttr,
    setStatus,
    showModal,
} = Object.fromEntries([
    'api',
    'esc',
    'jsAttr',
    'setStatus',
    'showModal',
].map(n => [n, (...a) => legacy[n](...a)]));

    /** Say exactly which folder will be made, before anything is. Free. */
    let previewFolderSeq = 0;

    async function previewProjectFolder() {
        const out = document.getElementById('newProjectFolderPreview');
        if (!out) return;
        const title = ((document.querySelector('#newProjectModal [data-field="title"]') || {}).value || '').trim();
        const parent = ((document.getElementById('newProjectLocation') || {}).value || '').trim();
        const seq = ++previewFolderSeq;
        try {
            const q = `?title=${encodeURIComponent(title || 'Untitled Film')}` + (parent ? `&parent=${encodeURIComponent(parent)}` : '');
            const r = await api('/storage/suggest' + q);
            if (seq !== previewFolderSeq) return;       // a later keystroke already asked
            out.textContent = r.valid ? `Files will be saved in ${r.assets_dir}` : `Cannot use this: ${r.error}`;
            out.style.color = r.valid ? '' : 'var(--danger, #e66)';
        } catch (_) { out.textContent = 'This film gets its own folder here.'; out.style.color = ''; }
    }

    /* The folder picker: where it writes its answer, and what to do after. */
    const FOLDER_PICKER = { target: null, then: null, path: null, parent: null };

    /**
     * Choose a folder — with the Mac's own "Choose Folder" dialog when the page
     * is open on the Mac running Film Engine, and the in-page list otherwise.
     *
     * The browser cannot hand a page a folder's path, so the SERVER opens the
     * Finder dialog (osascript) and returns what was chosen. From a phone or
     * another machine it answers 501 — the dialog would open on a screen
     * nobody is looking at — and the in-page list takes over. Cancelling the
     * Finder dialog changes nothing.
     */
    async function openFolderPicker(targetId, then) {
        FOLDER_PICKER.target = targetId;
        FOLDER_PICKER.then = typeof then === 'function' ? then : null;
        const start = ((document.getElementById(targetId) || {}).value || '').trim();
        setStatus('Choose a folder in the Finder window…', true);
        let r = null;
        try {
            // refresh: false — choosing a folder writes nothing, and a repaint
            // would redraw the field the answer is about to be written into.
            r = await api('/storage/choose', { method: 'POST', body: JSON.stringify({ start, prompt: 'Where should Film Engine save this film?' }), refresh: false });
        } catch (_) { r = null; }         // 501 (not on this Mac) or no dialog: the in-page list
        setStatus('');
        if (r && r.native && r.path) {
            FOLDER_PICKER.path = r.path;
            folderPickerApply();
            return;
        }
        if (r && r.native && r.cancelled) return;
        showModal('folderPickerModal');
        loadFolderPicker(start);
    }

    /** Write the chosen folder where it was asked for, and do what follows. */
    function folderPickerApply() {
        const el = document.getElementById(FOLDER_PICKER.target);
        if (el && FOLDER_PICKER.path) el.value = FOLDER_PICKER.path;
        if (FOLDER_PICKER.target === 'newProjectLocation') previewProjectFolder();
        if (FOLDER_PICKER.then) FOLDER_PICKER.then();
    }

    async function loadFolderPicker(p) {
        const list = document.getElementById('folderPickerList');
        if (!list) return;
        list.innerHTML = '<div class="text-sm text-muted" style="padding:8px;">Loading folders&hellip;</div>';
        try {
            const r = await api('/storage/browse' + (p ? `?path=${encodeURIComponent(p)}` : ''));
            FOLDER_PICKER.path = r.path;
            FOLDER_PICKER.parent = r.parent;
            document.getElementById('folderPickerPath').value = r.path;
            document.getElementById('folderPickerUp').disabled = !r.parent;
            list.innerHTML = r.dirs.length
                ? r.dirs.map(d => `<div class="folder-row" style="padding:6px 10px;cursor:pointer;border-bottom:1px solid var(--border,#2a2a2a);" onclick="loadFolderPicker(${jsAttr(d.path)})">&#128193; ${esc(d.name)}</div>`).join('')
                : '<div class="text-sm text-muted" style="padding:8px;">No folders inside this one.</div>';
        } catch (err) {
            // Never leave the placeholder: say why the folder could not be read.
            list.innerHTML = `<div class="text-sm" style="padding:8px;color:var(--danger,#e66);">${esc(err.message)}</div>`;
        }
    }

    function folderPickerUp() { if (FOLDER_PICKER.parent) loadFolderPicker(FOLDER_PICKER.parent); }

export {
    previewFolderSeq,
    previewProjectFolder,
    FOLDER_PICKER,
    openFolderPicker,
    folderPickerApply,
    loadFolderPicker,
    folderPickerUp,
};
