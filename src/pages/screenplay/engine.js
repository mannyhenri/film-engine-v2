/*
 * The Screenplay engine. MOVED VERBATIM from the reference app (film-engine reference),
 * by tools/extract-engine.js: same names, same bodies. The Screenplay page and its dialogs: the editor itself (its blocks, normalisation, pagination, autosave and the Fountain round trip), the scene navigator and index cards, statistics, import and export (Fountain, FDX, plain text), the AI writing panel, text conversion, suggestions and the typewriter. MOVED from the legacy code (the screenplay chunk, then the editor core that only the Screenplay page and its dialogs use, as measured by tools/core-ownership.js). React renders the page (ScreenplayPage.jsx) and the dialogs (ScreenplayDialogs); this drives the editor and its panels through their ids, as before.
 *
 * Kept verbatim on purpose: backend tests read these functions from the page source, so the text they check is
 * the code that runs (tools/tests/engine-verbatim.test.js). Do not reformat it; change it as code, with its tests.
 * Core is reached through the bridge below by the same names (tools/tests/engine-bridge.test.js).
 */
import { legacy, setLegacy } from '../../lib/legacy.js';

// Core's functions, each called through the bridge by its own name. One destructuring statement on purpose:
// a line reading `const esc = …` would be the first definition a backend test finds when it searches the page.
const {
    API,
    api,
    checkUploadSize,
    closeModal,
    esc,
    escapeHtml,
    focusWordCount,
    loadCharacters,
    loadLocations,
    renderTitlePageCard,
    setStatus,
    showModal,
    toggleWriterFocus,
    typewriterButtons,
    updateConversionEstimate,
    updateSceneStatusIcons,
} = Object.fromEntries([
    'API',
    'api',
    'checkUploadSize',
    'closeModal',
    'esc',
    'escapeHtml',
    'focusWordCount',
    'loadCharacters',
    'loadLocations',
    'renderTitlePageCard',
    'setStatus',
    'showModal',
    'toggleWriterFocus',
    'typewriterButtons',
    'updateConversionEstimate',
    'updateSceneStatusIcons',
].map(n => [n, (...a) => legacy[n](...a)]));
const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
    has: (_, k) => k in legacy[name],
    ownKeys: () => Reflect.ownKeys(legacy[name]),
    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(legacy[name], k); if (d) d.configurable = true; return d; },
    deleteProperty: (_, k) => delete legacy[name][k],
});
// Core's objects, as live proxies, in one destructuring statement for the same reason.
const { AI_PATH, TYPEWRITER, state } = Object.fromEntries(['AI_PATH', 'TYPEWRITER', 'state'].map(n => [n, live(n)]));
// Core's values, read live as legacy.X and assigned with setLegacy: APP_AUTHOR, MAX_CHUNK_SIZE, feStore.

    // ══════════════════════════════════════════════════════════════
    // SCREENPLAY EDITOR
    // ══════════════════════════════════════════════════════════════

    // Store current Fountain content
    let currentFountainContent = '';

    let editorDirty = false;

 // Tab cycles through these

    // FILM-101: Configurable auto-formatting rules
    const AUTO_FORMAT_RULES = {
        // What type comes next after Enter (non-empty line)
        nextType: {
            'scene-heading': 'action',
            'action': 'action',
            'character': 'dialogue',
            'dialogue': 'character',  // Next speaker after dialogue
            'parenthetical': 'dialogue',
            'transition': 'scene-heading',
            'centered': 'action',
            'dual-dialogue': 'dialogue',
            'lyrics': 'lyrics',
            'note': 'action',
            // A section heads what follows; a synopsis describes it. Both give
            // way to action, which is what actually comes next on the page.
            'section': 'action',
            'synopsis': 'action'
        },
        // What type to switch to on empty line Enter
        emptyLineType: {
            'scene-heading': 'action',
            'action': 'action',
            'character': 'action',
            'dialogue': 'action',      // Empty dialogue -> back to action
            'parenthetical': 'dialogue',
            'transition': 'action',
            'centered': 'action',
            'dual-dialogue': 'action',
            'lyrics': 'action',
            'note': 'action',
            'section': 'action',
            'synopsis': 'action'
        },
        // Context-aware Tab cycles
        tabCycles: {
            // Tab walks the order a page is actually written in.
            'default': ['scene-heading', 'action', 'character', 'dialogue'],
            'after-scene': ['action', 'character', 'dialogue'],
            'in-dialogue': ['dialogue', 'parenthetical', 'character']
        },
        // Patterns for auto-detection
        patterns: {
            sceneHeading: /^[^\w\s.]*(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i,
            transition: /^[A-Z][A-Z\s]+:$/,
            // A single leading period forces a heading; an ellipsis does not
            // ("..same price." is dialogue). Same rule as the backend parser.
            forcedSceneHeading: /^\.(?!\.)\S/,
            forcedCharacter: /^@/,
            forcedTransition: /^>/,
            forcedAction: /^!/,
            parenthetical: /^\s*\([^)]+\)\s*$/,

            // The five that were unreachable. Every one has a forced marker in
            // Fountain already, so the way in is the syntax the format defines
            // rather than a toolbar — the same mechanism `.` uses to force a
            // scene heading. A second convention would be a second thing to
            // learn for a format that already has one.
            //
            // ORDER MATTERS for `centered`: it opens with `>` exactly as a
            // forced transition does, and is distinguished only by the closing
            // `<`. It must be tested first or every centered line becomes a
            // transition.
            centered: /^>.*<\s*$/,
            section: /^#{1,6}\s*\S/,
            // `=` is a synopsis; `===` is a page break. The lookahead keeps the
            // two apart rather than letting a page break become a one-character
            // synopsis.
            synopsis: /^=(?!=)\s*\S/,
            lyrics: /^~/,
            note: /^\[\[.*\]\]\s*$/
        }
    };

    /**
     * Strip emphasis markers from a scene heading.
     *
     * A slugline is never bold or italic in Fountain — the app styles it. But
     * pasted or converted text often arrives as **INT. KITCHEN - NIGHT**, and
     * the heading pattern tolerates leading punctuation, so the markers were
     * kept as literal characters and rendered on the page. Strip on the way in
     * and on the way out, so a round trip cannot reintroduce them.
     */
    function stripEmphasisMarkers(text) {
        if (!text) return '';
        return String(text)
            // Leading UI glyphs that previous saves welded onto the slugline
            // (status icons, bullets) plus emphasis markers.
            .replace(/^[\s*_\u23F1\u23F2\u2022\u25CF\u25CB\uFE0F]+/, '')
            .replace(/[\s*_]+$/, '')
            .trim();
    }

    // Debounce timer for auto-detection
    let autoDetectTimer = null;

    const AUTO_DETECT_DELAY = 400;

 // ms

    // FILM-103: Autocomplete state
    let autocompleteVisible = false;

    let autocompleteItems = [];

    let autocompleteSelectedIndex = 0;

    let autocompleteType = null;

 // 'character' or 'location'

    // FILM-104: Auto-save state
    let autoSaveTimer = null;

    const AUTO_SAVE_DELAY = 3000;

 // 3 seconds
    let currentScriptVersion = null;

    let saveStatus = 'saved';

 // 'saved', 'saving', 'unsaved'

    // FILM-105: Undo/Redo state
    const undoStack = [];

    const redoStack = [];

    const MAX_UNDO_ENTRIES = 100;

    const UNDO_DEBOUNCE_DELAY = 500;

 // ms
    let undoTimer = null;

    let lastUndoTimestamp = 0;

    // FILM-107: Scene numbering state
    let sceneNumbersLocked = false;

    // FILM-102: Keyboard shortcuts
    const KEYBOARD_SHORTCUTS = {
        // Element type shortcuts (Ctrl/Cmd + number)
        '1': { type: 'scene-heading', label: 'Scene Heading' },
        '2': { type: 'action', label: 'Action' },
        '3': { type: 'character', label: 'Character' },
        '4': { type: 'dialogue', label: 'Dialogue' },
        '5': { type: 'parenthetical', label: 'Parenthetical' },
        '6': { type: 'transition', label: 'Transition' },
        '7': { type: 'dual-dialogue', label: 'Dual Dialogue' },
        '8': { type: 'centered', label: 'Centered' },
        '9': { type: 'note', label: 'Note' }
    };

    let shortcutHelpVisible = false;

    async function uploadScreenplay() {
        if (!state.currentProject) return;
        const content = document.getElementById('scriptInput').value.trim();
        if (!content) { setStatus('Paste a screenplay first'); return; }
        setStatus('Uploading...');
        try {
            // Try to upload as Fountain
            const data = await api('/projects/' + state.currentProject.id + '/script', {
                method: 'POST', body: JSON.stringify({ fountain_content: content })
            });
            setStatus(`Script v${data.script.version} uploaded — ${data.scenes_extracted} scene(s)`);
            loadScriptVersions();
            loadLatestFountain(); // Load into editor
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    // FILM-125: Track script versions for comparison
    let scriptVersionsData = [];

    let selectedVersions = [];

    async function loadScriptVersions() {
        if (!state.currentProject) return;
        try {
            const data = await api('/projects/' + state.currentProject.id + '/scripts');
            const scripts = data.scripts || [];
            scriptVersionsData = scripts; // FILM-125: Store for diff

            document.getElementById('scriptVersionSelector').innerHTML = scripts.length > 0 ?
                `<select style="width:auto;display:inline-block;font-size:11px;padding:4px 8px;" onchange="loadScriptVersion(this.value)">
                    ${scripts.map(s => `<option value="${s.version}">v${s.version} — ${s.word_count} words${s.format === 'fountain' ? ' (Fountain)' : ''}</option>`).join('')}
                </select>` : '';

            if (scripts.length === 0) {
                document.getElementById('scriptVersions').innerHTML = '<p class="text-sm text-muted">No scripts uploaded.</p>';
                return;
            }

            // FILM-125: Enhanced version list with comparison support
            let html = '<div class="section-label">Versions</div>';

            // Comparison bar (shown when 2 versions selected)
            html += `<div class="version-compare-bar" id="versionCompareBar" style="display:none;">
                <span class="text-sm">Selected: <span id="selectedVersionsText"></span></span>
                <button class="btn btn-sm btn-primary" onclick="compareSelectedVersions()">Compare</button>
                <button class="btn btn-sm btn-outline" onclick="clearVersionSelection()">Clear</button>
            </div>`;

            // Version items
            for (let i = 0; i < scripts.length; i++) {
                const s = scripts[i];
                const prevVersion = scripts[i + 1]; // Versions are DESC, so i+1 is older
                const wordDelta = prevVersion ? s.word_count - prevVersion.word_count : 0;
                const deltaClass = wordDelta > 0 ? 'positive' : wordDelta < 0 ? 'negative' : '';
                const deltaText = wordDelta !== 0 ? (wordDelta > 0 ? `+${wordDelta}` : wordDelta) : '';

                // FILM-129: Revision indicator
                const revisionBadge = s.revision_number ?
                    `<span class="revision-dot ${s.revision_color}" style="width:8px;height:8px;display:inline-block;border-radius:50%;margin-right:4px;" title="Revision ${s.revision_number} (${s.revision_color})"></span>` : '';
                const revisionText = s.revision_number ? ` Rev ${s.revision_number}` : '';

                html += `
                <div class="version-item" onclick="toggleVersionSelect(${s.version})" data-version="${s.version}">
                    <input type="checkbox" onclick="event.stopPropagation(); toggleVersionSelect(${s.version})"
                           id="versionCheck_${s.version}" ${selectedVersions.includes(s.version) ? 'checked' : ''}>
                    ${revisionBadge}<span class="version-badge">v${s.version}${revisionText}</span>
                    <div class="version-meta">
                        <div class="version-meta-primary">
                            <span>${s.word_count.toLocaleString()} words</span>
                            ${deltaText ? `<span class="${deltaClass}" style="font-size:10px;">(${deltaText})</span>` : ''}
                            ${s.page_count ? `<span>· ${s.page_count} pgs</span>` : ''}
                            ${s.scene_count ? `<span>· ${s.scene_count} scenes</span>` : ''}
                        </div>
                        <div class="version-meta-secondary">
                            ${new Date(s.created_at).toLocaleString()}
                        </div>
                    </div>
                    <div class="version-actions">
                        <button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); loadScriptVersion(${s.version})" title="Load this version">Load</button>
                        ${i > 0 ? `<button class="btn btn-xs btn-outline" onclick="event.stopPropagation(); restoreVersion(${s.version})" title="Create new version from this">Restore</button>` : ''}
                    </div>
                </div>`;
            }

            document.getElementById('scriptVersions').innerHTML = html;
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    // FILM-125: Toggle version selection for comparison
    function toggleVersionSelect(version) {
        const idx = selectedVersions.indexOf(version);
        if (idx >= 0) {
            selectedVersions.splice(idx, 1);
        } else {
            if (selectedVersions.length < 2) {
                selectedVersions.push(version);
            } else {
                // Replace oldest selection
                selectedVersions.shift();
                selectedVersions.push(version);
            }
        }

        // Update checkboxes and item styles
        document.querySelectorAll('.version-item').forEach(item => {
            const v = parseInt(item.dataset.version);
            const checkbox = item.querySelector('input[type="checkbox"]');
            const isSelected = selectedVersions.includes(v);
            item.classList.toggle('selected', isSelected);
            if (checkbox) checkbox.checked = isSelected;
        });

        // Update compare bar
        const compareBar = document.getElementById('versionCompareBar');
        const selectedText = document.getElementById('selectedVersionsText');
        if (selectedVersions.length >= 2) {
            compareBar.style.display = 'flex';
            selectedText.textContent = `v${selectedVersions[0]} vs v${selectedVersions[1]}`;
        } else {
            compareBar.style.display = selectedVersions.length > 0 ? 'flex' : 'none';
            selectedText.textContent = selectedVersions.length > 0 ? `v${selectedVersions[0]} (select one more)` : '';
        }
    }

    function clearVersionSelection() {
        selectedVersions = [];
        document.querySelectorAll('.version-item').forEach(item => {
            item.classList.remove('selected');
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox) checkbox.checked = false;
        });
        document.getElementById('versionCompareBar').style.display = 'none';
    }

    // FILM-125: Restore a previous version (creates new version)
    async function restoreVersion(version) {
        if (!confirm(`Restore version ${version}? This will create a new version with that content.`)) return;

        try {
            setStatus('Restoring version...');
            // Fetch the old version content
            const data = await api('/projects/' + state.currentProject.id + '/scripts/' + version);

            if (!data.fountain_content && !data.content) {
                setStatus('Cannot restore: no content found');
                return;
            }

            // Save as new version
            const content = data.fountain_content || data.content;
            await api('/projects/' + state.currentProject.id + '/script', {
                method: 'POST',
                body: JSON.stringify({ fountain_content: content })
            });

            setStatus(`Version ${version} restored as new version`);
            loadScriptVersions();
            loadLatestFountain();
        } catch (err) {
            setStatus('Error: ' + err.message);
        }
    }

    // FILM-125: Compare two selected versions
    async function compareSelectedVersions() {
        if (selectedVersions.length !== 2) {
            setStatus('Select exactly 2 versions to compare');
            return;
        }

        const [v1, v2] = selectedVersions.sort((a, b) => a - b); // Older first
        setStatus('Loading versions for comparison...');

        try {
            const [data1, data2] = await Promise.all([
                api('/projects/' + state.currentProject.id + '/scripts/' + v1),
                api('/projects/' + state.currentProject.id + '/scripts/' + v2)
            ]);

            const content1 = data1.fountain_content || data1.content || '';
            const content2 = data2.fountain_content || data2.content || '';

            showVersionDiff(v1, v2, content1, content2, data1, data2);
        } catch (err) {
            setStatus('Error loading versions: ' + err.message);
        }
    }

    // FILM-125: LCS-based diff algorithm
    function computeDiff(text1, text2) {
        const lines1 = text1.split('\n');
        const lines2 = text2.split('\n');

        // Build LCS matrix
        const m = lines1.length;
        const n = lines2.length;
        const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (lines1[i - 1] === lines2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to build diff
        const diff1 = [];
        const diff2 = [];
        let i = m, j = n;

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && lines1[i - 1] === lines2[j - 1]) {
                diff1.unshift({ text: lines1[i - 1], type: 'unchanged' });
                diff2.unshift({ text: lines2[j - 1], type: 'unchanged' });
                i--; j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                diff1.unshift({ text: '', type: 'empty' });
                diff2.unshift({ text: lines2[j - 1], type: 'added' });
                j--;
            } else {
                diff1.unshift({ text: lines1[i - 1], type: 'removed' });
                diff2.unshift({ text: '', type: 'empty' });
                i--;
            }
        }

        return { diff1, diff2 };
    }

    // FILM-125: Show version diff in modal
    function showVersionDiff(v1, v2, content1, content2, meta1, meta2) {
        const { diff1, diff2 } = computeDiff(content1, content2);

        // Count changes
        const additions = diff2.filter(d => d.type === 'added').length;
        const deletions = diff1.filter(d => d.type === 'removed').length;
        const wordDelta = (meta2.word_count || 0) - (meta1.word_count || 0);
        const pageDelta = (meta2.page_count || 0) - (meta1.page_count || 0);
        const sceneDelta = (meta2.scene_count || 0) - (meta1.scene_count || 0);

        // Stats
        document.getElementById('diffStats').innerHTML = `
            <div class="diff-stat">
                <div class="diff-stat-value ${wordDelta > 0 ? 'positive' : wordDelta < 0 ? 'negative' : ''}">${wordDelta > 0 ? '+' : ''}${wordDelta}</div>
                <div class="diff-stat-label">Words</div>
            </div>
            <div class="diff-stat">
                <div class="diff-stat-value ${pageDelta > 0 ? 'positive' : pageDelta < 0 ? 'negative' : ''}">${pageDelta > 0 ? '+' : ''}${pageDelta}</div>
                <div class="diff-stat-label">Pages</div>
            </div>
            <div class="diff-stat">
                <div class="diff-stat-value ${sceneDelta > 0 ? 'positive' : sceneDelta < 0 ? 'negative' : ''}">${sceneDelta > 0 ? '+' : ''}${sceneDelta}</div>
                <div class="diff-stat-label">Scenes</div>
            </div>
            <div class="diff-stat">
                <div class="diff-stat-value positive">+${additions}</div>
                <div class="diff-stat-label">Lines Added</div>
            </div>
            <div class="diff-stat">
                <div class="diff-stat-value negative">-${deletions}</div>
                <div class="diff-stat-label">Lines Removed</div>
            </div>
        `;

        // Render diff panels
        document.getElementById('diffView').innerHTML = `
            <div class="diff-panel">
                <div class="diff-panel-header">Version ${v1} — ${new Date(meta1.created_at).toLocaleString()}</div>
                <div class="diff-content">${diff1.map(d =>
                    d.type === 'empty' ? '' :
                    `<div class="diff-line ${d.type}">${esc(d.text) || '&nbsp;'}</div>`
                ).join('')}</div>
            </div>
            <div class="diff-panel">
                <div class="diff-panel-header">Version ${v2} — ${new Date(meta2.created_at).toLocaleString()}</div>
                <div class="diff-content">${diff2.map(d =>
                    d.type === 'empty' ? '' :
                    `<div class="diff-line ${d.type}">${esc(d.text) || '&nbsp;'}</div>`
                ).join('')}</div>
            </div>
        `;

        showModal('versionDiffModal');
        setStatus(`Comparing v${v1} and v${v2}`);
    }

    async function loadScriptVersion(ver) {
        if (!state.currentProject) return;
        try {
            const data = await api('/projects/' + state.currentProject.id + '/scripts/' + ver);
            if (data.fountain_content) {
                currentFountainContent = data.fountain_content;
                currentScriptVersion = parseInt(ver); // FILM-104: Track version for auto-save
                renderFountainToEditor(data.fountain_content);
                if (currentViewMode === 'cards') renderIndexCards();
                updateEditorStats();
                updateSaveStatus('saved');
                // FILM-129: Load revision info
                loadRevisionInfo(data);
            } else if (data.content) {
                document.getElementById('scriptInput').value = data.content;
                document.getElementById('screenplayEditor').innerHTML = '<div class="sp-action" data-element-type="action">' + escapeHtml(data.content) + '</div>';
                normalizeEditor();   // every way in leaves the editor sound
                currentScriptVersion = parseInt(ver);
                updateSaveStatus('saved');
                loadRevisionInfo(null);
            }
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    async function loadLatestFountain() {
        if (!state.currentProject) return;
        try {
            const data = await api('/projects/' + state.currentProject.id + '/script/latest/fountain');
            if (data.fountain_content) {
                currentFountainContent = data.fountain_content;
                currentScriptVersion = data.version; // FILM-104: Track version for auto-save
                renderFountainToEditor(data.fountain_content);
                if (currentViewMode === 'cards') renderIndexCards();
                updateEditorStats(data.page_count, data.scene_count);
                updateSaveStatus('saved');
                setStatus(`Loaded v${data.version} — ${data.scene_count} scenes`);
                // FILM-129: Load revision info
                loadRevisionInfo(data);
            }
        } catch (err) {
            // No Fountain content yet - that's OK
            document.getElementById('screenplayEditor').innerHTML = '';
            normalizeEditor();   // every way in leaves the editor sound
            currentScriptVersion = null;
            updateSaveStatus('saved');
            loadRevisionInfo(null);
        }
    }

    function renderFountainToEditor(fountainText) {
        const editor = document.getElementById('screenplayEditor');
        // Parse and render Fountain to HTML
        // Using inline Fountain rendering (simplified)
        const html = parseFountainToHTML(fountainText);
        editor.innerHTML = html;
        normalizeEditor();   // every way in leaves the editor sound
        editorDirty = false;
        updateSceneNavigator(fountainText);
        // FILM-107: Update scene numbers after loading
        updateSceneNumbers();
        // FILM-105: Initialize undo stack with loaded content
        initUndoStack();

        // FILM-128: Update currentTitlePage from loaded content
        const titlePageBlock = editor.querySelector('[data-element-type="title-page"]');
        if (titlePageBlock && titlePageBlock.dataset.titlePageData) {
            try {
                currentTitlePage = JSON.parse(titlePageBlock.dataset.titlePageData);
            } catch (e) {
                currentTitlePage = null;
            }
        } else {
            currentTitlePage = null;
        }
    }

    function parseFountainToHTML(text) {
        if (!text) return '';
        const lines = text.split('\n');
        const htmlParts = [];
        let prevLineBlank = true;
        let inDialogue = false;
        let startIndex = 0;

        // FILM-128: Parse title page at the start of the document
        const titlePage = {};
        let inTitlePage = false;
        let currentKey = null;
        let currentValue = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const keyMatch = line.match(/^([A-Za-z][A-Za-z\s]*?)\s*:\s*(.*)$/);

            if (keyMatch && (i === 0 || inTitlePage)) {
                inTitlePage = true;
                // Save previous key-value
                if (currentKey) {
                    titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')] = currentValue.join('\n').trim();
                }
                currentKey = keyMatch[1];
                currentValue = keyMatch[2] ? [keyMatch[2]] : [];
            } else if (inTitlePage && line.match(/^\s{3,}/) && currentKey) {
                // Multi-line value (indented continuation)
                currentValue.push(line.trim());
            } else if (inTitlePage && line.trim() === '') {
                // End of title page
                if (currentKey) {
                    titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')] = currentValue.join('\n').trim();
                }
                startIndex = i + 1;
                break;
            } else if (!inTitlePage && line.trim() !== '') {
                // Not a title page
                break;
            }
        }

        // Render title page block if found
        if (Object.keys(titlePage).length > 0) {
            const titlePageData = JSON.stringify(titlePage).replace(/"/g, '&quot;');
            let titleHtml = '<div class="screenplay-block title-page-block" data-element-type="title-page" data-title-page-data="' + titlePageData + '" contenteditable="false" onclick="openTitlePageModal()">';
            titleHtml += titlePageInnerHtml(titlePage);
            titleHtml += '<button class="title-page-edit-btn" onclick="openTitlePageModal()" title="Edit Title Page">Edit</button>';
            titleHtml += '</div>';
            htmlParts.push(titleHtml);
        }

        for (let i = startIndex; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            const nextLine = lines[i + 1] || '';
            const nextBlank = !nextLine.trim();

            if (!trimmed) {
                prevLineBlank = true;
                inDialogue = false;
                continue;
            }

            // Lyrics
            if (trimmed.startsWith('~')) {
                const lyricsText = trimmed.slice(1).trim();
                htmlParts.push(`<div class="sp-lyrics" data-element-type="lyrics">${escapeHtml(lyricsText)}</div>`);
                prevLineBlank = false;
                continue;
            }

            // Note
            if (trimmed.startsWith('[[') && trimmed.endsWith(']]')) {
                const noteText = trimmed.slice(2, -2).trim();
                htmlParts.push(`<div class="sp-note" data-element-type="note">${escapeHtml(noteText)}</div>`);
                prevLineBlank = false;
                continue;
            }

            // Scene heading
            if (/^[^\w\s.]*(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i.test(trimmed) || AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(trimmed)) {
                let headingText = stripEmphasisMarkers(AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(trimmed) ? trimmed.slice(1) : trimmed);
                // FILM-107: Extract scene number from #N# format
                let sceneNum = '';
                const sceneNumMatch = headingText.match(/\s+#([^#]+)#\s*$/);
                if (sceneNumMatch) {
                    sceneNum = sceneNumMatch[1];
                    headingText = headingText.replace(/\s+#[^#]+#\s*$/, '');
                }
                const sceneNumAttr = sceneNum ? ` data-scene-number="${escapeHtml(sceneNum)}"` : '';
                htmlParts.push(`<div class="sp-scene-heading" data-element-type="scene-heading"${sceneNumAttr}>${escapeHtml(headingText)}</div>`);
                prevLineBlank = true;
                inDialogue = false;
                continue;
            }

            // Centered (check before transition since both start with >)
            if (trimmed.startsWith('>') && trimmed.endsWith('<')) {
                const centeredText = trimmed.slice(1, -1).trim();
                htmlParts.push(`<div class="sp-centered" data-element-type="centered">${escapeHtml(centeredText)}</div>`);
                prevLineBlank = true;
                continue;
            }

            // Transition
            if (prevLineBlank && (/^[A-Z\s]+TO:$/.test(trimmed) || trimmed.startsWith('>'))) {
                const transitionText = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
                htmlParts.push(`<div class="sp-transition" data-element-type="transition">${escapeHtml(transitionText)}</div>`);
                prevLineBlank = true;
                inDialogue = false;
                continue;
            }

            // Dual dialogue character (ends with ^)
            if (prevLineBlank && trimmed.endsWith('^')) {
                const charText = trimmed.slice(0, -1).trim();
                htmlParts.push(`<div class="sp-character sp-dual-dialogue" data-element-type="dual-dialogue">${escapeHtml(charText)}</div>`);
                inDialogue = true;
                prevLineBlank = false;
                continue;
            }

            // Character (all caps, followed by dialogue)
            if (prevLineBlank && !nextBlank && /^[A-Z][A-Z\s\-'\.]+$/.test(trimmed.replace(/\s*\([^)]*\)\s*\^?$/, ''))) {
                htmlParts.push(`<div class="sp-character" data-element-type="character">${escapeHtml(trimmed)}</div>`);
                inDialogue = true;
                prevLineBlank = false;
                continue;
            }

            // Parenthetical
            if (inDialogue && /^\s*\([^)]+\)\s*$/.test(trimmed)) {
                htmlParts.push(`<div class="sp-parenthetical" data-element-type="parenthetical">${escapeHtml(trimmed)}</div>`);
                prevLineBlank = false;
                continue;
            }

            // Dialogue
            if (inDialogue) {
                htmlParts.push(`<div class="sp-dialogue" data-element-type="dialogue">${escapeHtml(trimmed)}</div>`);
                prevLineBlank = false;
                continue;
            }

            // Default: Action
            htmlParts.push(`<div class="sp-action" data-element-type="action">${escapeHtml(trimmed)}</div>`);
            prevLineBlank = false;
            inDialogue = false;
        }

        return htmlParts.join('\n');
    }

    /*
     * Empty blocks are 32px of nothing.
     *
     * A block with no text serialises to NOTHING — serializeElement opens with
     * `if (!text) return;` — but on screen it still costs its own line plus the
     * margin its type carries. Measured on a real document: the correct gap
     * between dialogue and the next character cue is 16px; one stale empty
     * block makes it 48, two make it 80, three make it 112. That is the "extra
     * space", and it disappeared whenever anything re-parsed the document and
     * rebuilt the editor, which is why it looked like it fixed itself.
     *
     * They accumulate because the browser leaves bare <div>s behind in a
     * contenteditable and onEditorInput used to adopt every one of them into a
     * block, empty or not.
     *
     * THE CARET IS THE EXCEPTION, and it is the whole safety of this: the block
     * you are typing into is empty because you have not typed yet. Removing it
     * would delete the line being written.
     *
     * Mirrors lib/screenplay-blocks.js, held in lockstep by
     * screenplay-empty-blocks.test.js — the SPA cannot require a node module
     * (build.target is single-html), and two rules that disagree is how a fix
     * survives in the tests and not on the screen.
     */
    const SP_KEEP_EMPTY = ['title-page'];

    /*
     * The editor's own furniture — inserted among the blocks, and not content.
     *
     * updateEditorStats() paginates at the TOP of onEditorInput, so by the time
     * the orphan-adoption loop runs the indicators are already sitting there
     * looking exactly like empty blocks: a <div> with a class, no element type,
     * no text. The loop adopted each into an empty `action` block — five per
     * keystroke — which were then counted as lines, inflating the page estimate,
     * which inserted more indicators, which became more empty blocks. That is
     * the space that grew the longer you typed.
     *
     * Mirrors FURNITURE_CLASSES in lib/screenplay-blocks.js.
     */
    const SP_FURNITURE = ['page-break-indicator'];

    function isEditorFurniture(node) {
        return !!(node && node.classList
            && SP_FURNITURE.some(c => node.classList.contains(c)));
    }

    function blockHoldsCaret(block) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return false;
        const node = sel.getRangeAt(0).startContainer;
        return !!node && block.contains(node);
    }

    function sweepEmptyBlocks(editor) {
        if (!editor) return 0;
        let removed = 0;
        for (const block of [...editor.children]) {
            const type = block.dataset && block.dataset.elementType;
            if (!type) continue;                                   // not a block
            if (SP_KEEP_EMPTY.includes(type)) continue;
            if (isEditorFurniture(block)) continue;
            if ((block.innerText || '').trim() !== '') continue;
            if (blockHoldsCaret(block)) continue;
            block.remove();
            removed++;
        }
        return removed;
    }

    /** A node's printable text — whitespace is not content in a screenplay. */
    function textOf(node) {
        return String((node && (node.innerText || node.textContent)) || '').trim();
    }

    /**
     * Leave the editor structurally sound, whatever just wrote to it.
     *
     * A screenplay is written and edited fourteen different ways — typing, the
     * AI writing into it, accepting a prose conversion, undo, redo, Enter,
     * reordering scenes, loading a version, rendering the Fountain, rewriting
     * the title page, changing an element's type. Only TYPING went through any
     * repair, and a programmatic DOM change does not fire `input`, so every
     * other path left whatever it made and waited for the writer's next
     * keystroke to tidy up. That is the reported bug one level up from where it
     * was fixed.
     *
     * Three jobs, in this order, because they depend on each other:
     *   1. leave the editor's own furniture alone — a page-break indicator is
     *      a <div> with a class, no element type and no text, which is exactly
     *      what an orphan looks like;
     *   2. adopt orphan TEXT into a block, and drop an orphan that has none;
     *   3. sweep any block that is empty and is not where the caret is.
     *
     * Idempotent: running it twice changes nothing the second time, which
     * matters because several of these paths call one another.
     */
    function normalizeEditor(editor) {
        const ed = editor || document.getElementById('screenplayEditor');
        if (!ed) return;
        // Every way the editor is written ends here, so the title-page card
        // cannot fall out of step with the block it describes.
        if (ed.id === 'screenplayEditor') renderTitlePageCard();

        const existingBlocks = ed.querySelectorAll('[data-element-type]:not([data-element-type="title-page"])');
        const defaultType = existingBlocks.length === 0 ? 'scene-heading' : 'action';

        for (const node of [...ed.childNodes]) {
            // The editor's own furniture is not an orphan.
            if (isEditorFurniture(node)) continue;
            if (node.nodeType === 1 && node.dataset && node.dataset.elementType) continue;

            if (node.nodeType === 3 && node.textContent.trim()) {
                const textLen = node.textContent.length;
                const block = createBlock(node.textContent, defaultType);
                ed.replaceChild(block, node);
                // Cursor at the END of what was typed, so typing continues.
                const range = document.createRange();
                const sel = window.getSelection();
                const textNode = block.firstChild || block;
                const offset = textNode.nodeType === 3 ? Math.min(textLen, textNode.length) : 0;
                range.setStart(textNode, offset);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
                const selector = document.getElementById('elementTypeSelector');
                if (selector) selector.value = defaultType;
            } else if (node.nodeType === 3) {
                // Whitespace between blocks. Not content, and it prints nothing.
                if (!node.textContent.trim()) node.remove();
            } else if (node.nodeType === 1 && !node.dataset.elementType) {
                /*
                 * A bare <div> the browser left behind. Adopting it when it has
                 * NO TEXT is what manufactured the empty blocks: 32px of layout
                 * that writes nothing to the Fountain. Unless the caret is in
                 * it, in which case it becomes a real block so the cursor
                 * survives.
                 */
                const text = textOf(node);
                if (!text && !blockHoldsCaret(node)) { node.remove(); continue; }
                const block = createBlock(text, defaultType);
                ed.replaceChild(block, node);
                if (!text) setCursorToBlock(block);
            }
        }

        // Anything still empty and not under the caret is 32px of nothing.
        sweepEmptyBlocks(ed);
    }

    function onEditorInput() {
        editorDirty = true;
        updateEditorStats();
        normalizeEditor(document.getElementById('screenplayEditor'));

        // FILM-101: Debounced auto-detection of element types
        if (autoDetectTimer) clearTimeout(autoDetectTimer);
        autoDetectTimer = setTimeout(() => {
            autoDetectElementType();
            triggerAutocomplete();
        }, AUTO_DETECT_DELAY);

        // FILM-103: Trigger autocomplete for character/location
        triggerAutocomplete();

        // FILM-105: Trigger undo capture
        triggerUndoCapture();

        // FILM-104: Trigger debounced auto-save
        triggerAutoSave();

        // FILM-106: Trigger scene navigator update
        triggerSceneNavUpdate();
    }

    // FILM-104: Debounced auto-save
    function triggerAutoSave() {
        // Mark as unsaved
        updateSaveStatus('unsaved');

        // Clear existing timer
        if (autoSaveTimer) clearTimeout(autoSaveTimer);

        // Set new timer
        autoSaveTimer = setTimeout(() => {
            performAutoSave();
        }, AUTO_SAVE_DELAY);
    }

    // Perform the actual auto-save
    async function performAutoSave() {
        if (!state.currentProject || !editorDirty) return;

        // Need a version to update
        if (!currentScriptVersion) {
            // No existing version - need to create a new one via POST
            await saveScreenplay();
            return;
        }

        updateSaveStatus('saving');

        try {
            const editor = document.getElementById('screenplayEditor');
            const fountainText = serializeEditorToFountain(editor);

            if (!fountainText.trim()) {
                updateSaveStatus('saved');
                return;
            }

            // refresh: false — this runs while somebody is typing, and
            // reloading the page would rebuild the editor under the caret.
            await api('/projects/' + state.currentProject.id + '/script/' + currentScriptVersion, {
               
                method: 'PUT',
                body: JSON.stringify({ fountain_content: fountainText })
            });

            editorDirty = false;
            currentFountainContent = fountainText;
            updateSaveStatus('saved');
        } catch (err) {
            console.error('Auto-save failed:', err);
            updateSaveStatus('unsaved');
            // Fall back to creating new version on next save
        }
    }

    // Update save status indicator
    function updateSaveStatus(status) {
        saveStatus = status;
        const indicator = document.getElementById('saveStatusIndicator');
        if (!indicator) return;

        switch (status) {
            case 'saving':
                indicator.textContent = 'Saving...';
                indicator.className = 'save-status saving';
                break;
            case 'saved':
                indicator.textContent = 'Saved';
                indicator.className = 'save-status saved';
                break;
            case 'unsaved':
                indicator.textContent = 'Unsaved';
                indicator.className = 'save-status unsaved';
                break;
        }
    }

    // FILM-105: Undo/Redo functions
    function captureEditorState() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return null;

        return {
            html: editor.innerHTML,
            cursor: getCursorPath(),
            timestamp: Date.now()
        };
    }

    function getCursorPath() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        const range = selection.getRangeAt(0);
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return null;

        // Build path from editor to cursor node
        function getNodePath(node) {
            const path = [];
            while (node && node !== editor) {
                const parent = node.parentNode;
                if (parent) {
                    const index = Array.from(parent.childNodes).indexOf(node);
                    path.unshift(index);
                }
                node = parent;
            }
            return path;
        }

        return {
            startPath: getNodePath(range.startContainer),
            startOffset: range.startOffset,
            endPath: getNodePath(range.endContainer),
            endOffset: range.endOffset,
            collapsed: range.collapsed
        };
    }

    function restoreCursorPath(cursorData) {
        if (!cursorData) return;

        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        function getNodeFromPath(path) {
            let node = editor;
            for (const index of path) {
                if (!node.childNodes || index >= node.childNodes.length) {
                    return null;
                }
                node = node.childNodes[index];
            }
            return node;
        }

        try {
            const startNode = getNodeFromPath(cursorData.startPath);
            const endNode = cursorData.collapsed ? startNode : getNodeFromPath(cursorData.endPath);

            if (startNode && endNode) {
                const range = document.createRange();
                const maxStartOffset = startNode.nodeType === Node.TEXT_NODE ?
                    startNode.textContent.length : startNode.childNodes.length;
                const maxEndOffset = endNode.nodeType === Node.TEXT_NODE ?
                    endNode.textContent.length : endNode.childNodes.length;

                range.setStart(startNode, Math.min(cursorData.startOffset, maxStartOffset));
                range.setEnd(endNode, Math.min(cursorData.endOffset, maxEndOffset));

                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
            }
        } catch (e) {
            // Cursor restoration failed - not critical
            console.warn('Cursor restoration failed:', e);
        }
    }

    function pushUndoState(forceNew = false) {
        const state = captureEditorState();
        if (!state) return;

        const now = Date.now();

        // If within debounce window and not forcing new entry, update current entry
        if (!forceNew && undoStack.length > 0 && (now - lastUndoTimestamp) < UNDO_DEBOUNCE_DELAY) {
            undoStack[undoStack.length - 1] = state;
        } else {
            // Push new entry
            undoStack.push(state);

            // Limit stack size
            while (undoStack.length > MAX_UNDO_ENTRIES) {
                undoStack.shift();
            }
        }

        lastUndoTimestamp = now;

        // Clear redo stack on new edit
        redoStack.length = 0;
    }

    function triggerUndoCapture(forceNew = false) {
        // Clear existing timer
        if (undoTimer) clearTimeout(undoTimer);

        // Debounce the capture
        undoTimer = setTimeout(() => {
            pushUndoState(forceNew);
        }, UNDO_DEBOUNCE_DELAY);
    }

    function editorUndo() {
        if (undoStack.length === 0) {
            setStatus('Nothing to undo');
            return;
        }

        // Push current state to redo stack
        const currentState = captureEditorState();
        if (currentState) {
            redoStack.push(currentState);
        }

        // Pop from undo stack
        const previousState = undoStack.pop();

        // Restore
        const editor = document.getElementById('screenplayEditor');
        if (editor && previousState) {
            editor.innerHTML = previousState.html;
            normalizeEditor();   // every way in leaves the editor sound
            restoreCursorPath(previousState.cursor);
            editorDirty = true;
            triggerAutoSave();
        }
    }

    function editorRedo() {
        if (redoStack.length === 0) {
            setStatus('Nothing to redo');
            return;
        }

        // Push current state to undo stack
        const currentState = captureEditorState();
        if (currentState) {
            undoStack.push(currentState);
        }

        // Pop from redo stack
        const nextState = redoStack.pop();

        // Restore
        const editor = document.getElementById('screenplayEditor');
        if (editor && nextState) {
            editor.innerHTML = nextState.html;
            normalizeEditor();   // every way in leaves the editor sound
            restoreCursorPath(nextState.cursor);
            editorDirty = true;
            triggerAutoSave();
        }
    }

    // Initialize undo stack with initial state when editor loads content
    function initUndoStack() {
        undoStack.length = 0;
        redoStack.length = 0;
        lastUndoTimestamp = 0;
        const initialState = captureEditorState();
        if (initialState) {
            undoStack.push(initialState);
        }
    }

    // FILM-101: Smart element type detection based on content
    function autoDetectElementType() {
        const block = getCurrentBlock();
        if (!block) return;

        const text = block.innerText.trim();
        if (!text) return;

        const currentType = block.dataset.elementType || 'action';
        let detectedType = null;

        // Check for forced element markers first
        //
        // STRUCTURE FIRST, and `centered` before `forcedTransition`: both open
        // with `>` and only the closing `<` tells them apart, so testing the
        // transition first would swallow every centered line.
        if (AUTO_FORMAT_RULES.patterns.centered.test(text)) {
            detectedType = 'centered';
        } else if (AUTO_FORMAT_RULES.patterns.section.test(text)) {
            detectedType = 'section';
        } else if (AUTO_FORMAT_RULES.patterns.synopsis.test(text)) {
            detectedType = 'synopsis';
        } else if (AUTO_FORMAT_RULES.patterns.lyrics.test(text)) {
            detectedType = 'lyrics';
        } else if (AUTO_FORMAT_RULES.patterns.note.test(text)) {
            detectedType = 'note';
        } else if (AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(text)) {
            detectedType = 'scene-heading';
        } else if (AUTO_FORMAT_RULES.patterns.forcedCharacter.test(text)) {
            detectedType = 'character';
        } else if (AUTO_FORMAT_RULES.patterns.forcedTransition.test(text)) {
            detectedType = 'transition';
        } else if (AUTO_FORMAT_RULES.patterns.forcedAction.test(text)) {
            detectedType = 'action';
        }
        // Check for scene heading (INT./EXT.)
        else if (AUTO_FORMAT_RULES.patterns.sceneHeading.test(text)) {
            detectedType = 'scene-heading';
        }
        // Check for transition (ALL CAPS ending with :)
        else if (AUTO_FORMAT_RULES.patterns.transition.test(text) && text.length > 3) {
            detectedType = 'transition';
        }
        // Check for parenthetical
        else if (AUTO_FORMAT_RULES.patterns.parenthetical.test(text) && currentType === 'dialogue') {
            detectedType = 'parenthetical';
        }
        // Check for known character name (all caps, matches state.characters)
        else if (isKnownCharacter(text)) {
            detectedType = 'character';
        }

        // Apply detected type if different and makes sense
        if (detectedType && detectedType !== currentType) {
            // Show suggestion indicator (visual hint)
            showAutoDetectSuggestion(block, detectedType);
        }
    }

    // Check if text matches a known character name
    function isKnownCharacter(text) {
        // Must be all caps (allowing spaces, hyphens, periods)
        const cleanText = text.replace(/\s*\([^)]*\)\s*$/, '').trim(); // Remove extensions like (V.O.)
        if (!/^[A-Z][A-Z\s\-'\.]+$/.test(cleanText)) return false;

        // Check against known characters from state
        if (state.characters && state.characters.length > 0) {
            const upperText = cleanText.toUpperCase();
            return state.characters.some(char => {
                const charName = (char.name || '').toUpperCase();
                return charName === upperText || charName.startsWith(upperText);
            });
        }

        // If no characters loaded yet, consider it a potential character
        // if it's all caps and not a transition pattern
        return cleanText.length >= 2 && cleanText.length <= 30 && !cleanText.endsWith(':');
    }

    // Show visual hint for auto-detected element type
    function showAutoDetectSuggestion(block, suggestedType) {
        // Remove any existing suggestion indicator
        const existingHint = block.querySelector('.auto-detect-hint');
        if (existingHint) existingHint.remove();

        // Add suggestion class to block
        block.classList.add('has-suggestion');
        block.dataset.suggestedType = suggestedType;

        // Create hint element
        const hint = document.createElement('span');
        hint.className = 'auto-detect-hint';
        hint.textContent = suggestedType.replace('-', ' ');
        hint.title = 'Press Tab to accept';
        hint.onclick = (e) => {
            e.stopPropagation();
            acceptAutoDetectSuggestion(block);
        };
        block.appendChild(hint);
    }

    // Accept the auto-detected suggestion
    function acceptAutoDetectSuggestion(block) {
        const suggestedType = block.dataset.suggestedType;
        if (suggestedType) {
            setBlockElementType(block, suggestedType);
            clearAutoDetectSuggestion(block);
            // Update dropdown
            const selector = document.getElementById('elementTypeSelector');
            if (selector) selector.value = suggestedType;
        }
    }

    // Clear auto-detect suggestion
    function clearAutoDetectSuggestion(block) {
        if (!block) return;
        block.classList.remove('has-suggestion');
        delete block.dataset.suggestedType;
        const hint = block.querySelector('.auto-detect-hint');
        if (hint) hint.remove();
    }

    // FILM-103: Autocomplete for character names and locations
    function triggerAutocomplete() {
        const block = getCurrentBlock();
        if (!block) {
            hideAutocomplete();
            return;
        }

        const text = block.innerText.trim();
        const elementType = block.dataset.suggestedType || block.dataset.elementType || 'action';

        // Character autocomplete
        if (elementType === 'character' && text.length >= 1) {
            const matches = filterCharacters(text);
            if (matches.length > 0) {
                showAutocomplete(matches, 'character');
                return;
            }
        }

        // Location autocomplete for scene headings
        if (elementType === 'scene-heading' && text.length >= 4) {
            const locationPart = extractLocationFromSceneHeading(text);
            if (locationPart && locationPart.length >= 1) {
                const matches = filterLocations(locationPart);
                if (matches.length > 0) {
                    showAutocomplete(matches, 'location');
                    return;
                }
            }
        }

        hideAutocomplete();
    }

    // Filter characters by partial match
    function filterCharacters(partial) {
        const upperPartial = partial.toUpperCase();
        const results = [];
        const knownNames = new Set();

        // Add known characters from state
        if (state.characters && state.characters.length > 0) {
            for (const char of state.characters) {
                const name = (char.name || '').toUpperCase();
                if (name.startsWith(upperPartial) || name.includes(upperPartial)) {
                    results.push({
                        text: name,
                        type: 'known',
                        id: char.id,
                        description: char.role || ''
                    });
                    knownNames.add(name);
                }
            }
        }

        // Collect unrecognized characters from the screenplay
        const editor = document.getElementById('screenplayEditor');
        const charBlocks = editor.querySelectorAll('[data-element-type="character"]');
        for (const block of charBlocks) {
            const name = block.innerText.trim().toUpperCase().replace(/\s*\([^)]*\)\s*$/, '');
            if (name && !knownNames.has(name) && (name.startsWith(upperPartial) || name.includes(upperPartial))) {
                if (!results.find(r => r.text === name)) {
                    results.push({
                        text: name,
                        type: 'unrecognized',
                        description: 'Not in character list'
                    });
                }
            }
        }

        // Sort: known first, then by match position
        results.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'known' ? -1 : 1;
            const aStarts = a.text.startsWith(upperPartial);
            const bStarts = b.text.startsWith(upperPartial);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return a.text.localeCompare(b.text);
        });

        return results.slice(0, 8); // Limit results
    }

    // Extract location part from scene heading (after INT./EXT.)
    function extractLocationFromSceneHeading(text) {
        const match = text.match(/^[^\w\s.]*(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]+(.*)$/i);
        if (match) {
            let location = match[2];
            const timeMatch = location.match(/^(.*?)\s*[-–—]\s*(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|LATER|EARLIER|CONTINUOUS|SAME|MOMENTS LATER|THE NEXT DAY|SUNRISE|SUNSET)$/i);
            if (timeMatch) {
                location = timeMatch[1];
            }
            return location.trim();
        }
        return null;
    }

    // Filter locations by partial match
    function filterLocations(partial) {
        const upperPartial = partial.toUpperCase();
        const results = [];
        const knownLocs = new Set();

        // Add known locations from state
        if (state.locations && state.locations.length > 0) {
            for (const loc of state.locations) {
                const name = (loc.name || '').toUpperCase();
                if (name.startsWith(upperPartial) || name.includes(upperPartial)) {
                    results.push({
                        text: name,
                        type: 'known',
                        id: loc.id,
                        description: loc.type || ''
                    });
                    knownLocs.add(name);
                }
            }
        }

        // Collect unrecognized locations from screenplay
        const editor = document.getElementById('screenplayEditor');
        const sceneBlocks = editor.querySelectorAll('[data-element-type="scene-heading"]');
        for (const block of sceneBlocks) {
            const loc = extractLocationFromSceneHeading(block.innerText.trim());
            if (loc) {
                const name = loc.toUpperCase();
                if (!knownLocs.has(name) && (name.startsWith(upperPartial) || name.includes(upperPartial))) {
                    if (!results.find(r => r.text === name)) {
                        results.push({
                            text: name,
                            type: 'unrecognized',
                            description: 'Not in location list'
                        });
                    }
                }
            }
        }

        results.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'known' ? -1 : 1;
            const aStarts = a.text.startsWith(upperPartial);
            const bStarts = b.text.startsWith(upperPartial);
            if (aStarts !== bStarts) return aStarts ? -1 : 1;
            return a.text.localeCompare(b.text);
        });

        return results.slice(0, 8);
    }

    // Show autocomplete dropdown
    function showAutocomplete(items, type) {
        autocompleteItems = items;
        autocompleteType = type;
        autocompleteSelectedIndex = 0;
        autocompleteVisible = true;

        let dropdown = document.getElementById('autocompleteDropdown');
        if (!dropdown) {
            dropdown = document.createElement('div');
            dropdown.id = 'autocompleteDropdown';
            dropdown.className = 'autocomplete-dropdown';
            document.body.appendChild(dropdown);
        }

        // Render items
        dropdown.innerHTML = items.map((item, i) => `
            <div class="autocomplete-item ${i === autocompleteSelectedIndex ? 'selected' : ''} ${item.type}"
                 data-index="${i}"
                 onmousedown="selectAutocompleteItem(${i})">
                <span class="autocomplete-text">${escapeHtml(item.text)}</span>
                ${item.description ? `<span class="autocomplete-desc">${escapeHtml(item.description)}</span>` : ''}
                ${item.type === 'unrecognized' ? `<span class="autocomplete-action" onmousedown="event.preventDefault(); event.stopPropagation(); createFromAutocomplete(${i})">+ Create</span>` : ''}
            </div>
        `).join('');

        // Position below cursor
        positionAutocomplete(dropdown);
        dropdown.style.display = 'block';
    }

    // Position autocomplete dropdown below cursor
    function positionAutocomplete(dropdown) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        dropdown.style.position = 'fixed';
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 4) + 'px';

        // Ensure it doesn't go off screen
        const dropdownRect = dropdown.getBoundingClientRect();
        if (dropdownRect.right > window.innerWidth) {
            dropdown.style.left = (window.innerWidth - dropdownRect.width - 10) + 'px';
        }
        if (dropdownRect.bottom > window.innerHeight) {
            dropdown.style.top = (rect.top - dropdownRect.height - 4) + 'px';
        }
    }

    // Hide autocomplete dropdown
    function hideAutocomplete() {
        autocompleteVisible = false;
        autocompleteItems = [];
        const dropdown = document.getElementById('autocompleteDropdown');
        if (dropdown) {
            dropdown.style.display = 'none';
        }
    }

    // Select autocomplete item
    function selectAutocompleteItem(index) {
        if (index < 0 || index >= autocompleteItems.length) return;

        const item = autocompleteItems[index];
        const block = getCurrentBlock();
        if (!block) return;

        if (autocompleteType === 'character') {
            // Replace entire block text with character name
            block.innerText = item.text;
            setCursorToEnd(block);
        } else if (autocompleteType === 'location') {
            // Replace location part in scene heading
            const text = block.innerText.trim();
            const match = text.match(/^([^\w\s.]*)(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]+/i);
            if (match) {
                // Check if there was a time of day
                const timeMatch = text.match(/\s+-\s+(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|LATER|EARLIER|CONTINUOUS|SAME|MOMENTS LATER|THE NEXT DAY|SUNRISE|SUNSET)$/i);
                const newText = match[0] + item.text + (timeMatch ? timeMatch[0] : '');
                block.innerText = newText;
                setCursorToEnd(block);
            }
        }

        hideAutocomplete();
        editorDirty = true;
    }

    function applyAutocompleteItemToBlock(item, type, block) {
        if (!block) return;

        if (type === 'character') {
            block.innerText = item.text;
            setCursorToEnd(block);
        } else if (type === 'location') {
            const text = block.innerText.trim();
            const match = text.match(/^([^\w\s.]*)(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]+/i);
            if (match) {
                const timeMatch = text.match(/\s+-\s+(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|LATER|EARLIER|CONTINUOUS|SAME|MOMENTS LATER|THE NEXT DAY|SUNRISE|SUNSET)$/i);
                block.innerText = match[0] + item.text + (timeMatch ? timeMatch[0] : '');
                setCursorToEnd(block);
            }
        }

        editorDirty = true;
    }

    // Create new character/location from autocomplete
    async function createFromAutocomplete(index) {
        const item = autocompleteItems[index];
        if (!item || item.type !== 'unrecognized') return;
        if (!state.currentProject) {
            setStatus('Select a project before creating screenplay entities');
            return;
        }

        const type = autocompleteType;
        const block = getCurrentBlock();
        const name = item.text.trim();
        if (!name) return;

        try {
            if (type === 'character') {
                await api(`/projects/${state.currentProject.id}/characters`, {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        personality_notes: 'Created from screenplay autocomplete'
                    })
                });
                await loadCharacters();
                setStatus(`Character created: ${name}`);
            } else if (type === 'location') {
                await api(`/projects/${state.currentProject.id}/locations`, {
                    method: 'POST',
                    body: JSON.stringify({
                        name,
                        description: 'Created from screenplay autocomplete'
                    })
                });
                await loadLocations();
                setStatus(`Location created: ${name}`);
            }

            applyAutocompleteItemToBlock(item, type, block);
            hideAutocomplete();
            checkScreenplaySuggestions();
        } catch (err) {
            setStatus('Error creating ' + type + ': ' + err.message);
        }
    }

    // Move cursor to end of element
    function setCursorToEnd(element) {
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // Navigate autocomplete with arrow keys
    function navigateAutocomplete(direction) {
        if (!autocompleteVisible || autocompleteItems.length === 0) return false;

        if (direction === 'up') {
            autocompleteSelectedIndex = Math.max(0, autocompleteSelectedIndex - 1);
        } else if (direction === 'down') {
            autocompleteSelectedIndex = Math.min(autocompleteItems.length - 1, autocompleteSelectedIndex + 1);
        }

        // Update UI
        const dropdown = document.getElementById('autocompleteDropdown');
        if (dropdown) {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            items.forEach((item, i) => {
                item.classList.toggle('selected', i === autocompleteSelectedIndex);
            });
            // Scroll into view
            items[autocompleteSelectedIndex]?.scrollIntoView({ block: 'nearest' });
        }

        return true;
    }

    // FILM-110: Update element type dropdown and toolbar state when selection changes
    function onEditorSelectionChange() {
        const block = getCurrentBlock();
        if (block) {
            const elementType = block.dataset.elementType || 'action';
            const selector = document.getElementById('elementTypeSelector');
            if (selector) {
                selector.value = elementType;
            }
            // Update current scene display
            updateCurrentSceneDisplay(block);
            // FILM-106: Update scene navigator highlight
            updateCurrentSceneHighlight();
            // FILM-110: Update character count and speaking character
            updateBlockStatusInfo(block, elementType);
        }
    }

    // FILM-110: Update scene number display based on current position
    function updateCurrentSceneDisplay(block) {
        const editor = document.getElementById('screenplayEditor');
        const sceneDisplay = document.getElementById('currentSceneNum');
        if (!editor || !sceneDisplay) return;

        // Find the nearest scene heading above current block
        let sceneNum = 0;
        let sceneHeading = null;
        const blocks = editor.querySelectorAll('[data-element-type]');
        for (const b of blocks) {
            if (b.dataset.elementType === 'scene-heading') {
                sceneNum++;
                sceneHeading = b;
            }
            if (b === block) break;
        }

        // Use scene number from data attribute if available (FILM-107)
        if (sceneHeading && sceneHeading.dataset.sceneNumber) {
            sceneDisplay.textContent = `Scene: #${sceneHeading.dataset.sceneNumber}`;
        } else {
            sceneDisplay.textContent = sceneNum > 0 ? `Scene: ${sceneNum}` : 'Scene: —';
        }
    }

    // FILM-110: Update block status info (character count, speaking character)
    function updateBlockStatusInfo(block, elementType) {
        // Get or create status info element
        let statusInfo = document.getElementById('blockStatusInfo');
        if (!statusInfo) {
            // Create status info element in toolbar
            const toolbar = document.querySelector('.screenplay-toolbar');
            if (toolbar) {
                const divider = document.createElement('div');
                divider.className = 'toolbar-divider';
                statusInfo = document.createElement('span');
                statusInfo.id = 'blockStatusInfo';
                statusInfo.style.cssText = 'font-size:10px;color:var(--gl-text-muted);';
                toolbar.insertBefore(divider, toolbar.querySelector('.save-status'));
                toolbar.insertBefore(statusInfo, toolbar.querySelector('.save-status'));
            }
        }

        if (!statusInfo) return;

        // Get block text (excluding gutter elements)
        let text = '';
        for (const child of block.childNodes) {
            if (child.nodeType === Node.TEXT_NODE) {
                text += child.textContent;
            } else if (child.nodeType === Node.ELEMENT_NODE &&
                       !child.classList.contains('scene-number-gutter')) {
                text += child.innerText || '';
            }
        }
        const charCount = text.length;

        // Build status info
        let info = `${charCount} chars`;

        // If in dialogue/parenthetical, show speaking character
        if (elementType === 'dialogue' || elementType === 'parenthetical') {
            const speakingChar = findSpeakingCharacter(block);
            if (speakingChar) {
                info = `${speakingChar}: ${charCount} chars`;
            }
        }

        statusInfo.textContent = info;
    }

    // FILM-110: Find the speaking character for a dialogue block
    function findSpeakingCharacter(block) {
        let sibling = block.previousElementSibling;
        while (sibling) {
            const type = sibling.dataset?.elementType;
            if (type === 'character' || type === 'dual-dialogue') {
                // Get character name (excluding extensions)
                let name = sibling.innerText.trim();
                name = name.replace(/\s*\([^)]*\)\s*$/, ''); // Remove (V.O.) etc.
                return name.toUpperCase();
            }
            if (type === 'scene-heading' || type === 'action' || type === 'transition') {
                break; // Stop at non-dialogue elements
            }
            sibling = sibling.previousElementSibling;
        }
        return null;
    }

    // FILM-115: Get the Fountain text for the scene the cursor is currently in
    function getCurrentSceneFountain() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return '';

        const currentBlock = getCurrentBlock();
        if (!currentBlock) return '';

        // Get all blocks
        const allBlocks = Array.from(editor.querySelectorAll('[data-element-type]'));
        const currentIndex = allBlocks.indexOf(currentBlock);
        if (currentIndex === -1) return '';

        // Find the scene heading before current position
        let sceneStartIndex = -1;
        for (let i = currentIndex; i >= 0; i--) {
            if (allBlocks[i].dataset.elementType === 'scene-heading') {
                sceneStartIndex = i;
                break;
            }
        }

        // If no scene heading found, start from beginning
        if (sceneStartIndex === -1) sceneStartIndex = 0;

        // Find the next scene heading (or end of document)
        let sceneEndIndex = allBlocks.length;
        for (let i = sceneStartIndex + 1; i < allBlocks.length; i++) {
            if (allBlocks[i].dataset.elementType === 'scene-heading') {
                sceneEndIndex = i;
                break;
            }
        }

        // Extract blocks for this scene
        const sceneBlocks = allBlocks.slice(sceneStartIndex, sceneEndIndex);
        if (sceneBlocks.length === 0) return '';

        // Serialize to Fountain format
        const lines = [];
        let prevType = null;

        for (const block of sceneBlocks) {
            const type = block.dataset.elementType;
            let text = '';
            for (const child of block.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE &&
                           !child.classList.contains('scene-number-gutter')) {
                    text += child.innerText || '';
                }
            }
            text = text.trim();
            if (!text) continue;

            switch (type) {
                case 'scene-heading':
                    const hasPrefix = /^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i.test(text);
                    lines.push(hasPrefix ? text.toUpperCase() : '.' + text.toUpperCase());
                    break;
                case 'character':
                    lines.push('', text.toUpperCase());
                    break;
                case 'dialogue':
                    lines.push(text);
                    break;
                case 'parenthetical':
                    lines.push(text.startsWith('(') ? text : '(' + text + ')');
                    break;
                case 'transition':
                    lines.push('', text.endsWith(':') ? text.toUpperCase() : '> ' + text.toUpperCase());
                    break;
                case 'action':
                default:
                    if (prevType !== 'action' && prevType !== null && prevType !== 'scene-heading') {
                        lines.push('');
                    }
                    lines.push(text);
                    break;
            }
            prevType = type;
        }

        return lines.join('\n').trim();
    }

    function twBurst(ctx, at, { freq = 2600, q = 1.2, dur = 0.035, gain = 0.5 }) {
        const src = ctx.createBufferSource(); src.buffer = TYPEWRITER.noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
        src.connect(bp).connect(g).connect(ctx.destination);
        src.start(at, Math.random() * 0.2); src.stop(at + dur + 0.01);
    }

    function twThump(ctx, at, { freq = 140, dur = 0.06, gain = 0.35 }) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(freq, at); o.frequency.exponentialRampToValueAtTime(freq * 0.5, at + dur);
        const g = ctx.createGain();
        g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0008, at + dur);
        o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + dur + 0.01);
    }

    function twBell(ctx, at) {
        for (const [f, gain] of [[2093, 0.18], [4186, 0.05]]) {
            const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
            const g = ctx.createGain();
            g.gain.setValueAtTime(gain, at); g.gain.exponentialRampToValueAtTime(0.0008, at + 1.1);
            o.connect(g).connect(ctx.destination); o.start(at); o.stop(at + 1.15);
        }
    }

    /** One key's sound, or none: modifiers, shortcuts and arrows stay silent. */
    function typewriterKey(event) {
        if (!TYPEWRITER.on() || event.ctrlKey || event.metaKey || event.altKey) return;
        const k = event.key || '';
        const printable = k.length === 1;
        if (!printable && !['Enter', 'Backspace', 'Tab', 'Delete'].includes(k)) return;
        const ctx = TYPEWRITER.audio();
        if (!ctx) return;
        const now = ctx.currentTime;
        if (now - TYPEWRITER.last < 0.025) return;   // a held key is a rattle, not a roar
        TYPEWRITER.last = now;
        const vary = 0.85 + Math.random() * 0.3;
        if (k === 'Enter') {
            for (let i = 0; i < 6; i++) twBurst(ctx, now + i * 0.03, { freq: 1800 * vary, dur: 0.02, gain: 0.18 });
            twThump(ctx, now + 0.2, { freq: 90, dur: 0.12, gain: 0.4 });
            twBell(ctx, now + 0.02);
        } else if (k === ' ') {
            twThump(ctx, now, { freq: 110 * vary, dur: 0.08, gain: 0.3 });
            twBurst(ctx, now, { freq: 1200 * vary, dur: 0.03, gain: 0.15 });
        } else if (k === 'Backspace' || k === 'Delete') {
            twBurst(ctx, now, { freq: 3400 * vary, dur: 0.02, gain: 0.22 });
        } else {
            twBurst(ctx, now, { freq: 2600 * vary, dur: 0.035, gain: 0.45 });
            twThump(ctx, now + 0.004, { freq: 160 * vary, dur: 0.05, gain: 0.28 });
        }
        if (document.body.classList.contains('sp-focus')) setTimeout(focusWordCount, 50);
    }

    function toggleTypewriterSound() {
        TYPEWRITER.set(!TYPEWRITER.on());
        if (TYPEWRITER.on()) TYPEWRITER.audio();
        typewriterButtons();
        const ed = document.getElementById('screenplayEditor');
        if (ed && document.body.classList.contains('sp-focus')) ed.focus();
    }

    function onEditorKeydown(event) {
        const isMod = event.ctrlKey || event.metaKey;
        if (isMod && event.shiftKey && (event.key === 'f' || event.key === 'F')) {
            event.preventDefault(); toggleWriterFocus(); return;
        }
        if (event.key === 'Escape' && document.body.classList.contains('sp-focus')) {
            event.preventDefault(); toggleWriterFocus(false); return;
        }
        typewriterKey(event);

        // FILM-102: Keyboard shortcuts with Ctrl/Cmd modifier
        if (isMod) {
            // Ctrl/Cmd + S to save
            if (event.key === 's') {
                event.preventDefault();
                saveScreenplay();
                return;
            }

            // FILM-105: Ctrl/Cmd + Z for undo, Ctrl/Cmd + Shift + Z for redo
            if (event.key === 'z' || event.key === 'Z') {
                event.preventDefault();
                if (event.shiftKey) {
                    editorRedo();
                } else {
                    editorUndo();
                }
                return;
            }

            // Ctrl/Cmd + Y for redo (alternative)
            if (event.key === 'y') {
                event.preventDefault();
                editorRedo();
                return;
            }

            // FILM-106: Ctrl/Cmd + Shift + O for scene navigator
            if ((event.key === 'o' || event.key === 'O') && event.shiftKey) {
                event.preventDefault();
                toggleSceneNavigator();
                return;
            }

            // FILM-111: Ctrl/Cmd + Shift + A for AI chat
            if ((event.key === 'a' || event.key === 'A') && event.shiftKey) {
                event.preventDefault();
                if (window.__filmOpenAIWorkspace) window.__filmOpenAIWorkspace();
                else toggleAIChat();
                return;
            }

            // Ctrl/Cmd + / or ? to toggle shortcut help
            if (event.key === '/' || event.key === '?') {
                event.preventDefault();
                toggleShortcutHelp();
                return;
            }

            // Ctrl/Cmd + B/I/U for formatting
            if (event.key === 'b') {
                event.preventDefault();
                document.execCommand('bold');
                return;
            }
            if (event.key === 'i') {
                event.preventDefault();
                document.execCommand('italic');
                return;
            }
            if (event.key === 'u') {
                event.preventDefault();
                document.execCommand('underline');
                return;
            }

            // Ctrl/Cmd + 1-9 for element types
            if (KEYBOARD_SHORTCUTS[event.key]) {
                event.preventDefault();
                const shortcut = KEYBOARD_SHORTCUTS[event.key];
                const block = getCurrentBlock();
                if (block) {
                    // FILM-109: Special handling for dual dialogue
                    if (shortcut.type === 'dual-dialogue') {
                        toggleDualDialogue(block);
                    } else {
                        setBlockElementType(block, shortcut.type);
                    }
                    clearAutoDetectSuggestion(block);
                    const selector = document.getElementById('elementTypeSelector');
                    if (selector) selector.value = shortcut.type;
                    setStatus(`Element: ${shortcut.label}`);
                }
                return;
            }
        }

        // FILM-103: Arrow keys for autocomplete navigation
        if (autocompleteVisible && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            navigateAutocomplete(event.key === 'ArrowUp' ? 'up' : 'down');
            return;
        }

        // Escape key: close autocomplete, help, or clear suggestion
        if (event.key === 'Escape') {
            if (autocompleteVisible) {
                hideAutocomplete();
                return;
            }
            if (shortcutHelpVisible) {
                toggleShortcutHelp();
                return;
            }
            const block = getCurrentBlock();
            if (block && block.dataset.suggestedType) {
                clearAutoDetectSuggestion(block);
                return;
            }
        }

        // Tab key: select autocomplete, accept suggestion, or cycle element type
        if (event.key === 'Tab') {
            event.preventDefault();

            // FILM-103: Select autocomplete item if visible
            if (autocompleteVisible && autocompleteItems.length > 0) {
                selectAutocompleteItem(autocompleteSelectedIndex);
                return;
            }

            const block = getCurrentBlock();
            if (block) {
                // If there's a suggestion, accept it
                if (block.dataset.suggestedType) {
                    acceptAutoDetectSuggestion(block);
                    return;
                }

                // Otherwise, cycle through types based on context
                const currentType = block.dataset.elementType || 'action';
                const cycle = getContextualTabCycle(block, currentType);
                const currentIndex = cycle.indexOf(currentType);
                const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % cycle.length : 0;
                setBlockElementType(block, cycle[nextIndex]);
                clearAutoDetectSuggestion(block);
                // Update dropdown
                const selector = document.getElementById('elementTypeSelector');
                if (selector) selector.value = cycle[nextIndex];
            }
            return;
        }

        // Enter key: select autocomplete or handle block creation
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();

            // FILM-103: Select autocomplete item if visible
            if (autocompleteVisible && autocompleteItems.length > 0) {
                selectAutocompleteItem(autocompleteSelectedIndex);
                return;
            }

            const block = getCurrentBlock();

            // Clear any pending auto-detect
            if (autoDetectTimer) clearTimeout(autoDetectTimer);

            if (!block) {
                // No block - create first one (scene-heading by default)
                const editor = document.getElementById('screenplayEditor');
                const existingBlocks = editor.querySelectorAll('[data-element-type]:not([data-element-type="title-page"])');
                const defaultType = existingBlocks.length === 0 ? 'scene-heading' : 'action';
                const newBlock = createBlock('', defaultType);
                editor.appendChild(newBlock);
                normalizeEditor();   // every way in leaves the editor sound
                setCursorToBlock(newBlock);
                return;
            }

            // If there's a suggestion, apply it first
            if (block.dataset.suggestedType) {
                const suggestedType = block.dataset.suggestedType;
                setBlockElementType(block, suggestedType);
                clearAutoDetectSuggestion(block);
            }

            // Get text (excluding any hint elements)
            const hint = block.querySelector('.auto-detect-hint');
            if (hint) hint.remove();
            const text = block.innerText.trim();
            const currentType = block.dataset.elementType || 'action';

            // Apply immediate auto-detection for undetected types
            const detectedType = detectElementTypeImmediate(text, currentType);
            if (detectedType && detectedType !== currentType) {
                setBlockElementType(block, detectedType);
            }

            const finalType = block.dataset.elementType || 'action';

            if (text === '') {
                // Empty block: use emptyLineType rules
                const emptyType = AUTO_FORMAT_RULES.emptyLineType[finalType] || 'action';
                if (emptyType !== finalType) {
                    setBlockElementType(block, emptyType);
                    const selector = document.getElementById('elementTypeSelector');
                    if (selector) selector.value = emptyType;
                }
            } else {
                // Split at the caret rather than always appending.
                //
                // Enter used to create an empty block and move the cursor there
                // regardless of caret position, so pressing it mid-paragraph
                // left the text untouched and dumped you at the end — you could
                // never break a line in the middle of a block.
                const tail = extractTextAfterCaret(block);

                // A mid-block split produces two of the same element: breaking
                // an action paragraph gives two action paragraphs. Only a split
                // at the very end advances to the next type, which is what
                // "finished this line, now write the next thing" means.
                const nextType = tail
                    ? finalType
                    : (AUTO_FORMAT_RULES.nextType[finalType] || 'action');

                const newBlock = createBlock(tail || '', nextType);
                block.parentNode.insertBefore(newBlock, block.nextSibling);
                // setCursorToBlock collapses to the start, which is right for
                // both cases: before the moved tail on a split, and in the
                // empty block otherwise.
                setCursorToBlock(newBlock);
                // Update dropdown
                const selector = document.getElementById('elementTypeSelector');
                if (selector) selector.value = nextType;
            }
            return;
        }
    }

    /**
     * Remove and return the text after the caret in a block.
     *
     * Returns '' when the caret is at the end, which is the common case and
     * keeps the "start a new element" behaviour intact. Reads the caret from
     * the live selection, so it reflects where the user actually is rather
     * than assuming the end of the block.
     */
    function extractTextAfterCaret(block) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return '';

        const range = sel.getRangeAt(0);
        if (!block.contains(range.startContainer)) return '';

        // Everything from the caret to the end of the block.
        const tailRange = document.createRange();
        tailRange.setStart(range.endContainer, range.endOffset);
        tailRange.setEndAfter(block.lastChild || block);

        const tail = tailRange.toString();
        if (!tail.trim()) return '';

        // Remove it from the original block, leaving the head behind.
        tailRange.deleteContents();
        return tail;
    }

    // Get context-aware Tab cycle based on current position
    function getContextualTabCycle(block, currentType) {
        // If in dialogue context, use dialogue cycle
        if (['dialogue', 'parenthetical'].includes(currentType)) {
            return AUTO_FORMAT_RULES.tabCycles['in-dialogue'];
        }

        // Check if we're right after a scene heading
        /*
         * Skip the page-break indicator: it is a divider, not a block.
         *
         * Every other sibling walk in this editor tests for a TYPE and so steps
         * over it harmlessly. This one reads the immediate sibling's type
         * directly, so a break landing between a scene heading and this block
         * made Tab behave as though there were no heading above it — the same
         * family of bug as the page breaking between a cue and its dialogue,
         * and invisible in the same way.
         */
        let prevBlock = block.previousElementSibling;
        while (prevBlock && prevBlock.classList.contains('page-break-indicator')) {
            prevBlock = prevBlock.previousElementSibling;
        }
        if (prevBlock && prevBlock.dataset.elementType === 'scene-heading') {
            return AUTO_FORMAT_RULES.tabCycles['after-scene'];
        }

        return AUTO_FORMAT_RULES.tabCycles['default'];
    }

    // Immediate element type detection (called on Enter, no debounce)
    function detectElementTypeImmediate(text, currentType) {
        if (!text) return null;

        // Structure first, and `centered` before `forcedTransition`: both open
        // with `>` and only the closing `<` separates them. Kept in the same
        // order as autoDetectElementType, because two classifiers that disagree
        // about what a line is are worse than one that is wrong.
        if (AUTO_FORMAT_RULES.patterns.centered.test(text)) return 'centered';
        if (AUTO_FORMAT_RULES.patterns.section.test(text)) return 'section';
        if (AUTO_FORMAT_RULES.patterns.synopsis.test(text)) return 'synopsis';
        if (AUTO_FORMAT_RULES.patterns.lyrics.test(text)) return 'lyrics';
        if (AUTO_FORMAT_RULES.patterns.note.test(text)) return 'note';

        // Check for forced element markers
        if (AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(text)) {
            return 'scene-heading';
        }
        if (AUTO_FORMAT_RULES.patterns.forcedCharacter.test(text)) {
            return 'character';
        }
        if (AUTO_FORMAT_RULES.patterns.forcedTransition.test(text)) {
            return 'transition';
        }

        // Check for scene heading
        if (AUTO_FORMAT_RULES.patterns.sceneHeading.test(text)) {
            return 'scene-heading';
        }

        // Check for transition (ALL CAPS ending with :)
        if (AUTO_FORMAT_RULES.patterns.transition.test(text) && text.length > 3) {
            return 'transition';
        }

        // Check for parenthetical in dialogue context
        if (AUTO_FORMAT_RULES.patterns.parenthetical.test(text) &&
            ['dialogue', 'character'].includes(currentType)) {
            return 'parenthetical';
        }

        // Check for character (all caps, reasonable length)
        if (currentType === 'action' && isKnownCharacter(text)) {
            return 'character';
        }

        return null;
    }

    // Get the current block element containing the cursor
    function getCurrentBlock() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return null;

        let node = selection.anchorNode;
        if (!node) return null;

        // Walk up to find a block with data-element-type
        while (node && node !== document.getElementById('screenplayEditor')) {
            if (node.nodeType === 1 && node.dataset && node.dataset.elementType) {
                return node;
            }
            node = node.parentNode;
        }

        // If no block found, look for any direct child div
        const editor = document.getElementById('screenplayEditor');
        node = selection.anchorNode;
        while (node && node.parentNode !== editor) {
            node = node.parentNode;
        }
        return (node && node.nodeType === 1) ? node : null;
    }

    // Create a new block element with the given text and type
    function createBlock(text, elementType) {
        const block = document.createElement('div');
        block.dataset.elementType = elementType;
        block.className = 'sp-' + elementType;
        if (text) {
            block.innerText = text;
        } else {
            // Empty blocks need a <br> to maintain height and accept cursor
            block.appendChild(document.createElement('br'));
        }
        // Ensure block is focusable
        block.setAttribute('contenteditable', 'true');
        return block;
    }

    // Set the element type on a block, updating CSS classes
    function setBlockElementType(block, elementType) {
        if (!block) return;

        // FILM-105: Force new undo entry for element type changes
        pushUndoState(true);

        // Remove all sp-* classes
        const classes = [...block.classList].filter(c => c.startsWith('sp-'));
        classes.forEach(c => block.classList.remove(c));

        // Set new type and class
        block.dataset.elementType = elementType;
        block.classList.add('sp-' + elementType);

        editorDirty = true;
        // A type change is an edit, and it fires no `input` event, so nothing
        // else schedules the save. Without this, a line changed from a heading
        // to Action stayed a heading in the stored version, and came back as one
        // on the next load.
        triggerAutoSave();
        // A heading made or unmade changes the scene list.
        triggerSceneNavUpdate();
    }

    // Move cursor to the start of a block
    function setCursorToBlock(block) {
        if (!block) return;
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(block);
        range.collapse(true); // Collapse to start
        selection.removeAllRanges();
        selection.addRange(range);
        block.focus();
    }

    // FILM-109: Toggle dual dialogue - pairs current character/dialogue with previous
    function toggleDualDialogue(block) {
        if (!block) return;

        const editor = document.getElementById('screenplayEditor');
        const type = block.dataset.elementType;

        // Check if already in a dual dialogue container
        const existingContainer = block.closest('.dual-dialogue-container');
        if (existingContainer) {
            // Un-dual: extract blocks back to normal flow
            undualDialogue(existingContainer, editor);
            return;
        }

        // Find the character block - either current or walk back to find it
        let characterBlock = null;
        let dialogueBlocks = [];

        if (type === 'character' || type === 'dual-dialogue') {
            characterBlock = block;
        } else if (type === 'dialogue' || type === 'parenthetical') {
            // Walk back to find the character
            let sibling = block.previousElementSibling;
            while (sibling) {
                const sibType = sibling.dataset?.elementType;
                if (sibType === 'character' || sibType === 'dual-dialogue') {
                    characterBlock = sibling;
                    break;
                }
                if (sibType === 'dialogue' || sibType === 'parenthetical') {
                    dialogueBlocks.unshift(sibling);
                }
                sibling = sibling.previousElementSibling;
            }
            dialogueBlocks.push(block);
        } else {
            return; // Can only create dual dialogue from character/dialogue elements
        }

        if (!characterBlock) return;

        // Collect all dialogue blocks for this character
        if (dialogueBlocks.length === 0) {
            let sibling = characterBlock.nextElementSibling;
            while (sibling) {
                const sibType = sibling.dataset?.elementType;
                if (sibType === 'dialogue' || sibType === 'parenthetical') {
                    dialogueBlocks.push(sibling);
                } else {
                    break;
                }
                sibling = sibling.nextElementSibling;
            }
        }

        // Find the previous character block and its dialogues
        let prevCharacter = null;
        let prevDialogues = [];
        let searchBlock = characterBlock.previousElementSibling;

        // Skip any page break indicators
        while (searchBlock && searchBlock.classList.contains('page-break-indicator')) {
            searchBlock = searchBlock.previousElementSibling;
        }

        while (searchBlock) {
            const sibType = searchBlock.dataset?.elementType;
            if (sibType === 'character') {
                prevCharacter = searchBlock;
                break;
            }
            if (sibType === 'dialogue' || sibType === 'parenthetical') {
                prevDialogues.unshift(searchBlock);
            } else if (sibType === 'scene-heading' || sibType === 'action' || sibType === 'transition') {
                break; // Stop at non-dialogue elements
            }
            searchBlock = searchBlock.previousElementSibling;
        }

        if (!prevCharacter) {
            setStatus('No previous character found for dual dialogue');
            return;
        }

        // Create the dual dialogue container
        const container = document.createElement('div');
        container.className = 'dual-dialogue-container';
        container.contentEditable = 'false';

        // Left column (first character)
        const leftCol = document.createElement('div');
        leftCol.className = 'dual-dialogue-column left';
        leftCol.contentEditable = 'true';

        // Right column (second character - marked with ^)
        const rightCol = document.createElement('div');
        rightCol.className = 'dual-dialogue-column right';
        rightCol.contentEditable = 'true';

        // Move elements to columns
        leftCol.appendChild(prevCharacter.cloneNode(true));
        prevDialogues.forEach(d => leftCol.appendChild(d.cloneNode(true)));

        const rightChar = characterBlock.cloneNode(true);
        rightChar.dataset.dualRight = 'true'; // Mark as right side for serializer
        rightCol.appendChild(rightChar);
        dialogueBlocks.forEach(d => rightCol.appendChild(d.cloneNode(true)));

        // Make cloned elements editable
        leftCol.querySelectorAll('[data-element-type]').forEach(el => el.contentEditable = 'true');
        rightCol.querySelectorAll('[data-element-type]').forEach(el => el.contentEditable = 'true');

        container.appendChild(leftCol);
        container.appendChild(rightCol);

        // Insert container before the first element and remove originals
        prevCharacter.before(container);

        // Remove original elements
        prevCharacter.remove();
        prevDialogues.forEach(d => d.remove());
        characterBlock.remove();
        dialogueBlocks.forEach(d => d.remove());

        // Focus the right column
        const firstRightBlock = rightCol.querySelector('[data-element-type]');
        if (firstRightBlock) {
            setCursorToBlock(firstRightBlock);
        }

        editorDirty = true;
        setStatus('Dual dialogue created');
    }

    // FILM-109: Extract dual dialogue back to normal flow
    function undualDialogue(container, editor) {
        const leftCol = container.querySelector('.dual-dialogue-column.left');
        const rightCol = container.querySelector('.dual-dialogue-column.right');

        if (!leftCol || !rightCol) return;

        // Get all blocks from both columns
        const leftBlocks = Array.from(leftCol.querySelectorAll('[data-element-type]'));
        const rightBlocks = Array.from(rightCol.querySelectorAll('[data-element-type]'));

        // Remove dual marker from right character
        rightBlocks.forEach(b => delete b.dataset.dualRight);

        // Insert blocks before the container
        leftBlocks.forEach(b => {
            const clone = b.cloneNode(true);
            clone.contentEditable = 'true';
            container.before(clone);
        });
        rightBlocks.forEach(b => {
            const clone = b.cloneNode(true);
            clone.contentEditable = 'true';
            container.before(clone);
        });

        // Remove container
        container.remove();

        editorDirty = true;
        setStatus('Dual dialogue removed');
    }

    // FILM-108: Calculate page count based on element types
    function calculatePageEstimate(editor) {
        if (!editor) return { lines: 0, pages: 0 };

        const blocks = editor.querySelectorAll('[data-element-type]');
        let totalLines = 0;

        blocks.forEach(block => {
            const type = block.dataset.elementType;
            // Get text excluding gutter elements
            let text = '';
            for (const child of block.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE &&
                           !child.classList.contains('scene-number-gutter')) {
                    text += child.innerText || '';
                }
            }
            const charCount = text.trim().length;

            switch (type) {
                case 'scene-heading':
                    totalLines += 2; // heading + blank line
                    break;
                case 'action':
                    totalLines += Math.ceil(charCount / 60) + 1; // wrapped lines + blank
                    break;
                case 'character':
                    totalLines += 1;
                    break;
                case 'dialogue':
                    totalLines += Math.ceil(charCount / 35); // narrower column
                    break;
                case 'parenthetical':
                    totalLines += 1;
                    break;
                case 'transition':
                    totalLines += 2; // transition + blank
                    break;
                case 'centered':
                    totalLines += 2;
                    break;
                case 'dual-dialogue':
                    totalLines += 1;
                    break;
                case 'lyrics':
                    totalLines += Math.ceil(charCount / 50) + 1;
                    break;
                case 'note':
                    totalLines += 1;
                    break;
                default:
                    totalLines += Math.ceil(charCount / 60) + 1;
            }
        });

        const pages = Math.max(1, Math.ceil(totalLines / 55));
        return { lines: totalLines, pages };
    }

    function updateEditorStats(pageCount, sceneCount) {
        const editor = document.getElementById('screenplayEditor');
        const text = editor.innerText || '';
        const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;

        // FILM-108: Use proper page estimation
        const estimate = calculatePageEstimate(editor);
        const pages = pageCount || estimate.pages;

        document.getElementById('editorWordCount').textContent = `Words: ${words.toLocaleString()}`;
        document.getElementById('editorPageCount').textContent = `~${pages} pages (~${pages} min)`;

        /*
         * The editor is a continuous scroll while you write.
         *
         * The page COUNT stays — it is genuinely useful, one page being about
         * one minute — and calculatePageEstimate counts BLOCKS, so it never
         * needed the markers. What is gone is the furniture: nothing is
         * inserted into the contenteditable, which removes the class of bug
         * rather than defending against it. Pagination now happens on a clone
         * at print time, in exportToPDF.
         */
    }

    /**
     * May a page end immediately after this element?
     *
     * `false` means it belongs with whatever follows and the break must move up.
     * Declared per type rather than as a list of exceptions, so a new element
     * type has to answer instead of defaulting to breakable and being found in
     * a screenshot. Mirrors lib/screenplay-pagination.js, which is where the
     * reasoning for each answer is written down.
     */
    const MAY_END_PAGE = {
        action: true,
        dialogue: true,
        transition: true,
        centered: true,
        lyrics: true,
        note: true,
        'scene-heading': false,
        'character': false,
        'parenthetical': false,
        'dual-dialogue': false,
    };

    // FILM-108: Render soft page break indicators
    /*
     * THE BODY BLOCKS — every screenplay element EXCEPT the title page.
     *
     * The title page is not body pages: it is display:none on screen and its
     * own page in print, and `film_script_elements` has no row for it (index 0
     * is the first scene heading). Two consumers already excluded it by name
     * and three did not, so the same root cause produced two separate defects:
     *
     *  - PAGINATION counted its 46 characters of stored title data — invisible
     *    on screen — as 2 lines against the 55-line body budget, so every page
     *    break in every screenplay landed two lines early.
     *  - INLINE COMMENTS anchored on `blocks.indexOf(block)`, which is one
     *    higher than the element's real index. Read and write were off by the
     *    same one, so the comment appeared in the right place in the editor
     *    while the index STORED pointed at the previous element — wrong for the
     *    server, the export and every reader that is not this function.
     *
     * One accessor rather than five selectors: the two that were already right
     * were right because someone remembered, which is why the other three
     * were not.
     */
    function bodyBlocks(root) {
        return Array.from((root || document.getElementById('screenplayEditor'))
            .querySelectorAll('[data-element-type]:not([data-element-type="title-page"])'));
    }

    /**
     * Insert page-break markers into a container.
     *
     * Deliberately takes a CONTAINER rather than reaching for the editor: the
     * live editor must never hold these. An indicator is a <div> with a class,
     * no element type and no text — indistinguishable from an empty block — so
     * while it lived in the contenteditable the orphan-adoption loop kept
     * turning five of them into 32px of nothing on every keystroke.
     *
     * The editor is now one continuous scroll. Pagination happens on a DETACHED
     * CLONE at print time, where the markers are exactly what
     * `.page-break-indicator { page-break-after: always }` needs, and where
     * nothing is typing into them.
     *
     * The rule itself is unchanged and still walks a break UP past anything
     * that belongs with what follows — a cue stranded at the foot of a page
     * leaves its dialogue alone at the top of the next, where it reads as
     * action. Held in lockstep with lib/screenplay-pagination.js.
     */
    function paginateInto(container) {
        const editor = container;
        if (!editor) return;

        // Remove existing page break indicators
        const existing = editor.querySelectorAll('.page-break-indicator');
        existing.forEach(el => el.remove());

        const blocks = bodyBlocks(editor);

        /*
         * Measure every block FIRST, then place the breaks.
         *
         * The old loop added a block's lines and broke the moment the running
         * total crossed 55 — which puts the break AFTER the block that busted
         * the budget. An action paragraph is often ten or twenty lines, so a
         * page could carry 69 lines against a budget of 55 with nothing saying
         * so, and the print sheet is a fixed 11 inches: an overfull page does
         * not stretch, the browser reflows it and puts its OWN break somewhere
         * the format forbids. That is how a scene heading ended up alone at the
         * foot of a page with its action overleaf — MAY_END_PAGE never got a
         * say, because the break that stranded it was not one we placed.
         *
         * Held in lockstep with lib/screenplay-pagination.js.
         */
        const lineCount = [];
        for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i];
            const type = block.dataset.elementType;

            // Get text excluding gutter elements
            let text = '';
            for (const child of block.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE &&
                           !child.classList.contains('scene-number-gutter')) {
                    text += child.innerText || '';
                }
            }
            const charCount = text.trim().length;

            // Calculate lines for this element
            let elementLines = 0;
            switch (type) {
                case 'scene-heading': elementLines = 2; break;
                case 'action': elementLines = Math.ceil(charCount / 60) + 1; break;
                case 'character': elementLines = 1; break;
                case 'dialogue': elementLines = Math.ceil(charCount / 35); break;
                case 'parenthetical': elementLines = 1; break;
                case 'transition': elementLines = 2; break;
                case 'centered': elementLines = 2; break;
                case 'dual-dialogue': elementLines = 1; break;
                case 'lyrics': elementLines = Math.ceil(charCount / 50) + 1; break;
                case 'note': elementLines = 1; break;
                default: elementLines = Math.ceil(charCount / 60) + 1;
            }

            lineCount.push(elementLines);
        }

        let pageStart = 0;
        let used = 0;
        let pageNum = 1;

        for (let i = 0; i < blocks.length; i++) {
            // `used > 0` so a single block longer than a whole page overflows
            // rather than being pushed for ever onto a page it can never fit.
            if (used > 0 && used + lineCount[i] > 55) {
                pageNum++;

                /*
                 * A PAGE MAY NOT END BETWEEN THINGS THAT BELONG TOGETHER.
                 *
                 * This broke wherever the line count happened to cross, so on a
                 * real five-page screenplay three of five breaks landed in
                 * places the format forbids — twice between a character cue and
                 * its dialogue, once between a parenthetical and its dialogue.
                 * A cue stranded at the foot of a page leaves its dialogue alone
                 * at the top of the next, where it reads as ACTION because
                 * nothing above it says who is speaking. That is what the
                 * "double lines" were: correct margins, wrong meaning.
                 *
                 * The break walks UP past anything that belongs with what
                 * follows. Up rather than down, because pushing it down would
                 * leave the cue behind and orphan the dialogue — the bug itself.
                 * Walking up sends the whole unit to the next page, which is
                 * what a screenplay does.
                 *
                 * Held in lockstep with lib/screenplay-pagination.js by
                 * screenplay-pagination.test.js: the SPA cannot require a node
                 * module (build.target is single-html), and two paginators that
                 * disagree is how a fix survives in tests and not on screen.
                 */
                let at = i - 1;
                while (at > pageStart && MAY_END_PAGE[blocks[at].dataset.elementType] === false) at--;
                if (at < pageStart || MAY_END_PAGE[blocks[at].dataset.elementType] === false) at = i - 1;

                const indicator = document.createElement('div');
                indicator.className = 'page-break-indicator';
                indicator.dataset.pageLabel = `Page ${pageNum}`;
                indicator.contentEditable = 'false';
                blocks[at].after(indicator);

                // Everything from the break to here has moved onto the new page.
                used = 0;
                for (let k = at + 1; k <= i; k++) used += lineCount[k];
                pageStart = at + 1;
                continue;
            }
            used += lineCount[i];
        }
    }

    // FILM-106: Enhanced scene navigator
    let sceneNavTimer = null;

    const SCENE_NAV_UPDATE_DELAY = 1000;

 // 1 second debounce
    let currentSceneIndex = -1;

    function updateSceneNavigator(fountainText) {
        const navList = document.getElementById('sceneNavList');
        const navStats = document.getElementById('sceneNavStats');
        if (!navList) return;

        // Parse scenes from editor DOM for better accuracy
        const editor = document.getElementById('screenplayEditor');
        const scenes = parseSceneOutline(editor);

        // Update stats (FILM-108: Use proper page estimation)
        const estimate = calculatePageEstimate(editor);
        if (navStats) {
            navStats.innerHTML = `<span>${scenes.length} scene${scenes.length !== 1 ? 's' : ''}</span> · <span>~${estimate.pages} page${estimate.pages !== 1 ? 's' : ''}</span>`;
        }

        // Render scene list
        if (scenes.length === 0) {
            navList.innerHTML = '<p class="text-sm text-muted" style="padding:8px;">No scenes yet. Start with a scene heading like "INT. LOCATION - DAY"</p>';
        } else {
            navList.innerHTML = scenes.map((scene, i) => `
                <div class="scene-nav-item ${i === currentSceneIndex ? 'current' : ''}"
                     data-scene-index="${i}"
                     draggable="true"
                     onclick="scrollToScene(${i})"
                     ondragstart="onSceneNavDragStart(event, ${i})"
                     ondragover="onSceneNavDragOver(event)"
                     ondragleave="onSceneNavDragLeave(event)"
                     ondrop="onSceneNavDrop(event, ${i})">
                    <div class="scene-nav-header">
                        <span class="scene-nav-num" style="cursor:grab;">#${scene.num}</span>
                        <span class="scene-nav-title">${escapeHtml(scene.heading)}</span>
                    </div>
                    ${scene.characters.length > 0 ? `<div class="scene-nav-chars">${scene.characters.slice(0, 3).join(', ')}${scene.characters.length > 3 ? '...' : ''}</div>` : ''}
                </div>
            `).join('');
        }
    }

    // Parse scene outline from editor DOM
    function parseSceneOutline(editor) {
        if (!editor) return [];

        const scenes = [];
        const blocks = editor.querySelectorAll('[data-element-type]');
        let currentScene = null;
        let autoSceneNum = 0;

        for (const block of blocks) {
            const type = block.dataset.elementType;
            // FILM-107: Get text excluding scene number gutter
            let text = '';
            for (const child of block.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains('scene-number-gutter')) {
                    text += child.innerText || '';
                }
            }
            text = text.trim();

            if (type === 'scene-heading') {
                // Save previous scene
                if (currentScene) {
                    scenes.push(currentScene);
                }

                autoSceneNum++;
                // FILM-107: Use data-scene-number if available, otherwise auto-calculate
                const sceneNum = block.dataset.sceneNumber || String(autoSceneNum);
                // Parse heading to extract location/time
                let heading = text;
                if (heading.length > 35) {
                    heading = heading.slice(0, 35) + '...';
                }

                currentScene = {
                    num: sceneNum,
                    heading: heading,
                    characters: [],
                    element: block
                };
            } else if (type === 'character' && currentScene) {
                // Extract character name (remove extensions like V.O., O.S.)
                const charName = text.replace(/\s*\([^)]*\)\s*$/, '').toUpperCase();
                if (charName && !currentScene.characters.includes(charName)) {
                    currentScene.characters.push(charName);
                }
            }
        }

        // Don't forget the last scene
        if (currentScene) {
            scenes.push(currentScene);
        }

        return scenes;
    }

    // Debounced scene navigator update
    function triggerSceneNavUpdate() {
        if (sceneNavTimer) clearTimeout(sceneNavTimer);
        sceneNavTimer = setTimeout(() => {
            updateSceneNavigator();
            updateCurrentSceneHighlight();
            // FILM-107: Update scene numbers when content changes
            if (!sceneNumbersLocked) {
                updateSceneNumbers();
            }
            // FILM-116: Update stats summary if stats panel is open
            const statsContent = document.getElementById('scriptStatsContent');
            if (statsContent && statsContent.classList.contains('open')) {
                updateScriptStats();
            } else {
                // Just update summary line
                updateScriptStatsSummary();
            }
        }, SCENE_NAV_UPDATE_DELAY);
    }

    // ══════════════════════════════════════════════════════════════
    // FILM-127: INDEX CARDS VIEW
    // ══════════════════════════════════════════════════════════════
    let currentViewMode = 'editor';

    let indexCardsData = [];

    let draggedCardIndex = null;
    let screenplayCardsResponse = null;
    let screenplayCardsRequest = 0;
    let editingReviewCard = null;

    function paintReviewCards() {
        const grid = document.getElementById('indexCardsGrid');
        const data = screenplayCardsResponse;
        if (!data) return;
        document.getElementById('indexCardsCoverage').textContent =
            `${data.coverage.summarized}/${data.coverage.total} summaries · ${data.coverage.stale} need review`;
        const scenes = parseSceneBlocks();
        indexCardsData = scenes;
        grid.innerHTML = data.cards.map((card, i) => `
            <div class="index-card" data-index="${i}" onclick="openIndexCard(${i})" ondblclick="jumpToSceneFromCard(${i})">
                <div class="index-card-header"><span class="index-card-number">Sc ${esc(card.number)}</span>
                    ${card.stale ? '<span>Summary needs review</span>' : ''}</div>
                <div class="index-card-heading">${esc(card.heading)}</div>
                <div class="index-card-preview">${esc(card.summary || 'No summary yet.')}</div>
                ${card.notes ? `<div class="index-card-preview"><strong>Your notes</strong><br>${esc(card.notes)}</div>` : ''}
            </div>`).join('') || '<p>No scenes in this saved screenplay.</p>';
        if (data.archived.length) grid.insertAdjacentHTML('beforeend', `<details><summary>${data.archived.length} retained cards from other scene revisions</summary>${data.archived.map(c=>`<p><strong>${esc(c.heading)}</strong></p><p>${esc(c.summary)}</p><p>${esc(c.notes)}</p>`).join('')}</details>`);
    }

    /*
     * Four ways to look at the same screenplay.
     *
     * Driven by one map rather than a chain of if/else on element ids: the
     * previous two-mode version toggled two buttons and two containers by
     * name, and a third mode added that way is three places to forget.
     */
    const SP_VIEWS = {
        editor:    { btn: 'viewModeEditor',    el: 'editorViewContainer', onShow: () => renderScriptGutter() },
        cards:     { btn: 'viewModeCards',     el: 'indexCardsView',      onShow: () => renderIndexCards() },
        treatment: { btn: 'viewModeTreatment', el: 'treatmentView',       onShow: () => loadTreatment() },
        analysis:  { btn: 'viewModeAnalysis',  el: 'analysisView',        onShow: () => loadAnalysis() },
    };

    function setViewMode(mode) {
        if (!SP_VIEWS[mode]) mode = 'editor';
        currentViewMode = mode;

        for (const [id, view] of Object.entries(SP_VIEWS)) {
            const btn = document.getElementById(view.btn);
            if (btn) btn.classList.toggle('active', id === mode);
            const el = document.getElementById(view.el);
            if (!el) continue;
            if (id === 'editor') {
                el.style.display = id === mode ? 'block' : 'none';
            } else {
                el.classList.toggle('active', id === mode);
            }
        }
        const show = SP_VIEWS[mode].onShow;
        if (show) show();
    }

    async function renderIndexCards() {
        const grid = document.getElementById('indexCardsGrid');
        if (!grid || !state.currentProject) return;
        const request = ++screenplayCardsRequest;
        screenplayCardsResponse = null;
        const projectId = state.currentProject.id, version = currentScriptVersion;
        if (editorDirty) { grid.innerHTML = '<p>Save screenplay edits in the Editor before reviewing cards.</p>'; return; }
        grid.innerHTML = '<p>Loading scene summaries…</p>';
        try {
            const data = await api(`/projects/${projectId}/script/cards?version=${encodeURIComponent(version || '')}`);
            if (request !== screenplayCardsRequest || state.currentProject?.id !== projectId || currentScriptVersion !== version) return;
            screenplayCardsResponse = data;
            paintReviewCards();
        } catch (err) {
            if (request === screenplayCardsRequest) grid.innerHTML = `<p role="alert">Cards unavailable: ${esc(err.message)}. The backend must load the scene-card update.</p>`;
        }
    }

    /* ── the gutter: shot numbers and page eighths beside the script ──────
     *
     * Absolutely-positioned markers aligned to each scene heading's own
     * offsetTop, rather than a column beside the page. The screenplay is one
     * flowing contenteditable, so a column would have to re-derive its own line
     * breaks — a second layout that drifts from the one actually on screen, and
     * drifts differently at every zoom level.
     *
     * The three numbers are kept apart deliberately: eighths are objective,
     * screen time is an estimate with a confidence, and neither is the shot
     * count. A single blended figure would hide which is which.
     */
    let SCRIPT_TIMING = null;

    async function loadScriptTiming() {
        if (!state.currentProject) return null;
        try {
            SCRIPT_TIMING = await api(`/projects/${state.currentProject.id}/timing`);
        } catch (err) {
            SCRIPT_TIMING = null;
        }
        return SCRIPT_TIMING;
    }

    /*
     * The timing rows that belong to scene headings, in order.
     *
     * The report opens with a row for whatever sits above the first heading —
     * a title page or a note — with no heading and scene number 0. Matching
     * rows to headings by position without dropping it shifted every scene by
     * one: the gutter showed the preamble's eighths beside scene 1, and each
     * scene the one before it. One rule, for the gutter and for the print.
     */
    function timingRowsForHeadings(timing) {
        return ((timing && timing.scenes) || []).filter(r => r && String(r.heading || '').trim());
    }

    /** Shot codes per scene number, from the shot list the breakdown produced. */
    function shotCodesByScene() {
        const out = {};
        for (const sh of (state.shots || [])) {
            const n = String(sh.scene_number != null ? sh.scene_number : '');
            if (!n) continue;
            (out[n] = out[n] || []).push(sh.shot_code);
        }
        return out;
    }

    function mmss(seconds) {
        const s = Math.max(0, Math.round(Number(seconds) || 0));
        return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    async function renderScriptGutter() {
        const container = document.getElementById('editorViewContainer');
        const editor = document.getElementById('screenplayEditor');
        if (!container || !editor) return;

        let gutter = document.getElementById('spGutter');
        if (!gutter) {
            gutter = document.createElement('div');
            gutter.id = 'spGutter';
            gutter.className = 'sp-gutter';
            // The gutter is a SIBLING of the page, never a child: anything
            // inside the contenteditable is content the editor will try to
            // adopt, normalise, and eventually sweep — which is exactly what
            // the page-break indicators had to be taken out of it for.
            container.style.position = container.style.position || 'relative';
            container.appendChild(gutter);
        }

        if (!SCRIPT_TIMING) await loadScriptTiming();
        const timing = SCRIPT_TIMING;
        if (!timing || !timing.scenes) { gutter.innerHTML = ''; return; }

        const codes = shotCodesByScene();
        const headings = [...editor.querySelectorAll('[data-element-type="scene-heading"]')];
        const editorTop = editor.offsetTop;
        const rows = timingRowsForHeadings(timing);

        gutter.innerHTML = headings.map((el, i) => {
            const scene = rows[i];
            if (!scene) return '';
            const top = el.offsetTop + editorTop;
            const num = scene.scene_number;
            const shots = codes[String(num)] || [];
            const low = scene.screen_time.confidence === 'low';
            return `<div class="sp-gutter-item" style="top:${top}px;">
                <div class="sp-gutter-eighths">${esc(scene.eighths)}</div>
                <div class="sp-gutter-time ${low ? 'sp-gutter-low' : ''}"
                     title="${esc(scene.screen_time.minimum_seconds + '-' + scene.screen_time.maximum_seconds + 's, confidence ' + scene.screen_time.confidence)}">${mmss(scene.screen_time.likely_seconds)}${low ? ' ?' : ''}</div>
                ${shots.length ? `<div class="sp-gutter-shots" title="${shots.length} shot(s)">${shots.map(esc).join(' ')}</div>` : ''}
            </div>`;
        }).join('');
    }

    /* ── treatment ──────────────────────────────────────────────────────── */
    async function loadTreatment() {
        if (!state.currentProject) return;
        const box = document.getElementById('treatmentText');
        const meta = document.getElementById('treatmentMeta');
        if (!box) return;
        try {
            const t = await api(`/projects/${state.currentProject.id}/treatment`);
            box.value = t.content || '';
            meta.textContent = t.exists
                ? `v${t.version} · ${t.word_count} words · saved ${t.updated_at || t.created_at}`
                : 'No treatment yet.';
        } catch (err) {
            meta.textContent = 'Could not load the treatment: ' + err.message;
        }
    }

    async function saveTreatment() {
        if (!state.currentProject) return;
        const box = document.getElementById('treatmentText');
        const meta = document.getElementById('treatmentMeta');
        meta.textContent = 'Saving…';
        try {
            const res = await api(`/projects/${state.currentProject.id}/treatment`, {
                method: 'PUT', body: JSON.stringify({ content: box.value }),
            });
            // An unchanged save writes nothing and says so, rather than
            // manufacturing a version that records no change.
            meta.textContent = res.changed
                ? `Saved as v${res.version}.`
                : `No change — still v${res.version}.`;
        } catch (err) {
            meta.textContent = 'Save failed: ' + err.message;
        }
    }

    /* ── analysis ───────────────────────────────────────────────────────── */

    /*
     * ── Reading a reading ───────────────────────────────────────────────────
     *
     * The panel opened with `Read by round-trip test · draft v15 · 2026-08-29
     * 12:07:03` and then dumped the map as raw JSON under a heading that said
     * "Map". Three faults, and none of them cosmetic:
     *
     *  - the least important thing led. Who typed it and when is provenance;
     *    it belongs at the bottom, in English, not as a raw SQL timestamp.
     *  - the MAP is not debug output. LAYERS calls it "what is in the script,
     *    before any judgement about it" — characters, locations, turning
     *    points — and it was being shown as `JSON.stringify(map, null, 1)`.
     *  - the notes were one flat list. The thirteen dimensions are the whole
     *    rubric and no note recorded which one it was about, so a writer
     *    working on dialogue could not find the dialogue notes.
     */

    /** A confidence and a kind read better as marks than as a sentence. */
    function analysisBadges(n) {
        const conf = String(n.confidence || '').toLowerCase();
        const bits = [];
        if (conf) bits.push(`<span class="an-badge an-${esc(conf)}">${esc(conf)} confidence</span>`);
        if (n.kind === 'mechanical') bits.push('<span class="an-badge an-mech">measured</span>');
        return bits.join('');
    }

    function analysisNoteHtml(n) {
        const strategies = Array.isArray(n.strategies) ? n.strategies : [];
        return `<div class="analysis-note ${n.kind === 'mechanical' ? 'mechanical' : ''}">
            <div class="an-head">
                <strong>${esc(n.observation || '')}</strong>
                <span class="an-badges">${analysisBadges(n)}</span>
            </div>
            ${n.evidence ? `<div class="ev">${esc(n.evidence)}</div>` : ''}
            ${n.effect ? `<div>${esc(n.effect)}</div>` : ''}
            ${n.question ? `<div class="q">${esc(n.question)}</div>` : ''}
            ${strategies.length ? `<ul>${strategies.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        </div>`;
    }

    /**
     * Notes under the dimension they are about.
     *
     * Ordered by the RUBRIC's own order, not by how many notes each dimension
     * collected: the rubric runs premise → structure → … → format, which is
     * roughly how a reader experiences a script, and sorting by count would
     * put whatever the model happened to say most about at the top.
     *
     * A note with no dimension is shown, under "Not filed" — dropping it would
     * silently lose a real observation, and every reading stored before the
     * field existed has none.
     */
    function analysisByDimension(notes, dimensions) {
        const list = Array.isArray(notes) ? notes : [];
        if (!list.length) return '<p class="text-muted">None.</p>';
        const order = (dimensions || []).map(d => d.id);
        const titles = {};
        (dimensions || []).forEach(d => { titles[d.id] = d.title; });

        const groups = new Map();
        for (const n of list) {
            const key = n && n.dimension && titles[n.dimension] ? n.dimension : '__none__';
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(n);
        }
        const keys = [...order.filter(k => groups.has(k)), ...(groups.has('__none__') ? ['__none__'] : [])];
        // Nothing tagged at all: one flat list reads better than a single
        // "Not filed" heading over everything.
        if (keys.length === 1 && keys[0] === '__none__') return list.map(analysisNoteHtml).join('');

        return keys.map(k => `
            <div class="an-dim">
                <h4>${k === '__none__' ? 'Not filed' : esc(titles[k])}
                    <span class="text-muted">${groups.get(k).length}</span></h4>
                ${groups.get(k).map(analysisNoteHtml).join('')}
            </div>`).join('');
    }

    /**
     * The map, as something a person reads.
     *
     * Rendered from whatever the map HOLDS rather than from a fixed field list:
     * LAYERS describes it loosely on purpose — characters, scenes, locations,
     * chronology, goals, turning points, setups and payoffs — so a reading that
     * carries something this page has never heard of must still show it, or the
     * page silently drops part of the report.
     */
    function analysisMapHtml(map) {
        const entries = Object.entries(map || {}).filter(([, v]) =>
            v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length));
        if (!entries.length) return '';
        const label = k => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
        return `<div class="an-map">${entries.map(([k, v]) => {
            let shown;
            if (Array.isArray(v)) {
                shown = v.map(x => `<span class="an-chip">${esc(typeof x === 'string' ? x : JSON.stringify(x))}</span>`).join('');
            } else if (v && typeof v === 'object') {
                shown = `<span class="an-chip">${esc(JSON.stringify(v))}</span>`;
            } else {
                shown = `<span class="an-chip">${esc(String(v))}</span>`;
            }
            return `<div class="an-map-row"><span class="an-map-key">${esc(label(k))}</span>${shown}</div>`;
        }).join('')}</div>`;
    }

    /** A stored timestamp, as a person would say it. */
    function analysisWhen(iso) {
        // Stored by SQLite as "YYYY-MM-DD HH:MM:SS" in UTC, which Safari will
        // not parse without the T and the Z.
        const t = Date.parse(String(iso || '').replace(' ', 'T') + (/[Zz]|[+-]\d{2}:?\d{2}$/.test(iso || '') ? '' : 'Z'));
        if (!Number.isFinite(t)) return esc(String(iso || ''));
        const days = Math.floor((Date.now() - t) / 86400000);
        if (days <= 0) return 'today';
        if (days === 1) return 'yesterday';
        if (days < 30) return `${days} days ago`;
        return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    async function loadAnalysis() {
        if (!state.currentProject) return;
        const body = document.getElementById('analysisBody');
        if (!body) return;
        body.innerHTML = '<div class="text-muted">Loading…</div>';
        try {
            const res = await api(`/projects/${state.currentProject.id}/analysis`);
            if (!res.exists) {
                body.innerHTML = `<div class="empty-state"><h3>No reading yet</h3>
                    <p>Ask Claude to read the screenplay. It calls <code>analysis_brief</code>,
                    which hands over the script and a thirteen-dimension rubric and costs nothing,
                    then stores what it concluded with <code>analysis_write</code>.</p>
                    <p class="text-muted">Nothing here rewrites your script: the notes carry
                    evidence, a question and strategies, never drafted lines.</p></div>`;
                return;
            }
            const a = res.analysis;
            const dims = res.dimensions || [];
            const obs = a.observations || [];
            const opps = a.opportunities || [];
            const qs = a.questions || [];
            const mapHtml = analysisMapHtml(a.map);

            body.innerHTML = `
                ${res.of_current_draft ? '' : `<div class="warning-banner">${esc(res.warning)}</div>`}

                <div class="an-summary">
                    <span><strong>${obs.length}</strong> observation${obs.length === 1 ? '' : 's'}</span>
                    <span><strong>${qs.length}</strong> question${qs.length === 1 ? '' : 's'}</span>
                    <span><strong>${opps.length}</strong> revision opportunit${opps.length === 1 ? 'y' : 'ies'}</span>
                    <span class="text-muted">no overall score, deliberately &mdash; a number gets
                        quoted without the reasoning that produced it</span>
                </div>

                ${mapHtml ? `<h3>What is in the script</h3>
                    <p class="text-muted text-sm">Before any judgement about it.</p>${mapHtml}` : ''}

                <h3>Observations</h3>
                ${analysisByDimension(obs, dims)}

                <h3>Development questions</h3>
                ${qs.length
                    ? `<ul class="an-questions">${qs.map(q =>
                        `<li>${esc(typeof q === 'string' ? q : (q.question || ''))}</li>`).join('')}</ul>`
                    : '<p class="text-muted">None.</p>'}

                <h3>Revision opportunities</h3>
                ${analysisByDimension(opps, dims)}

                <div class="an-provenance">
                    Read ${esc(analysisWhen(a.created_at))} against draft v${esc(String(a.script_version))}${
                        a.analyst ? ` &middot; ${esc(a.analyst)}` : ''}
                    <button class="btn btn-secondary btn-sm" onclick="deleteAnalysis('${esc(a.id)}')">Delete this reading</button>
                </div>`;
        } catch (err) {
            // A renderer that paints a placeholder must have a path that
            // replaces it: a spinner that never resolves reads as the feature
            // being broken rather than as a display fault.
            body.innerHTML = `<div class="empty-state"><h3>Could not load the analysis</h3>
                <p>${esc(err.message)}</p></div>`;
        }
    }

    /**
     * Remove a reading.
     *
     * The route has existed since the feature shipped and nothing on the page
     * called it — so a reading written by a probe, or one of a draft you have
     * moved past, could only be removed from the database by hand.
     */
    async function deleteAnalysis(id) {
        if (!confirm('Delete this reading?\n\nThe screenplay is untouched. Nothing else is removed.')) return;
        try {
            await api(`/analysis/${id}`, { method: 'DELETE' });
            setStatus('Reading deleted');
            loadAnalysis();
        } catch (err) { setStatus('Error: ' + err.message); }
    }

    /* ── index cards you can actually work in ───────────────────────────── */

    /** Open an independently saved summary and notes; the heading is read-only. */
    function openIndexCard(i) {
        const card = screenplayCardsResponse?.cards[i];
        if (!card) return;
        editingReviewCard = { ...card, projectId: state.currentProject.id,
            version: screenplayCardsResponse.version, script_hash: screenplayCardsResponse.script_hash };
        document.getElementById('sceneCardIndex').value = String(i);
        document.getElementById('sceneCardTitle').textContent = `Scene ${card.number}`;
        document.getElementById('sceneCardHeading').textContent = card.heading;
        document.getElementById('sceneCardSynopsis').value = card.summary;
        document.getElementById('sceneCardNotes').value = card.notes;
        document.getElementById('sceneCardSave').disabled = false;
        document.getElementById('sceneCardError').textContent = card.stale ? 'Scene text changed. Review the summary before saving.' : '';
        showModal('sceneCardModal');
    }

    /**
     * The text of a block, excluding the furniture the editor injected into it.
     *
     * A scene heading carries `<span class="scene-number-gutter">1</span>` —
     * contenteditable="false", drawn in the margin, and part of the block's
     * textContent. Reading the block naively gives "1EXT. SUBURBAN STREET" and
     * writing that back puts the scene number INTO the screenplay, where the
     * next parse reads it as part of the location. The badge is display, not
     * content, and this is the one place that distinction is made.
     */
    function blockText(el) {
        if (!el) return '';
        let out = '';
        for (const node of el.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; continue; }
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.classList && node.classList.contains('scene-number-gutter')) continue;
            out += node.textContent;
        }
        return out.trim();
    }

    /** Every action paragraph of scene i, as it stands in the screenplay. */
    function sceneActionText(i) {
        const block = sceneHeadingBlocks()[i];
        if (!block) return '';
        const parts = [];
        let node = nextEditorBlock(block);
        while (node && node.dataset && node.dataset.elementType !== 'scene-heading') {
            if (node.dataset.elementType === 'action') parts.push(blockText(node));
            node = nextEditorBlock(node);
        }
        return parts.join('\n\n');
    }

    /** Replace a block's text while leaving its injected furniture alone. */
    function setBlockText(el, text) {
        if (!el) return;
        for (const node of [...el.childNodes]) {
            if (node.nodeType === Node.ELEMENT_NODE
                && node.classList && node.classList.contains('scene-number-gutter')) continue;
            node.remove();
        }
        el.appendChild(document.createTextNode(text));
    }

    function sceneHeadingBlocks() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return [];
        return [...editor.querySelectorAll('[data-element-type="scene-heading"]')];
    }

    /**
     * The next real block after this one, stepping over the editor's furniture.
     *
     * A page-break indicator is a div with a class, no data-element-type and no
     * text — so a one-hop `nextElementSibling.dataset.elementType` reads
     * undefined where a block should be. The editor holds no indicators today
     * (it is a continuous scroll and pagination happens on a detached clone for
     * print), but the recognition stays for the same reason normalizeEditor
     * keeps it: a contenteditable hands back bare divs, and the next thing that
     * inserts a node re-opens the bug for anything that assumed one hop.
     */
    function nextEditorBlock(node) {
        let n = node ? node.nextElementSibling : null;
        while (n && isEditorFurniture(n)) n = n.nextElementSibling;
        return n;
    }

    /** Make a screenplay block of a given type, the way the editor makes them. */
    function spBlock(type, text) {
        const div = document.createElement('div');
        div.className = 'sp-' + type;
        div.dataset.elementType = type;
        div.textContent = text;
        return div;
    }

    /**
     * After any card edit, put the editor back in a state it can be typed in.
     *
     * normalizeEditor is the one repair every writer of this editor has to run
     * — a programmatic DOM change fires no `input` event, so without it the
     * cleanup waits for the writer's next keystroke. onEditorInput then saves
     * and re-paginates. Three cards edited without this is three chances to
     * leave orphan blocks behind.
     */
    function afterCardEdit(message) {
        const editor = document.getElementById('screenplayEditor');
        normalizeEditor(editor);
        onEditorInput();
        renderIndexCards();
        // The measurements describe the draft that was just replaced until
        // they are re-read: stale eighths beside an edited scene are worse than
        // none, because they look current.
        SCRIPT_TIMING = null;
        setTimeout(renderScriptGutter, 400);
        if (message) setStatus(message);
    }

    async function saveIndexCard() {
        const card = editingReviewCard;
        if (!card || card.projectId !== state.currentProject?.id) return;
        const request = screenplayCardsRequest, version = currentScriptVersion;
        const current = () => editingReviewCard === card && request === screenplayCardsRequest
            && card.projectId === state.currentProject?.id && version === currentScriptVersion;
        const button = document.getElementById('sceneCardSave');
        button.disabled = true;
        try {
            const body = { id: card.id, version: card.version, script_hash: card.script_hash, revision: card.revision,
                notes: document.getElementById('sceneCardNotes').value };
            const summary = document.getElementById('sceneCardSynopsis').value;
            // A notes-only edit must not declare a stale summary current.
            if (summary !== card.summary || !card.stale) body.summary = summary;
            const data = await api(`/projects/${card.projectId}/script/cards`, { method: 'PUT', body: JSON.stringify(body), refresh: false });
            if (!current()) return;
            screenplayCardsResponse = data;
            editingReviewCard = null;
            closeModal('sceneCardModal');
            paintReviewCards();
            setStatus('Scene summary and notes saved');
        } catch (err) {
            if (!current()) return;
            document.getElementById('sceneCardError').textContent = err.message + ' Close and reopen cards to load the current version.';
        } finally { if (editingReviewCard === card || !editingReviewCard) button.disabled = false; }
    }

    function deleteIndexCard() { setStatus('Change screenplay scenes in the Editor; review cards only save summaries and notes.'); }

    /** A new scene, added at the end — where a writer adds the next one. */
    function addIndexCard() { setStatus('Change screenplay scenes in the Editor; review cards only save summaries and notes.'); }

    function createIndexCard() { setStatus('Change screenplay scenes in the Editor; review cards only save summaries and notes.'); }

    function reviewCardsPrintHTML(data, title) {
        // Fixed four-slot sheets; overflowing text is continued at the same
        // readable size rather than clipped or silently shrunk.
        return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)} — Scene cards</title>
        <style>
          @page { size: landscape; margin: 12mm; }
          * { box-sizing: border-box; }
          body { margin:0; color:#111; background:#fff; font:12pt/1.35 Arial,sans-serif; }
          .tools { padding:12px; }
          .sheet { width:250mm; height:180mm; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); grid-template-rows:repeat(2,minmax(0,1fr)); gap:6mm; break-after:page; margin:0 auto 10mm; }
          .sheet:last-child { break-after:auto; }
          .card { border:1px solid #555; padding:5mm; overflow:hidden; overflow-wrap:anywhere; }
          h2 { font-size:12pt; margin:0 0 3mm; }
          .label { font-size:10pt; margin-bottom:2mm; }
          .prose { white-space:pre-wrap; margin:0; }
          @media print { .tools { display:none; } .sheet { margin:0; } }
        </style></head><body><div class="tools"><button onclick="window.print()">Print / Save PDF</button> Four cards per page · ${esc(title)} · v${data.version}</div>
        <main id="sheets"></main>
        <script>
        const cards=${JSON.stringify(data.cards.map(c=>({number:c.number,heading:c.heading,summary:c.summary,notes:c.notes,stale:c.stale}))).replace(/</g,'\\u003c')};
        let sheet;
        function slot(card, continuation) {
          if(!sheet || sheet.children.length===4) {sheet=document.createElement('section');sheet.className='sheet';document.getElementById('sheets').append(sheet);}
          const el=document.createElement('article');el.className='card';sheet.append(el);
          const label=document.createElement('div');label.className='label';label.textContent='Scene '+card.number+(continuation?' · continued':'')+(card.stale?' · summary needs review':'');el.append(label);
          const heading=document.createElement('h2');heading.textContent=card.heading;el.append(heading);
          const prose=document.createElement('p');prose.className='prose';el.append(prose);return {el,prose};
        }
        for(const card of cards) {
          const text=(card.summary || 'No summary yet.')+(card.notes?'\\n\\nYour notes\\n'+card.notes:'');
          let remaining=text, continuation=false;
          while(remaining) {
            const {el,prose}=slot(card,continuation);
            prose.textContent=remaining;
            if(el.scrollHeight<=el.clientHeight+1) break;
            let low=0,high=remaining.length;
            while(low<high) {const mid=Math.ceil((low+high)/2);prose.textContent=remaining.slice(0,mid);if(el.scrollHeight<=el.clientHeight+1)low=mid;else high=mid-1;}
            if(low===0) { el.style.overflow='visible'; throw new Error('Heading too long for a card. Use a larger paper layout.'); }
            const space=remaining.lastIndexOf(' ',low); const cut=space>low/2?space:low;
            prose.textContent=remaining.slice(0,cut); remaining=remaining.slice(cut); continuation=true;
          }
        }
        document.documentElement.dataset.cardsReady='true';
        <\/script></body></html>`;
    }
    function printIndexCards() {
        if (!screenplayCardsResponse) { setStatus('Load scene cards before printing'); return; }
        const win = window.open('', '_blank');
        if (!win) { setStatus('Allow pop-ups to open printable cards'); return; }
        win.document.write(reviewCardsPrintHTML(screenplayCardsResponse, state.currentProject?.title || 'Screenplay'));
        win.document.close();
    }

    function parseSceneBlocks() {
        const editor = document.getElementById('screenplayEditor');
        const blocks = editor.querySelectorAll('[data-element-type]');
        const scenes = [];
        let currentScene = null;
        let autoSceneNum = 0;

        for (const block of blocks) {
            const type = block.dataset.elementType;
            const text = block.innerText.trim();

            if (type === 'scene-heading') {
                if (currentScene) {
                    scenes.push(currentScene);
                }

                autoSceneNum++;
                const sceneNum = block.dataset.sceneNumber || String(autoSceneNum);

                // Parse location from heading
                const locMatch = text.match(/(?:INT|EXT|INT\.?\/EXT|I\/E)[\.\s]+([^-]+)/i);
                const location = locMatch ? locMatch[1].trim() : '';

                currentScene = {
                    num: sceneNum,
                    heading: text.length > 50 ? text.slice(0, 50) + '...' : text,
                    fullHeading: text,
                    location: location,
                    preview: '',
                    characters: [],
                    lineCount: 1,
                    startElement: block
                };
            } else if (currentScene) {
                currentScene.lineCount++;

                if (type === 'action' && !currentScene.preview) {
                    currentScene.preview = text.slice(0, 100) + (text.length > 100 ? '...' : '');
                }

                if (type === 'character') {
                    const charName = text.replace(/\s*\([^)]+\)\s*$/, '').trim();
                    if (charName && !currentScene.characters.includes(charName)) {
                        currentScene.characters.push(charName);
                    }
                }
            }
        }

        // Push final scene
        if (currentScene) {
            scenes.push(currentScene);
        }

        // Calculate page lengths (~55 lines per page)
        scenes.forEach(s => {
            s.pageLength = s.lineCount / 55;
        });

        return scenes;
    }

    // Drag and drop handlers
    function onCardDragStart(event, index) {
        draggedCardIndex = index;
        event.target.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', index);
    }

    function onCardDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.classList.add('drop-target');
    }

    function onCardDragLeave(event) {
        event.currentTarget.classList.remove('drop-target');
    }

    function onCardDrop(event) {
        event.preventDefault();
        setStatus('Reorder scenes in the screenplay Editor. Review cards follow the script.');
    }

    // Scene navigator sidebar drag-drop
    let draggedNavSceneIndex = null;

    function onSceneNavDragStart(event, index) {
        draggedNavSceneIndex = index;
        event.target.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', index);
    }

    function onSceneNavDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        event.currentTarget.style.borderTop = '2px solid var(--gl-brand-pink)';
    }

    function onSceneNavDragLeave(event) {
        event.currentTarget.style.borderTop = '';
    }

    function onSceneNavDrop(event, targetIndex) {
        event.preventDefault();
        event.currentTarget.style.borderTop = '';
        const sourceIndex = draggedNavSceneIndex;
        if (sourceIndex === null || sourceIndex === targetIndex) {
            draggedNavSceneIndex = null;
            return;
        }
        reorderScenes(sourceIndex, targetIndex);
        draggedNavSceneIndex = null;
        document.querySelectorAll('.scene-nav-item.dragging').forEach(el => el.classList.remove('dragging'));
    }

    function reorderScenes(fromIndex, toIndex) {
        // Get all scene blocks and their content
        const editor = document.getElementById('screenplayEditor');
        const sceneBlocks = [];
        let currentSceneContent = [];

        for (const child of editor.children) {
            const type = child.dataset?.elementType;
            if (type === 'scene-heading') {
                if (currentSceneContent.length > 0) {
                    sceneBlocks.push([...currentSceneContent]);
                }
                currentSceneContent = [child.cloneNode(true)];
            } else if (currentSceneContent.length > 0) {
                currentSceneContent.push(child.cloneNode(true));
            }
        }

        // Push final scene
        if (currentSceneContent.length > 0) {
            sceneBlocks.push(currentSceneContent);
        }

        if (sceneBlocks.length < 2) return;

        // Reorder
        const [removed] = sceneBlocks.splice(fromIndex, 1);
        sceneBlocks.splice(toIndex, 0, removed);

        // Rebuild editor content
        editor.innerHTML = '';
        sceneBlocks.forEach((blocks, idx) => {
            blocks.forEach((block, bIdx) => {
                // Update scene number if it's the heading
                if (bIdx === 0 && block.dataset?.elementType === 'scene-heading') {
                    block.dataset.sceneNumber = String(idx + 1);
                    // Update scene number gutter if present
                    const gutter = block.querySelector('.scene-number-gutter');
                    if (gutter) gutter.textContent = String(idx + 1);
                }
                editor.appendChild(block);
                normalizeEditor();   // every way in leaves the editor sound
            });
        });

        // Trigger save and updates
        editorDirty = true;
        triggerAutoSave();
        triggerSceneNavUpdate();
        renderIndexCards();
        setStatus('Scenes reordered');
    }

    function jumpToSceneFromCard(index) {
        closeModal('sceneCardModal');
        setViewMode('editor');

        const editor = document.getElementById('screenplayEditor');
        const headings = editor.querySelectorAll('[data-element-type="scene-heading"]');

        if (headings[index]) {
            headings[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
            setCursorToBlock(headings[index]);
        }
    }

    // FILM-128: Title Page Editor
    let currentTitlePage = null;

    async function appAuthor() {
        if (legacy.APP_AUTHOR !== null) return legacy.APP_AUTHOR;
        try {
            const res = await api('/settings');
            setLegacy('APP_AUTHOR', (res.settings && res.settings.author) || '');
        } catch (_) { setLegacy('APP_AUTHOR', ''); }
        return legacy.APP_AUTHOR;
    }

    async function openTitlePageModal() {
        const modal = document.getElementById('titlePageModal');
        if (!modal) return;

        // Try to parse existing title page from editor content
        const editor = document.getElementById('screenplayEditor');
        const existingTitlePage = parseTitlePageFromEditor(editor);

        if (existingTitlePage) {
            currentTitlePage = existingTitlePage;
        } else if (state.currentProject) {
            // Fall back to project metadata
            currentTitlePage = {
                title: state.currentProject.title || '',
                credit: 'Written by',
                author: state.currentProject.author || '',
                source: '',
                draft_date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
                contact: ''
            };
        } else {
            currentTitlePage = {
                title: '',
                credit: 'Written by',
                author: '',
                source: '',
                draft_date: '',
                contact: ''
            };
        }

        // Populate form fields
        document.getElementById('titlePageTitle').value = currentTitlePage.title || '';
        document.getElementById('titlePageCredit').value = currentTitlePage.credit || 'Written by';
        // Fills a BLANK author, never overwrites one. A screenplay can have been
        // written by someone else, and a setting that quietly reassigns
        // authorship is worse than one that does nothing.
        document.getElementById('titlePageAuthor').value = currentTitlePage.author || await appAuthor();
        document.getElementById('titlePageSource').value = currentTitlePage.source || '';
        document.getElementById('titlePageDraftDate').value = currentTitlePage.draft_date || '';
        document.getElementById('titlePageContact').value = currentTitlePage.contact || '';
        document.getElementById('titlePageCopyright').value = currentTitlePage.copyright || '';
        document.getElementById('titlePageNotes').value = currentTitlePage.notes || '';

        // Through showModal: `open` is the only class .modal-overlay is
        // displayed by, AND the helper is what puts this above whatever it was
        // opened from. Setting the class here did the first and not the second.
        showModal('titlePageModal');
    }

    function parseTitlePageFromEditor(editor) {
        if (!editor) return null;

        // Check for title page block at the start
        const firstBlock = editor.querySelector('[data-element-type="title-page"]');
        if (firstBlock) {
            return JSON.parse(firstBlock.dataset.titlePageData || '{}');
        }

        // Try to parse from Fountain content
        const content = serializeEditorToFountain(editor);
        return parseTitlePageFromFountain(content);
    }

    function parseTitlePageFromFountain(content) {
        if (!content) return null;

        const lines = content.split('\n');
        const titlePage = {};
        let inTitlePage = false;
        let currentKey = null;
        let currentValue = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Title page starts with a key: value pair
            const keyMatch = line.match(/^([A-Za-z][A-Za-z\s]*?)\s*:\s*(.*)$/);
            if (keyMatch && (i === 0 || inTitlePage)) {
                inTitlePage = true;

                // Save previous key-value
                if (currentKey) {
                    titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')] = currentValue.join('\n').trim();
                }

                currentKey = keyMatch[1];
                currentValue = keyMatch[2] ? [keyMatch[2]] : [];
            } else if (inTitlePage && line.match(/^\s{3,}/) && currentKey) {
                // Multi-line value (indented continuation)
                currentValue.push(line.trim());
            } else if (inTitlePage && line.trim() === '') {
                // End of title page
                if (currentKey) {
                    titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')] = currentValue.join('\n').trim();
                }
                break;
            } else if (!inTitlePage && line.trim() !== '') {
                // Not a title page
                break;
            }
        }

        // Save last key-value if we ended without blank line
        if (currentKey && !titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')]) {
            titlePage[currentKey.toLowerCase().replace(/\s+/g, '_')] = currentValue.join('\n').trim();
        }

        return Object.keys(titlePage).length > 0 ? titlePage : null;
    }

    function saveTitlePage() {
        const modal = document.getElementById('titlePageModal');

        currentTitlePage = {
            title: document.getElementById('titlePageTitle').value.trim(),
            credit: document.getElementById('titlePageCredit').value.trim(),
            author: document.getElementById('titlePageAuthor').value.trim(),
            source: document.getElementById('titlePageSource').value.trim(),
            draft_date: document.getElementById('titlePageDraftDate').value.trim(),
            contact: document.getElementById('titlePageContact').value.trim(),
            copyright: document.getElementById('titlePageCopyright').value.trim(),
            notes: document.getElementById('titlePageNotes').value.trim(),
        };

        updateEditorTitlePage(currentTitlePage);

        // `open` is the class that shows a modal; removing `active` closed nothing.
        if (modal) closeModal('titlePageModal');
        editorDirty = true;
        triggerAutoSave();
        setStatus('Title page updated');
    }

    function clearTitlePage() {
        document.getElementById('titlePageTitle').value = '';
        document.getElementById('titlePageCredit').value = 'Written by';
        document.getElementById('titlePageAuthor').value = '';
        document.getElementById('titlePageSource').value = '';
        document.getElementById('titlePageDraftDate').value = '';
        document.getElementById('titlePageContact').value = '';
        document.getElementById('titlePageCopyright').value = '';
        document.getElementById('titlePageNotes').value = '';
    }

    /*
     * One renderer for the title page, used by the editor load and by a save.
     * There were two copies, and both escaped a `<br>` they had just inserted,
     * so a multi-line contact printed the letters "<br>". Newlines are kept as
     * text and shown by `white-space: pre-line`.
     */
    function titlePageInnerHtml(tp) {
        const row = (cls, v) => v ? `<div class="${cls}">${escapeHtml(v)}</div>` : '';
        return '<div class="title-page-content">'
            + row('title-page-title', tp.title) + row('title-page-credit', tp.credit)
            + row('title-page-author', tp.author) + row('title-page-source', tp.source)
            + row('title-page-draft', tp.draft_date) + row('title-page-contact', tp.contact)
            + row('title-page-copyright', tp.copyright) + row('title-page-notes', tp.notes)
            + '</div>';
    }

    function updateEditorTitlePage(titlePage) {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // Remove existing title page block if present
        const existingBlock = editor.querySelector('[data-element-type="title-page"]');
        if (existingBlock) {
            existingBlock.remove();
        }

        // Only add if there's content
        if (!titlePage.title && !titlePage.author) {
            renderTitlePageCard();
            return;
        }

        // Create title page block (non-editable display)
        const block = document.createElement('div');
        block.className = 'screenplay-block title-page-block';
        block.dataset.elementType = 'title-page';
        block.dataset.titlePageData = JSON.stringify(titlePage);
        block.contentEditable = 'false';
        block.onclick = () => openTitlePageModal();

        let html = titlePageInnerHtml(titlePage);
        html += '<button class="title-page-edit-btn" onclick="openTitlePageModal()" title="Edit Title Page">Edit</button>';

        block.innerHTML = html;

        // Insert at the beginning of editor
        editor.insertBefore(block, editor.firstChild);
        normalizeEditor();   // every way in leaves the editor sound
        renderTitlePageCard();
    }

    function serializeTitlePageToFountain(titlePage) {
        if (!titlePage || (!titlePage.title && !titlePage.author)) {
            return '';
        }

        const lines = [];

        if (titlePage.title) {
            lines.push(`Title: ${titlePage.title}`);
        }
        if (titlePage.credit) {
            lines.push(`Credit: ${titlePage.credit}`);
        }
        if (titlePage.author) {
            lines.push(`Author: ${titlePage.author}`);
        }
        if (titlePage.source) {
            lines.push(`Source: ${titlePage.source}`);
        }
        if (titlePage.draft_date) {
            lines.push(`Draft date: ${titlePage.draft_date}`);
        }
        if (titlePage.contact) {
            // Multi-line contact info needs indentation
            const contactLines = titlePage.contact.split('\n');
            lines.push(`Contact: ${contactLines[0]}`);
            for (let i = 1; i < contactLines.length; i++) {
                lines.push(`   ${contactLines[i]}`);
            }
        }
        if (titlePage.copyright) {
            lines.push(`Copyright: ${titlePage.copyright}`);
        }
        if (titlePage.notes) {
            const noteLines = titlePage.notes.split('\n');
            lines.push(`Notes: ${noteLines[0]}`);
            for (let i = 1; i < noteLines.length; i++) lines.push(`   ${noteLines[i]}`);
        }

        return lines.join('\n') + '\n\n';
    }

    let currentRevision = null;

    let currentRevisionPagesChanged = [];

    function updateRevisionIndicator() {
        const indicator = document.getElementById('revisionIndicator');
        const dot = document.getElementById('revisionDot');
        const label = document.getElementById('revisionLabel');
        const toggle = document.getElementById('markRevisionToggle');

        if (!indicator || !state.currentProject) return;

        if (currentRevision && currentRevision.revision_number) {
            indicator.style.display = 'inline-flex';
            dot.className = 'revision-dot ' + currentRevision.revision_color;
            label.textContent = `Rev ${currentRevision.revision_number} (${currentRevision.revision_color})`;

            // Show toggle for marking new revisions
            if (toggle) {
                toggle.style.display = 'flex';
            }
        } else {
            indicator.style.display = 'inline-flex';
            dot.className = 'revision-dot white';
            label.textContent = 'Draft';

            if (toggle) {
                toggle.style.display = 'flex';
            }
        }
    }

    function loadRevisionInfo(scriptData) {
        if (scriptData && scriptData.revision_number) {
            currentRevision = {
                revision_number: scriptData.revision_number,
                revision_color: scriptData.revision_color,
                revision_date: scriptData.revision_date
            };
            currentRevisionPagesChanged = scriptData.revision_pages_changed || [];
        } else {
            currentRevision = null;
            currentRevisionPagesChanged = [];
        }
        updateRevisionIndicator();
        updateRevisionPageMarkers();
    }

    function updateRevisionPageMarkers() {
        // Mark scenes in the navigator with revision colors
        const navItems = document.querySelectorAll('.scene-nav-item');

        navItems.forEach((item, index) => {
            // Remove existing revision dot
            const existingDot = item.querySelector('.revision-dot');
            if (existingDot) {
                existingDot.remove();
            }

            // Check if this scene's page is in the changed pages
            // Approximate: each scene is roughly 1 page
            const scenePage = index + 1;
            if (currentRevision && currentRevisionPagesChanged.includes(scenePage)) {
                const dot = document.createElement('span');
                dot.className = 'revision-dot ' + currentRevision.revision_color;
                dot.title = `Changed in revision ${currentRevision.revision_number}`;
                item.appendChild(dot);
            }
        });
    }

    function getMarkAsRevision() {
        const checkbox = document.getElementById('markAsRevisionCheckbox');
        return checkbox ? checkbox.checked : false;
    }

    // FILM-130: Export Functionality
    function toggleExportDropdown() {
        const dropdown = document.getElementById('exportDropdown');
        dropdown.classList.toggle('open');

        // Close on click outside
        const closeHandler = (e) => {
            if (!dropdown.contains(e.target)) {
                dropdown.classList.remove('open');
                document.removeEventListener('click', closeHandler);
            }
        };

        if (dropdown.classList.contains('open')) {
            // Delay to avoid immediate close
            setTimeout(() => {
                document.addEventListener('click', closeHandler);
            }, 10);
        }
    }

    function exportToFountain() {
        const editor = document.getElementById('screenplayEditor');
        const fountainText = serializeEditorToFountain(editor);

        if (!fountainText.trim()) {
            setStatus('Nothing to export');
            return;
        }

        // Generate filename
        const projectTitle = state.currentProject?.title || 'screenplay';
        const safeTitle = projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${safeTitle}.fountain`;

        // Create and download blob
        const blob = new Blob([fountainText], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, filename);

        setStatus(`Exported ${filename}`);
        document.getElementById('exportDropdown').classList.remove('open');
    }

    function exportToPlainText() {
        const editor = document.getElementById('screenplayEditor');
        const fountainText = serializeEditorToFountain(editor);

        if (!fountainText.trim()) {
            setStatus('Nothing to export');
            return;
        }

        // Convert Fountain to plain text
        const plainText = fountainToPlainText(fountainText);

        // Generate filename
        const projectTitle = state.currentProject?.title || 'screenplay';
        const safeTitle = projectTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const filename = `${safeTitle}.txt`;

        // Create and download blob
        const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
        downloadBlob(blob, filename);

        setStatus(`Exported ${filename}`);
        document.getElementById('exportDropdown').classList.remove('open');
    }

    function fountainToPlainText(fountain) {
        const lines = fountain.split('\n');
        const result = [];
        let prevWasBlank = true;

        for (const line of lines) {
            const trimmed = line.trim();

            // Skip title page key-value pairs at the start
            if (result.length === 0 && /^[A-Za-z][A-Za-z\s]*?:/.test(trimmed)) {
                continue;
            }

            // Remove Fountain markup
            let plainLine = trimmed
                .replace(/^\.\s*/, '')          // Forced scene heading
                .replace(/^@/, '')              // Forced character
                .replace(/^>\s*/, '')           // Forced transition or centered
                .replace(/\s*<$/, '')           // End of centered
                .replace(/^~\s*/, '')           // Lyrics
                .replace(/\[\[([^\]]*)\]\]/g, '$1')  // Notes
                .replace(/\*\*\*(.+?)\*\*\*/g, '$1') // Bold+italic
                .replace(/\*\*(.+?)\*\*/g, '$1')     // Bold
                .replace(/\*(.+?)\*/g, '$1')         // Italic
                .replace(/_(.+?)_/g, '$1')           // Underline
                .replace(/\s*\^$/, '')          // Dual dialogue marker
                .replace(/\s*#[^#]+#\s*$/, ''); // Scene numbers

            // Scene heading - add extra spacing
            if (/^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i.test(plainLine) || /^\./.test(trimmed)) {
                if (result.length > 0 && !prevWasBlank) {
                    result.push('');
                }
                result.push(plainLine.toUpperCase());
                prevWasBlank = false;
                continue;
            }

            // Character - center-ish with uppercase
            if (prevWasBlank && /^[A-Z][A-Z\s\-'\.]+$/.test(plainLine.replace(/\s*\([^)]*\)\s*$/, ''))) {
                result.push('');
                result.push('        ' + plainLine); // Indent character
                prevWasBlank = false;
                continue;
            }

            // Parenthetical
            if (/^\(.*\)$/.test(plainLine)) {
                result.push('      ' + plainLine);
                prevWasBlank = false;
                continue;
            }

            // Transition
            if (/^[A-Z\s]+TO:$/.test(plainLine) || /^[A-Z\s]+:$/.test(plainLine)) {
                result.push('');
                result.push('                                        ' + plainLine);
                result.push('');
                prevWasBlank = true;
                continue;
            }

            // Dialogue - indent
            if (!prevWasBlank && result.length > 0) {
                const prevLine = result[result.length - 1].trim();
                if (/^[A-Z][A-Z\s\-'\.]+$/.test(prevLine.replace(/\s*\([^)]*\)\s*$/, '')) ||
                    /^\(.*\)$/.test(prevLine)) {
                    result.push('    ' + plainLine);
                    prevWasBlank = false;
                    continue;
                }
            }

            // Regular line
            if (!trimmed) {
                prevWasBlank = true;
            } else {
                prevWasBlank = false;
            }
            result.push(plainLine);
        }

        return result.join('\n').trim();
    }

    async function exportToPDF() {
        const editor = document.getElementById('screenplayEditor');

        if (!editor.innerText.trim()) {
            setStatus('Nothing to export');
            return;
        }

        // Opened BEFORE anything is awaited: a pop-up opened after an await is
        // no longer the direct result of the click, and browsers block it.
        const printWindow = window.open('', '_blank');
        if (!printWindow) { setStatus('The browser blocked the print window — allow pop-ups for this page.'); return; }
        // Fresh, not the copy the gutter loaded: the numbers and eighths must
        // describe the draft being printed.
        await loadScriptTiming();

        /*
         * Paginate a DETACHED CLONE, never the live editor.
         *
         * The markers are what `.page-break-indicator { page-break-after:
         * always }` acts on in the print stylesheet, so without them the
         * browser breaks pages wherever it likes — including between a
         * character cue and its dialogue, which is the whole thing
         * MAY_END_PAGE exists to prevent. Doing it on a clone keeps the
         * editor a continuous scroll and keeps the PDF correctly paginated.
         */
        const printable = editor.cloneNode(true);
        paginateInto(printable);
        shootingScriptMarks(printable, SCRIPT_TIMING);
        toPrintSheets(printable);

        // Sanitize for print
        const content = printable.innerHTML
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '');

        // Generate print-ready HTML
        const projectTitle = state.currentProject?.title || 'Screenplay';
        const printHTML = generatePrintHTML(content, projectTitle);

        // Into the window opened before the timing was fetched.
        printWindow.document.write(printHTML);
        printWindow.document.close();

        // Wait for content to load, then print
        printWindow.onload = () => {
            try { fitPrintSheets(printWindow.document); } catch (_) { /* print what we have */ }
            printWindow.focus();
            printWindow.print();
        };

        setStatus('Opening print dialog for PDF export...');
        document.getElementById('exportDropdown').classList.remove('open');
    }

    /*
     * Each page as its own sheet, with its own margins.
     *
     * The browser prints its own header and footer — the date, the title and
     * the page's address — INSIDE the @page margins, and the address of a
     * pop-up written with document.write is "about:blank", which is what
     * appeared bottom-left on every page. With @page margins at zero there is
     * nowhere for them to go; the screenplay margins move onto these sheets,
     * which the paginator has already cut at legal breaks. Page numbers are
     * drawn the way a screenplay numbers them: top right, from page 2.
     */
    /*
     * A shooting script: every scene heading carries its scene number in BOTH
     * margins, and its length in page eighths under the right-hand one.
     *
     * Numbers and eighths come from the same /timing report the editor's gutter
     * shows, matched to the headings in order — the gutter's own rule — so the
     * page and the screen cannot disagree. A heading the report has no row for
     * (a scene typed since the last save) is numbered by position and printed
     * without eighths rather than with a guess.
     */
    function shootingScriptMarks(container, timing) {
        const scenes = timingRowsForHeadings(timing);
        const headings = [...container.querySelectorAll('[data-element-type="scene-heading"]')];
        headings.forEach((h, i) => {
            h.querySelectorAll('.scene-number-gutter').forEach(g => g.remove());
            const row = scenes[i] || null;
            const num = row && row.scene_number != null && row.scene_number !== '' ? row.scene_number : i + 1;
            const left = document.createElement('span');
            left.className = 'shoot-num shoot-num-left';
            left.textContent = num;
            const right = document.createElement('span');
            right.className = 'shoot-num shoot-num-right';
            right.textContent = num;
            if (row && row.eighths) {
                const e = document.createElement('span');
                e.className = 'shoot-eighths';
                e.textContent = row.eighths;
                right.appendChild(e);
            }
            h.classList.add('shoot-heading');
            h.prepend(left);
            h.appendChild(right);
        });
        return headings.length;
    }

    /**
     * The revision this draft is, as it should appear in the corner of a page.
     *
     * Production reads the revision off the page, not off the title page — a
     * page torn out of a folder has to say which draft it belongs to or it
     * cannot be filed, and "Rev C" living only in the title-page Notes means
     * every body page is anonymous. So it is stamped top-left of every page.
     *
     * Read from the script's own revision field when it has one, otherwise
     * lifted out of the Notes line where this production actually writes it
     * ("62 seconds. 16:9. Rev D."). Returns '' when the draft names no
     * revision, and an empty mark draws nothing rather than an empty box.
     */
    function revisionMark(container) {
        const block = (container || document).querySelector('.title-page-block');
        let data = {};
        if (block && block.dataset.titlePageData) {
            try { data = JSON.parse(block.dataset.titlePageData) || {}; } catch (_) { data = {}; }
        }
        const explicit = data.Revision || data.revision;
        if (explicit) return String(explicit).trim();
        const hay = [data.Notes, data.notes, data.Draft, data['Draft date']]
            .filter(Boolean).join(' ');
        const m = /\bRev(?:ision)?\.?\s*([A-Z0-9][A-Za-z0-9.\-]*)/.exec(hay);
        return m ? ('Rev ' + m[1]) : '';
    }

    function toPrintSheets(container) {
        const rev = revisionMark(container);
        const sheets = [];
        let cur = null;
        for (const node of [...container.childNodes]) {
            if (node.nodeType === 1 && node.classList.contains('title-page-block')) {
                const tp = document.createElement('div');
                tp.className = 'print-sheet print-title-sheet';
                tp.appendChild(node);
                sheets.push(tp);
                cur = null;
                continue;
            }
            if (node.nodeType === 1 && node.classList.contains('page-break-indicator')) { cur = null; continue; }
            if (!cur) {
                if (node.nodeType !== 1 && !String(node.textContent || '').trim()) continue;
                cur = document.createElement('div');
                cur.className = 'print-sheet';
                sheets.push(cur);
            }
            cur.appendChild(node);
        }
        container.innerHTML = '';
        let n = 0;
        for (const sheet of sheets) {
            if (!sheet.classList.contains('print-title-sheet')) {
                n++;
                if (n > 1) {
                    const num = document.createElement('div');
                    num.className = 'print-page-number';
                    num.textContent = n + '.';
                    sheet.prepend(num);
                }
                // Top LEFT, opposite the page number, on every body page
                // including the first — the first page is the one most likely
                // to be handed to somebody on its own.
                if (rev) {
                    const r = document.createElement('div');
                    r.className = 'print-revision-mark';
                    r.textContent = rev;
                    sheet.prepend(r);
                }
            }
            container.appendChild(sheet);
        }
        return sheets.length;
    }

    /*
     * MEASURED, NOT ESTIMATED: make every sheet actually fit.
     *
     * paginateInto places breaks from a line ESTIMATE (characters per line,
     * a fixed count per element), and the estimate runs short — word wrap
     * wastes characters, and the print sheet's own spacing (a blank line after
     * every dialogue block, two before every heading) is not all counted. A
     * sheet is a fixed 11 inches, so an overfull one did not stretch: it spilled
     * onto the next physical page and pushed every page after it down, which is
     * the text "bleeding" past the top and bottom of the paper.
     *
     * So, in the print window, with the print stylesheet laid out: while a
     * sheet's content is taller than the sheet, move its last block to the top
     * of the next sheet — and keep moving while the new last block is one a
     * page may not end on (MAY_END_PAGE), so a cue or heading goes over with
     * what it introduces. Overflow cascades forward; page numbers are redrawn.
     */
    function fitPrintSheets(doc) {
        const isFurniture = el => el.classList.contains('print-page-number') || el.classList.contains('print-revision-mark');
        const content = sheet => [...sheet.children].filter(el => !isFurniture(el));
        const overfull = sheet => sheet.scrollHeight > sheet.clientHeight;
        const revText = (doc.querySelector('.print-revision-mark') || {}).textContent || '';
        let sheets = [...doc.querySelectorAll('.print-sheet:not(.print-title-sheet)')];
        let moved = 0;
        for (let s = 0; s < sheets.length; s++) {
            const sheet = sheets[s];
            let guard = 0;
            while (overfull(sheet) && content(sheet).length > 1 && guard++ < 500) {
                let next = sheets[s + 1];
                if (!next) {
                    next = doc.createElement('div');
                    next.className = 'print-sheet';
                    sheet.after(next);
                    sheets.splice(s + 1, 0, next);
                }
                const moveLast = () => {
                    const blocks = content(sheet);
                    const last = blocks[blocks.length - 1];
                    const first = content(next)[0] || null;
                    next.insertBefore(last, first);
                    moved++;
                };
                moveLast();
                let keep = 0;
                while (content(sheet).length > 1 && keep++ < 20) {
                    const blocks = content(sheet);
                    const t = blocks[blocks.length - 1].dataset && blocks[blocks.length - 1].dataset.elementType;
                    if (MAY_END_PAGE[t] === false) moveLast(); else break;
                }
            }
        }
        // Redraw the furniture: numbers from page 2, the revision on every body page.
        doc.querySelectorAll('.print-page-number, .print-revision-mark').forEach(el => el.remove());
        sheets = [...doc.querySelectorAll('.print-sheet:not(.print-title-sheet)')];
        sheets.forEach((sheet, i) => {
            if (i > 0) {
                const num = doc.createElement('div');
                num.className = 'print-page-number';
                num.textContent = (i + 1) + '.';
                sheet.prepend(num);
            }
            if (revText) {
                const r = doc.createElement('div');
                r.className = 'print-revision-mark';
                r.textContent = revText;
                sheet.prepend(r);
            }
        });
        return moved;
    }

    function generatePrintHTML(editorContent, title) {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>${escapeHtml(title)}</title>
    <style>
        /* Zero margins: the browser draws its header and footer (date, title,
           "about:blank") in the page margins, so none leaves nothing to draw
           them in. The screenplay margins live on each .print-sheet. */
        @page {
            size: letter;
            margin: 0;
        }
        /* A hair under 11in and clipped: a sheet exactly as tall as the paper,
           with even a pixel of rounded line-height past its edge, spills that
           pixel onto the next physical page and shifts every page after it —
           text "bleeding" off the top and bottom. fitPrintSheets moves real
           overflow to the next sheet first, so the clip only ever removes
           sub-line rounding. */
        .print-sheet {
            position: relative;
            width: 8.5in;
            height: 10.96in;
            overflow: hidden;
            padding: 1in 1in 0.5in 1.5in;
            box-sizing: border-box;
            page-break-after: always;
            break-after: page;
            page-break-inside: avoid;
            break-inside: avoid;
        }
        .print-sheet:last-child { page-break-after: auto; break-after: auto; }
        /* The first line of a page starts at the margin, not a heading's 24pt below it. */
        .print-sheet > [data-element-type]:first-of-type,
        .print-sheet > .print-revision-mark + [data-element-type],
        .print-sheet > .print-page-number + [data-element-type] { margin-top: 0; }
        .print-page-number { position: absolute; top: 0.5in; right: 1in; }
        /* The revision, opposite the page number. Left margin is 1.5in, so it
           sits under the binding edge rather than over the text block. */
        .print-revision-mark { position: absolute; top: 0.5in; left: 1in; font-size: 10pt; }
        /* Shooting-script scene numbers, both margins; eighths under the right. */
        .shoot-heading { position: relative; }
        .shoot-num { position: absolute; top: 0; font-weight: bold; }
        .shoot-num-left { left: -0.9in; }
        .shoot-num-right { right: -0.75in; text-align: right; }
        .shoot-eighths { display: block; font-weight: normal; font-size: 9pt; margin-top: 2pt; }
        .title-page-copyright { font-size: 10pt; margin-top: 12pt; }
        .title-page-notes { font-size: 10pt; margin-top: 12pt; white-space: pre-line; }
        body {
            font-family: 'Courier New', Courier, monospace;
            font-size: 12pt;
            line-height: 1;
            color: black;
            background: white;
            margin: 0;
            padding: 0;
        }
        /* Title Page */
        .title-page-block {
            text-align: center;
            padding-top: 2in;
        }
        .title-page-title { font-size: 24pt; text-transform: uppercase; margin-bottom: 36pt; font-weight: normal; }
        .title-page-credit { font-size: 12pt; margin-bottom: 12pt; }
        .title-page-author { font-size: 12pt; margin-bottom: 72pt; }
        .title-page-source { font-size: 12pt; font-style: italic; margin-bottom: 24pt; }
        .title-page-draft { font-size: 10pt; margin-bottom: 6pt; }
        .title-page-contact { font-size: 10pt; white-space: pre-line; }
        .title-page-content { padding: 0; }
        .title-page-edit-btn { display: none; }
        /* Scene Heading */
        .sp-scene-heading, [data-element-type="scene-heading"] {
            margin-top: 24pt;
            margin-bottom: 12pt;
            font-weight: bold;
            text-transform: uppercase;
        }
        /* Action */
        .sp-action, [data-element-type="action"] {
            margin-bottom: 12pt;
        }
        /* Character */
        .sp-character, [data-element-type="character"] {
            margin-top: 12pt;
            margin-left: 2in;
            text-transform: uppercase;
        }
        /* Parenthetical */
        .sp-parenthetical, [data-element-type="parenthetical"] {
            margin-left: 1.5in;
            max-width: 2.5in;
        }
        /* Dialogue */
        .sp-dialogue, [data-element-type="dialogue"] {
            margin-left: 1in;
            max-width: 3.5in;
            margin-bottom: 12pt;
        }
        /* Transition */
        .sp-transition, [data-element-type="transition"] {
            text-align: right;
            margin-top: 12pt;
            margin-bottom: 12pt;
        }
        /* Centered */
        .sp-centered, [data-element-type="centered"] {
            text-align: center;
        }
        /* Lyrics */
        .sp-lyrics, [data-element-type="lyrics"] {
            font-style: italic;
            margin-left: 1in;
        }
        /* Note - hidden in print */
        .sp-note, [data-element-type="note"] {
            display: none;
        }
        /* Page breaks */
        .page-break-indicator {
            page-break-after: always;
        }
        /* Scene number gutter */
        .scene-number-gutter {
            display: none;
        }
    


</style>
</head>
<body>
    ${editorContent}


</body>
</html>`;
    }

    function downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // FILM-131: Import Script Functions
    function openImportModal() {
        resetImportModal();
        showModal('importScriptModal');
    }

    function resetImportModal() {
        // Show dropzone, hide progress and result
        document.getElementById('importDropzone').style.display = 'block';
        document.getElementById('importProgress').classList.remove('active');
        document.getElementById('importResult').classList.remove('active');
        document.getElementById('importFileInput').value = '';
        document.getElementById('importWarnings').style.display = 'none';
    }

    function handleDragEnter(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('importDropzone').classList.add('dragover');
    }

    function handleDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('importDropzone').classList.remove('dragover');
    }

    function handleDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    function handleFileDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        document.getElementById('importDropzone').classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processImportFile(files[0]);
        }
    }

    function handleFileSelect(e) {
        const files = e.target.files;
        if (files.length > 0) {
            processImportFile(files[0]);
        }
    }

    async function processImportFile(file) {
        const filename = file.name.toLowerCase();
        const isFDX = filename.endsWith('.fdx') || filename.endsWith('.xml');
        const isFountain = filename.endsWith('.fountain') || filename.endsWith('.txt');

        if (!isFDX && !isFountain) {
            showImportError('Unsupported file type. Please use .fdx, .fountain, or .txt files.');
            return;
        }

        // Show progress
        document.getElementById('importDropzone').style.display = 'none';
        document.getElementById('importProgress').classList.add('active');
        document.getElementById('importProgressText').textContent = isFDX ?
            'Parsing Final Draft file...' : 'Reading Fountain file...';

        try {
            const content = await readFileAsText(file);

            if (isFDX) {
                await importFDXContent(content);
            } else {
                await importFountainContent(content);
            }
        } catch (err) {
            showImportError('Error reading file: ' + err.message);
        }
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    async function importFDXContent(fdxContent) {
        if (!state.currentProject) {
            showImportError('Please select a project first.');
            return;
        }

        document.getElementById('importProgressText').textContent = 'Converting to Fountain format...';

        try {
            const data = await api('/projects/' + state.currentProject.id + '/script/import-fdx', {
                method: 'POST',
                body: JSON.stringify({ fdx_content: fdxContent })
            });

            // Show success
            showImportSuccess(data, 'Final Draft');
        } catch (err) {
            showImportError('Import failed: ' + err.message);
        }
    }

    async function importFountainContent(fountainContent) {
        if (!state.currentProject) {
            showImportError('Please select a project first.');
            return;
        }

        document.getElementById('importProgressText').textContent = 'Saving script...';

        try {
            const data = await api('/projects/' + state.currentProject.id + '/script', {
                method: 'POST',
                body: JSON.stringify({ fountain_content: fountainContent })
            });

            // Show success
            showImportSuccess(data, 'Fountain');
        } catch (err) {
            showImportError('Import failed: ' + err.message);
        }
    }

    function showImportSuccess(data, format) {
        document.getElementById('importProgress').classList.remove('active');
        document.getElementById('importResult').classList.add('active');

        document.getElementById('importResultIcon').innerHTML = '<span style="font-size:48px;color:var(--gl-success);">✓</span>';
        document.getElementById('importResultMessage').innerHTML = `<strong class="import-result-success">Import Successful</strong>`;

        // Build stats
        const script = data.script || {};
        const scenesCount = data.scenes_extracted || script.scene_count || 0;
        const wordCount = script.word_count || 0;
        const pageCount = script.page_count || 0;

        let statsHtml = `
            <div class="import-stats-item"><span>Format:</span><span>${format}</span></div>
            <div class="import-stats-item"><span>Scenes:</span><span>${scenesCount}</span></div>
            <div class="import-stats-item"><span>Words:</span><span>${wordCount.toLocaleString()}</span></div>
            <div class="import-stats-item"><span>Pages:</span><span>${pageCount}</span></div>
            <div class="import-stats-item"><span>Version:</span><span>v${script.version}</span></div>
        `;
        document.getElementById('importStats').innerHTML = statsHtml;

        // Show warnings if any
        if (data.import_metadata && data.import_metadata.warnings && data.import_metadata.warnings.length > 0) {
            const warningsDiv = document.getElementById('importWarnings');
            warningsDiv.style.display = 'block';
            warningsDiv.innerHTML = `
                <div class="import-warnings-title">Warnings</div>
                <ul style="margin:0;padding-left:16px;font-size:11px;">
                    ${data.import_metadata.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
                </ul>
            `;
        }

        // Load the imported content into editor
        if (script.fountain_content || data.script.fountain_content) {
            currentFountainContent = script.fountain_content || data.script.fountain_content;
            currentScriptVersion = script.version;
            renderFountainToEditor(currentFountainContent);
            updateEditorStats();
            updateSaveStatus('saved');
            loadRevisionInfo(script);
            loadScriptVersions();
        }

        setStatus(`Imported ${format} script - ${scenesCount} scenes`);
    }

    function showImportError(message) {
        document.getElementById('importProgress').classList.remove('active');
        document.getElementById('importResult').classList.add('active');

        document.getElementById('importResultIcon').innerHTML = '<span style="font-size:48px;color:var(--gl-error);">✗</span>';
        document.getElementById('importResultMessage').innerHTML = `<strong class="import-result-error">${escapeHtml(message)}</strong>`;
        document.getElementById('importStats').innerHTML = '';
    }

    // Panel Toggle Functions
    function toggleLeftPanel() {
        const panel = document.getElementById('leftToolbarPanel');
        const btn = panel.querySelector('.panel-toggle-btn');
        panel.classList.toggle('collapsed');
        btn.textContent = panel.classList.contains('collapsed') ? '▶' : '◀';
    }

    function toggleRightPanel() {
        const panel = document.getElementById('rightSidebarPanel');
        const btn = panel.querySelector('.panel-toggle-btn');
        panel.classList.toggle('collapsed');
        btn.textContent = panel.classList.contains('collapsed') ? '◀' : '▶';
    }

    // FILM-116: Quick stats summary update without full recalculation
    function updateScriptStatsSummary() {
        const editor = document.getElementById('screenplayEditor');
        const summary = document.getElementById('scriptStatsSummary');
        if (!editor || !summary) return;

        // Quick word count and scene count
        const text = editor.innerText || '';
        const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
        const sceneCount = (text.match(/^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/gim) || []).length;

        summary.textContent = wordCount > 0 ? `${wordCount.toLocaleString()} words · ${sceneCount} scenes` : '';
    }

    // Update current scene highlight based on cursor position
    function updateCurrentSceneHighlight() {
        const block = getCurrentBlock();
        if (!block) return;

        const editor = document.getElementById('screenplayEditor');
        const blocks = editor.querySelectorAll('[data-element-type]');

        // Find which scene the cursor is in
        let sceneIndex = -1;
        for (const b of blocks) {
            if (b.dataset.elementType === 'scene-heading') {
                sceneIndex++;
            }
            if (b === block || b.contains(block)) {
                break;
            }
        }

        if (sceneIndex !== currentSceneIndex) {
            currentSceneIndex = sceneIndex;

            // Update highlight in nav
            const navItems = document.querySelectorAll('.scene-nav-item');
            navItems.forEach((item, i) => {
                item.classList.toggle('current', i === currentSceneIndex);
            });

            // Scroll nav to show current scene
            const currentItem = document.querySelector('.scene-nav-item.current');
            if (currentItem) {
                currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
        }
    }

    function toggleSceneNavigator() {
        const nav = document.getElementById('sceneNavigator');
        const isVisible = nav.style.display !== 'none';
        nav.style.display = isVisible ? 'none' : 'block';

        if (!isVisible) {
            // Update when opening
            updateSceneNavigator();
            updateCurrentSceneHighlight();
        }
    }

    function scrollToScene(index) {
        const editor = document.getElementById('screenplayEditor');
        const headings = editor.querySelectorAll('[data-element-type="scene-heading"]');
        if (headings[index]) {
            headings[index].scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Place cursor at the scene heading
            setCursorToBlock(headings[index]);
            currentSceneIndex = index;

            // Update nav highlight
            const navItems = document.querySelectorAll('.scene-nav-item');
            navItems.forEach((item, i) => {
                item.classList.toggle('current', i === index);
            });
        }
    }

    // FILM-107: Scene numbering functions
    function toggleLockSceneNumbers() {
        sceneNumbersLocked = !sceneNumbersLocked;
        const btn = document.getElementById('lockSceneNumsBtn');
        if (btn) {
            btn.textContent = sceneNumbersLocked ? '🔒' : '🔓';
            btn.classList.toggle('active', sceneNumbersLocked);
            btn.title = sceneNumbersLocked ? 'Unlock Scene Numbers' : 'Lock Scene Numbers';
        }
        // Update gutter display to show locked state
        updateSceneNumberGutters();
    }

    function updateSceneNumbers() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        const sceneHeadings = editor.querySelectorAll('[data-element-type="scene-heading"]');
        let autoNum = 0;

        sceneHeadings.forEach(heading => {
            autoNum++;

            if (!sceneNumbersLocked) {
                // When unlocked, auto-calculate sequential numbers
                heading.dataset.sceneNumber = String(autoNum);
            }
            // When locked, preserve existing data-scene-number attributes

            // Update the gutter display
            updateSceneGutter(heading);
        });
    }

    function updateSceneGutter(heading) {
        // Remove existing gutter span if any
        let gutter = heading.querySelector('.scene-number-gutter');
        if (!gutter) {
            gutter = document.createElement('span');
            gutter.className = 'scene-number-gutter';
            gutter.contentEditable = 'false';
            heading.insertBefore(gutter, heading.firstChild);

            // Double-click to edit scene number
            gutter.addEventListener('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startEditSceneNumber(heading, gutter);
            });
        }

        const sceneNum = heading.dataset.sceneNumber || '';
        gutter.textContent = sceneNum;
        gutter.classList.toggle('locked', sceneNumbersLocked);
    }

    function updateSceneNumberGutters() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        const sceneHeadings = editor.querySelectorAll('[data-element-type="scene-heading"]');
        sceneHeadings.forEach(heading => {
            updateSceneGutter(heading);
        });
    }

    function startEditSceneNumber(heading, gutter) {
        // Make gutter editable
        gutter.classList.add('editing');
        gutter.contentEditable = 'true';
        gutter.focus();

        // Select all text
        const range = document.createRange();
        range.selectNodeContents(gutter);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        // Handle blur to save
        const finishEdit = () => {
            const newNum = gutter.textContent.trim();
            if (newNum) {
                heading.dataset.sceneNumber = newNum;
                // Lock numbers when manually edited
                if (!sceneNumbersLocked) {
                    toggleLockSceneNumbers();
                }
            }
            gutter.contentEditable = 'false';
            gutter.classList.remove('editing');
            gutter.classList.toggle('locked', sceneNumbersLocked);
            gutter.removeEventListener('blur', finishEdit);
            gutter.removeEventListener('keydown', handleEditKey);
        };

        const handleEditKey = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                gutter.blur();
            } else if (e.key === 'Escape') {
                // Restore original
                gutter.textContent = heading.dataset.sceneNumber || '';
                gutter.blur();
            }
        };

        gutter.addEventListener('blur', finishEdit);
        gutter.addEventListener('keydown', handleEditKey);
    }

    // FILM-111: AI Chat Panel functions
    function toggleAIChat() {
        if (window.__filmOpenAIWorkspace) return window.__filmOpenAIWorkspace();
        const panel = document.getElementById('aiChatPanel');
        const btn = document.getElementById('aiChatToggle');
        if (panel) {
            const isVisible = panel.classList.toggle('visible');
            // The moment the panel opens is the moment the answer matters, and
            // it is the last chance to say so before a request is sent.
            if (isVisible) aiPathBadge();
            if (btn) {
                btn.classList.toggle('active', isVisible);
            }
            // Load chat history when opening
            if (isVisible && state.currentProject) {
                loadAIChatHistory();
            }
        }
    }

    function loadAIChatHistory() {
        if (!state.currentProject) return;
        const key = `aiChat_${state.currentProject.id}`;
        const saved = legacy.feStore.get(key);
        if (saved) {
            try {
                state.aiChat = JSON.parse(saved);
                renderAIChatMessages();
            } catch (e) {
                state.aiChat = [];
            }
        } else {
            state.aiChat = [];
        }
    }

    function saveAIChatHistory() {
        if (!state.currentProject) return;
        const key = `aiChat_${state.currentProject.id}`;
        legacy.feStore.set(key, JSON.stringify(state.aiChat || []));
    }

    function renderAIChatMessages() {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;

        // Keep the initial welcome message if no history
        if (!state.aiChat || state.aiChat.length === 0) {
            container.innerHTML = `
                <div class="ai-chat-message assistant">
                    Hi! I can help you brainstorm ideas, write scenes, rewrite dialogue, or convert content to screenplay format. What would you like to work on?
                </div>
            `;
            return;
        }

        container.innerHTML = state.aiChat.map((msg, i) => {
            const isScreenplay = msg.role === 'assistant' && msg.hasScreenplay;
            const isRewrite = msg.role === 'assistant' && msg.mode === 'rewrite' && msg.originalContent;

            // FILM-114: Special rendering for rewrite mode with diff view
            if (isRewrite) {
                const diffHtml = generateDiffView(msg.originalContent, msg.rawContent);
                return `
                    <div class="ai-chat-message ${msg.role}">
                        <div style="margin-bottom:8px;">Rewrite suggestion:</div>
                        <div class="ai-diff-view">${diffHtml}</div>
                        <div class="ai-rewrite-buttons">
                            <button class="insert-btn accept-btn" onclick="acceptRewrite(${i})">Accept Rewrite</button>
                            <button class="insert-btn reject-btn" onclick="rejectRewrite(${i})">Reject</button>
                        </div>
                    </div>
                `;
            }

            // Action buttons for assistant messages
            let actionButtons = '';
            if (msg.role === 'assistant') {
                if (isScreenplay && msg.isValidFountain) {
                    actionButtons = `
                        <div class="ai-action-buttons" style="display:flex;gap:6px;flex-wrap:wrap;">
                            <button class="insert-btn" onclick="insertAIContentAtCursor(${i})">Insert at Cursor</button>
                            <button class="insert-btn" onclick="appendAIContent(${i})">Append to Script</button>
                            <button class="insert-btn" style="background:var(--gl-warning);" onclick="replaceCurrentScene(${i})">Replace Scene</button>
                        </div>
                    `;
                } else if (isScreenplay) {
                    actionButtons = `<button class="insert-btn" onclick="insertAIContent(${i})">Insert into Editor</button>`;
                }
            }

            // Copy + Insert at Cursor bar on all assistant messages
            const msgActions = msg.role === 'assistant' ? `
                <div class="ai-msg-actions">
                    <button onclick="copyAIMessage(${i})">Copy</button>
                    <button onclick="insertAITextAtCursor(${i})">Insert at Cursor</button>
                </div>
            ` : '';

            return `
                <div class="ai-chat-message ${msg.role}">
                    ${escapeHtml(msg.content)}
                    ${isScreenplay ? `<div class="screenplay-preview">${msg.screenplayHtml || ''}</div>${actionButtons}` : ''}
                    ${msgActions}
                </div>
            `;
        }).join('');

        // Scroll to bottom
        container.scrollTop = container.scrollHeight;
    }

    function handleAIChatKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            sendAIMessage();
        }
    }

    // ── Streaming helpers ──────────────────────────────────────────

    /**
     * POST-based SSE reader. Sends a POST request and reads the SSE stream.
     * Parses named events (event: + data:) and calls callbacks.
     */
    async function streamPostSSE(url, body, callbacks) {
        const cb = callbacks || {};
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(text || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentEvent = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (line.startsWith('event: ')) {
                    currentEvent = line.slice(7).trim();
                    continue;
                }
                if (!line.startsWith('data: ')) continue;
                const dataStr = line.slice(6).trim();
                if (!dataStr || dataStr === '[DONE]') continue;
                try {
                    const data = JSON.parse(dataStr);
                    if (currentEvent === 'chunk' && cb.onChunk) {
                        cb.onChunk(data.text || '');
                    } else if (currentEvent === 'done' && cb.onDone) {
                        cb.onDone(data);
                    } else if (currentEvent === 'error' && cb.onError) {
                        cb.onError(data.message || 'Unknown error');
                    } else if (currentEvent === 'status' && cb.onStatus) {
                        cb.onStatus(data);
                    }
                } catch (_) { /* skip unparseable */ }
                currentEvent = '';
            }
        }
    }

    /** Show animated typing dots in the chat messages area */
    function showTypingIndicator() {
        const container = document.getElementById('aiChatMessages');
        if (!container) return;
        // Remove existing indicator if any
        removeTypingIndicator();
        const indicator = document.createElement('div');
        indicator.className = 'ai-typing-indicator';
        indicator.id = 'aiTypingIndicator';
        indicator.innerHTML = '<span></span><span></span><span></span>';
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    }

    /** Remove the typing indicator */
    function removeTypingIndicator() {
        const el = document.getElementById('aiTypingIndicator');
        if (el) el.remove();
    }

    /** Copy AI message content to clipboard */
    function copyAIMessage(index) {
        const msg = (state.aiChat || [])[index];
        if (!msg) return;
        const text = msg.rawContent || msg.content || '';
        navigator.clipboard.writeText(text).then(() => {
            setStatus('Copied to clipboard');
        });
    }

    /** Insert plain text AI content at cursor position */
    function insertAITextAtCursor(index) {
        const msg = (state.aiChat || [])[index];
        if (!msg) return;
        const text = msg.rawContent || msg.content || '';
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // If the message contains Fountain-like content, use Fountain insert
        if (msg.hasScreenplay || msg.isValidFountain) {
            insertAIContentAtCursor(index);
            return;
        }

        // Otherwise insert as plain text into editor
        const block = getCurrentBlock();
        if (block) {
            const newDiv = document.createElement('div');
            newDiv.dataset.elementType = 'action';
            newDiv.className = 'element-action';
            newDiv.textContent = text;
            block.after(newDiv);
        } else {
            const newDiv = document.createElement('div');
            newDiv.dataset.elementType = 'action';
            newDiv.className = 'element-action';
            newDiv.textContent = text;
            editor.appendChild(newDiv);
            normalizeEditor();   // every way in leaves the editor sound
        }
        editorDirty = true;
        triggerAutoSave();
        setStatus('AI content inserted');
    }

    async function aiPathBadge() {
        const el = document.getElementById('aiPathBadge');
        if (!el) return;
        // Cheap and cached: presence changes on the scale of a session, not a
        // keystroke, and asking on every render would spend a request per typed
        // character to learn the same thing.
        if (Date.now() - AI_PATH.checked > 60000) {
            try {
                const r = await api('/agent');
                AI_PATH.connected = !!r.connected;
                AI_PATH.client = r.client;
                AI_PATH.alternatives = r.ai_endpoints || [];
            } catch (_) { AI_PATH.connected = false; }
            AI_PATH.checked = Date.now();
        }

        el.style.display = 'block';
        if (AI_PATH.connected) {
            el.style.background = 'rgba(34,197,94,0.10)';
            el.innerHTML = `<strong>${esc(AI_PATH.client || 'An agent host')} is connected.</strong> `
                + 'Ask it to do the writing — it already has your screenplay in context and costs nothing '
                + 'extra. Using this panel instead sends the request to the server and spends this '
                + 'project\u2019s API key.';
        } else {
            el.style.background = 'rgba(245,158,11,0.10)';
            el.innerHTML = '<strong>No agent host connected.</strong> This panel will use the server-side '
                + 'model and spend this project\u2019s API key. Connect Claude Desktop to the MCP server '
                + 'and the same work is done by the model you are already talking to.';
        }
    }

    async function sendAIMessage() {
        const input = document.getElementById('aiChatInput');
        const sendBtn = document.getElementById('aiSendBtn');
        const mode = document.getElementById('aiChatMode').value;
        const message = input.value.trim();

        if (!message) return;

        // Add user message
        if (!state.aiChat) state.aiChat = [];
        state.aiChat.push({ role: 'user', content: message });

        // Clear input and disable send
        input.value = '';
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending...';

        // Render user message immediately then show typing dots
        aiPathBadge();
        renderAIChatMessages();
        showTypingIndicator();

        try {
            if (!state.currentProject) {
                throw new Error('No project selected');
            }

            // Build conversation history for context
            const conversationHistory = (state.aiChat || [])
                .slice(-10)
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role, content: m.content }));

            // FILM-114: Get selected text for rewrite mode
            let originalContent = '';
            let selectedBlocks = [];
            if (mode === 'rewrite') {
                const result = getSelectedEditorContent();
                originalContent = result.content;
                selectedBlocks = result.blocks;
                if (!originalContent) {
                    throw new Error('Please select text in the editor to rewrite');
                }
            }

            // FILM-115: Get current scene context
            const includeSceneContext = document.getElementById('aiIncludeSceneContext')?.checked ?? true;
            const currentSceneFountain = includeSceneContext ? getCurrentSceneFountain() : '';

            // Stream AI response via SSE
            const container = document.getElementById('aiChatMessages');
            let accumulated = '';
            let liveBubble = null;

            await streamPostSSE(
                API() + `/projects/${state.currentProject.id}/screenplay-ai/stream`,
                {
                    mode: mode,
                    message: message,
                    conversation_history: conversationHistory.slice(0, -1),
                    original_content: originalContent,
                    current_scene_fountain: currentSceneFountain
                },
                {
                    onChunk: (text) => {
                        // First chunk: remove dots, create live bubble
                        if (!liveBubble) {
                            removeTypingIndicator();
                            liveBubble = document.createElement('div');
                            liveBubble.className = 'ai-chat-message assistant streaming';
                            container.appendChild(liveBubble);
                        }
                        accumulated += text;
                        liveBubble.textContent = accumulated;
                        container.scrollTop = container.scrollHeight;
                    },
                    onDone: () => {
                        removeTypingIndicator();
                    },
                    onError: (msg) => {
                        removeTypingIndicator();
                        if (!accumulated) {
                            accumulated = `Sorry, I encountered an error: ${msg}`;
                        }
                    }
                }
            );

            // Remove the live bubble — we'll re-render via renderAIChatMessages
            if (liveBubble) liveBubble.remove();

            // Finalize: add to chat state with full metadata
            const content = accumulated || '(No response received)';
            const hasScreenplay = /^(INT\.|EXT\.|\.|\@|>)/m.test(content);
            const screenplayHtml = hasScreenplay ? parseFountainToHTML(content) : '';

            state.aiChat.push({
                role: 'assistant',
                content: content,
                hasScreenplay: hasScreenplay,
                screenplayHtml: screenplayHtml,
                rawContent: content,
                mode: mode,
                isValidFountain: hasScreenplay,
                originalContent: originalContent,
                selectedBlocks: selectedBlocks
            });

            saveAIChatHistory();
            renderAIChatMessages();

        } catch (error) {
            removeTypingIndicator();
            state.aiChat.push({
                role: 'assistant',
                content: `Sorry, I encountered an error: ${error.message}. The AI endpoint may not be configured yet.`
            });
            renderAIChatMessages();
        } finally {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send';
        }
    }

    // FILM-114: Get selected content from editor for rewrite mode
    function getSelectedEditorContent() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            return { content: '', blocks: [] };
        }

        const range = selection.getRangeAt(0);
        const editor = document.getElementById('screenplayEditor');
        if (!editor || !editor.contains(range.commonAncestorContainer)) {
            return { content: '', blocks: [] };
        }

        // Get all blocks that intersect with the selection
        const blocks = [];
        const allBlocks = editor.querySelectorAll('[data-element-type]');
        for (const block of allBlocks) {
            if (range.intersectsNode(block)) {
                blocks.push(block);
            }
        }

        // Get text content
        let content = '';
        for (const block of blocks) {
            let text = '';
            for (const child of block.childNodes) {
                if (child.nodeType === Node.TEXT_NODE) {
                    text += child.textContent;
                } else if (child.nodeType === Node.ELEMENT_NODE &&
                           !child.classList.contains('scene-number-gutter')) {
                    text += child.innerText || '';
                }
            }
            if (text.trim()) {
                content += text.trim() + '\n';
            }
        }

        return { content: content.trim(), blocks: blocks };
    }

    // FILM-114: Generate diff view comparing original and new content
    function generateDiffView(original, rewritten) {
        const origLines = original.split('\n').filter(l => l.trim());
        const newLines = rewritten.split('\n').filter(l => l.trim());

        let html = '';
        const maxLen = Math.max(origLines.length, newLines.length);

        // Simple line-by-line comparison
        for (let i = 0; i < maxLen; i++) {
            const origLine = origLines[i] || '';
            const newLine = newLines[i] || '';

            if (!origLine && newLine) {
                html += `<div class="ai-diff-line added">+ ${escapeHtml(newLine)}</div>`;
            } else if (origLine && !newLine) {
                html += `<div class="ai-diff-line removed">- ${escapeHtml(origLine)}</div>`;
            } else if (origLine !== newLine) {
                html += `<div class="ai-diff-line removed">- ${escapeHtml(origLine)}</div>`;
                html += `<div class="ai-diff-line added">+ ${escapeHtml(newLine)}</div>`;
            } else {
                html += `<div class="ai-diff-line unchanged">  ${escapeHtml(origLine)}</div>`;
            }
        }

        return html;
    }

    // FILM-114: Accept rewrite - replace selected blocks with new content
    function acceptRewrite(messageIndex) {
        const msg = state.aiChat[messageIndex];
        if (!msg || !msg.rawContent) return;

        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // Find the selected blocks again (or use stored reference)
        const result = getSelectedEditorContent();
        if (result.blocks.length === 0) {
            // Fall back to inserting at current position
            insertAIContentAtCursor(messageIndex);
            return;
        }

        // Parse new content
        const html = parseFountainToHTML(msg.rawContent);
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Insert new content before first selected block
        const firstBlock = result.blocks[0];
        for (const newBlock of temp.children) {
            firstBlock.before(newBlock.cloneNode(true));
        }

        // Remove old blocks
        result.blocks.forEach(b => b.remove());

        editorDirty = true;
        triggerAutoSave();
        triggerSceneNavUpdate();
        updateSceneNumbers();
        setStatus('Rewrite accepted');
    }

    // FILM-114: Reject rewrite - dismiss the suggestion
    function rejectRewrite(messageIndex) {
        setStatus('Rewrite rejected');
    }

    // FILM-113: Insert AI content at cursor position
    function insertAIContent(messageIndex) {
        insertAIContentAtCursor(messageIndex);
    }

    function insertAIContentAtCursor(messageIndex) {
        const msg = state.aiChat[messageIndex];
        if (!msg || !msg.rawContent) return;

        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // Parse the raw content
        const html = parseFountainToHTML(msg.rawContent);
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Get current cursor position
        const block = getCurrentBlock();
        if (block) {
            // Insert after current block
            block.after(...temp.children);
        } else {
            // Append to editor if no cursor position
            editor.innerHTML += html;
            normalizeEditor();   // every way in leaves the editor sound
        }

        editorDirty = true;
        triggerAutoSave();
        triggerSceneNavUpdate();
        updateSceneNumbers();
        setStatus('AI content inserted at cursor');
    }

    // FILM-113: Append AI content to end of script
    function appendAIContent(messageIndex) {
        const msg = state.aiChat[messageIndex];
        if (!msg || !msg.rawContent) return;

        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // Parse and append to end
        const html = parseFountainToHTML(msg.rawContent);
        editor.innerHTML += html;
        normalizeEditor();   // every way in leaves the editor sound

        editorDirty = true;
        triggerAutoSave();
        triggerSceneNavUpdate();
        updateSceneNumbers();
        setStatus('AI content appended to script');

        // Scroll to bottom
        editor.scrollTop = editor.scrollHeight;
    }

    // FILM-113: Replace current scene with AI content
    function replaceCurrentScene(messageIndex) {
        const msg = state.aiChat[messageIndex];
        if (!msg || !msg.rawContent) return;

        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        const block = getCurrentBlock();
        if (!block) {
            setStatus('No current position - use Append instead');
            return;
        }

        // Find the current scene boundaries
        let sceneStart = block;
        let sceneEnd = block;

        // Walk back to find scene heading
        let prev = block.previousElementSibling;
        while (prev) {
            if (prev.dataset?.elementType === 'scene-heading') {
                sceneStart = prev;
                break;
            }
            sceneStart = prev;
            prev = prev.previousElementSibling;
        }

        // Walk forward to find next scene heading or end
        let next = block.nextElementSibling;
        while (next) {
            if (next.dataset?.elementType === 'scene-heading') {
                break;
            }
            sceneEnd = next;
            next = next.nextElementSibling;
        }

        // Collect all blocks in current scene to remove
        const blocksToRemove = [];
        let current = sceneStart;
        while (current && current !== next) {
            blocksToRemove.push(current);
            current = current.nextElementSibling;
        }

        // Parse new content
        const html = parseFountainToHTML(msg.rawContent);
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Insert new content before first block to remove
        const insertBefore = blocksToRemove[0];
        if (insertBefore) {
            for (const newBlock of temp.children) {
                insertBefore.before(newBlock.cloneNode(true));
            }
        }

        // Remove old scene blocks
        blocksToRemove.forEach(b => b.remove());

        editorDirty = true;
        triggerAutoSave();
        triggerSceneNavUpdate();
        updateSceneNumbers();
        setStatus('Scene replaced with AI content');
    }

    async function saveScreenplay() {
        if (!state.currentProject) return;
        const editor = document.getElementById('screenplayEditor');

        // Convert editor content back to Fountain
        const fountainText = serializeEditorToFountain(editor);
        if (!fountainText.trim()) {
            setStatus('Nothing to save');
            return;
        }

        updateSaveStatus('saving');
        setStatus('Saving...');
        try {
            // FILM-129: Check if this should be marked as a revision
            const markAsRevision = getMarkAsRevision();
            const requestBody = { fountain_content: fountainText };
            if (markAsRevision) {
                requestBody.mark_as_revision = true;
            }

            const data = await api('/projects/' + state.currentProject.id + '/script', {
                method: 'POST', body: JSON.stringify(requestBody)
            });

            // FILM-129: Update revision info
            loadRevisionInfo(data.script);

            // Reset the mark as revision checkbox after saving
            const checkbox = document.getElementById('markAsRevisionCheckbox');
            if (checkbox) checkbox.checked = false;

            setStatus(`Saved as v${data.script.version}${markAsRevision ? ' (Revision)' : ''}`);
            editorDirty = false;
            currentFountainContent = fountainText;
            currentScriptVersion = data.script.version; // FILM-104: Track version for auto-save
            updateSaveStatus('saved');
            loadScriptVersions();
            // FILM-121: Check for new entity suggestions
            checkScreenplaySuggestions();
        } catch (err) {
            setStatus('Error: ' + err.message);
            updateSaveStatus('unsaved');
        }
    }

    // FILM-104: Serialize editor content to Fountain format with inline formatting
    function editorToFountain(editor) {
        return serializeEditorToFountain(editor);
    }

    function serializeEditorToFountain(editor) {
        // Convert editor HTML back to Fountain text
        // Handles data-element-type and inline formatting (bold, italic, underline)

        const lines = [];
        let prevType = null;

        // FILM-128: Handle title page block at the start
        const titlePageBlock = editor.querySelector('[data-element-type="title-page"]');
        if (titlePageBlock && titlePageBlock.dataset.titlePageData) {
            try {
                const titlePage = JSON.parse(titlePageBlock.dataset.titlePageData);
                const titlePageFountain = serializeTitlePageToFountain(titlePage);
                if (titlePageFountain) {
                    lines.push(titlePageFountain.trim());
                }
            } catch (e) {
                console.error('Failed to serialize title page:', e);
            }
        }

        // FILM-109: Helper to serialize a single element
        function serializeElement(el, isRightDualChar = false) {
            const text = extractFormattedText(el).trim();
            let elementType = el.dataset && el.dataset.elementType;
            if (!elementType) {
                const classes = [...el.classList];
                const spClass = classes.find(c => c.startsWith('sp-'));
                elementType = spClass ? spClass.replace('sp-', '') : 'action';
            }

            if (!text) return;

            switch (elementType) {
                case 'scene-heading': {
                    // The heading is styled bold by CSS; any bold run inside it
                    // would come back as ** and be shown literally next reload.
                    const headingText = stripEmphasisMarkers(text);
                    const hasPrefix = /^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i.test(headingText);
                    let headingLine = hasPrefix ? headingText.toUpperCase() : '.' + headingText.toUpperCase();
                    const sceneNumber = el.dataset && el.dataset.sceneNumber;
                    if (sceneNumber) {
                        headingLine += ' #' + sceneNumber + '#';
                    }
                    lines.push('', headingLine);
                    break;
                }
                case 'character':
                    // FILM-109: Add ^ suffix for right-side dual dialogue character
                    if (isRightDualChar || el.dataset.dualRight) {
                        lines.push('', text.toUpperCase() + ' ^');
                    } else {
                        lines.push('', text.toUpperCase());
                    }
                    break;
                case 'dialogue':
                    lines.push(text);
                    break;
                case 'parenthetical':
                    if (!text.startsWith('(')) {
                        lines.push('(' + text + ')');
                    } else {
                        lines.push(text);
                    }
                    break;
                case 'transition':
                    if (text.endsWith(':')) {
                        lines.push('', text.toUpperCase());
                    } else {
                        lines.push('', '> ' + text.toUpperCase());
                    }
                    break;
                case 'centered':
                    lines.push('', '> ' + text + ' <');
                    break;
                case 'lyrics':
                    lines.push('~' + text);
                    break;
                case 'note':
                    lines.push('[[' + text + ']]');
                    break;
                case 'dual-dialogue':
                    lines.push('', text.toUpperCase() + ' ^');
                    break;
                case 'action':
                default:
                    if (prevType !== 'action' && prevType !== null) {
                        lines.push('');
                    }
                    lines.push(text);
                    break;
            }
            prevType = elementType;
        }

        // Walk through direct children of editor
        for (const child of editor.children) {
            // FILM-109: Handle dual dialogue containers
            if (child.classList.contains('dual-dialogue-container')) {
                const leftCol = child.querySelector('.dual-dialogue-column.left');
                const rightCol = child.querySelector('.dual-dialogue-column.right');

                // Serialize left column first
                if (leftCol) {
                    const leftEls = leftCol.querySelectorAll('[data-element-type]');
                    leftEls.forEach(el => serializeElement(el, false));
                }

                // Serialize right column (first character gets ^ suffix)
                if (rightCol) {
                    const rightEls = Array.from(rightCol.querySelectorAll('[data-element-type]'));
                    rightEls.forEach((el, i) => {
                        const isFirstChar = i === 0 && el.dataset.elementType === 'character';
                        serializeElement(el, isFirstChar);
                    });
                }
                continue;
            }

            // Skip page break indicators and other non-element children
            if (child.classList.contains('page-break-indicator')) continue;

            // FILM-128: Skip title page block (already serialized at the start)
            if (child.dataset && child.dataset.elementType === 'title-page') continue;

            // Regular elements
            if (child.dataset && child.dataset.elementType) {
                serializeElement(child, false);
            }
        }

        return lines.join('\n').trim();
    }

    // Extract text from element, converting HTML formatting to Fountain markers
    function extractFormattedText(element) {
        let result = '';

        function processNode(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                result += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip UI chrome the editor injects into blocks. These are
                // decorations, not screenplay text — the scene status icon was
                // being serialized into headings, leaving a stray glyph glued
                // to the slugline on every save.
                if (node.classList && (
                    node.classList.contains('scene-number-gutter') ||
                    node.classList.contains('scene-status-icon') ||
                    node.classList.contains('auto-detect-hint')
                )) {
                    return;
                }
                const tag = node.tagName.toLowerCase();
                const isBold = tag === 'b' || tag === 'strong' || node.style.fontWeight === 'bold';
                const isItalic = tag === 'i' || tag === 'em' || node.style.fontStyle === 'italic';
                const isUnderline = tag === 'u' || node.style.textDecoration?.includes('underline');

                // Determine markers
                let openMarker = '';
                let closeMarker = '';

                if (isBold && isItalic) {
                    openMarker = '***';
                    closeMarker = '***';
                } else if (isBold) {
                    openMarker = '**';
                    closeMarker = '**';
                } else if (isItalic) {
                    openMarker = '*';
                    closeMarker = '*';
                } else if (isUnderline) {
                    openMarker = '_';
                    closeMarker = '_';
                }

                result += openMarker;
                for (const child of node.childNodes) {
                    processNode(child);
                }
                result += closeMarker;
            }
        }

        for (const child of element.childNodes) {
            processNode(child);
        }

        return result;
    }

    // FILM-102: Keyboard shortcut help overlay
    function toggleShortcutHelp() {
        let overlay = document.getElementById('shortcutHelpOverlay');

        if (!overlay) {
            // Create overlay
            overlay = document.createElement('div');
            overlay.id = 'shortcutHelpOverlay';
            overlay.className = 'shortcut-help-overlay';
            overlay.innerHTML = `
                <div class="shortcut-help-content">
                    <div class="shortcut-help-header">
                        <h3>Keyboard Shortcuts</h3>
                        <button class="shortcut-help-close" onclick="toggleShortcutHelp()">&times;</button>
                    </div>
                    <div class="shortcut-help-sections">
                        <div class="shortcut-section">
                            <h4>Element Types</h4>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>1</kbd> Scene Heading</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>2</kbd> Action</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>3</kbd> Character</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>4</kbd> Dialogue</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>5</kbd> Parenthetical</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>6</kbd> Transition</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>7</kbd> Dual Dialogue</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>8</kbd> Centered</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>9</kbd> Note</div>
                        </div>
                        <div class="shortcut-section">
                            <h4>Formatting</h4>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>B</kbd> Bold</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>I</kbd> Italic</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>U</kbd> Underline</div>
                        </div>
                        <div class="shortcut-section">
                            <h4>Navigation</h4>
                            <div class="shortcut-item"><kbd>Tab</kbd> Cycle element type</div>
                            <div class="shortcut-item"><kbd>Enter</kbd> New line/element</div>
                            <div class="shortcut-item"><kbd>Shift</kbd> + <kbd>Enter</kbd> Soft break</div>
                        </div>
                        <div class="shortcut-section">
                            <h4>Actions</h4>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>S</kbd> Save</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>Z</kbd> Undo</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> Redo</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>Shift</kbd> + <kbd>O</kbd> Scene Navigator</div>
                            <div class="shortcut-item"><kbd>Ctrl/Cmd</kbd> + <kbd>/</kbd> This help</div>
                            <div class="shortcut-item"><kbd>Esc</kbd> Close/Cancel</div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
        }

        shortcutHelpVisible = !shortcutHelpVisible;
        overlay.classList.toggle('visible', shortcutHelpVisible);

        if (shortcutHelpVisible) {
            // Close on overlay background click
            overlay.onclick = (e) => {
                if (e.target === overlay) toggleShortcutHelp();
            };
        }
    }

    function formatBold() {
        document.execCommand('bold');
    }

    function formatItalic() {
        document.execCommand('italic');
    }

    function formatUnderline() {
        document.execCommand('underline');
    }

    function setElementType(type) {
        // Normalize type (dropdown uses underscores, data attributes use hyphens)
        const normalizedType = type.replace('_', '-');

        // Get current block
        const block = getCurrentBlock();
        if (block) {
            setBlockElementType(block, normalizedType);
        } else {
            // If no block exists, create one
            const editor = document.getElementById('screenplayEditor');
            const newBlock = createBlock('', normalizedType);
            editor.appendChild(newBlock);
            normalizeEditor();   // every way in leaves the editor sound
            setCursorToBlock(newBlock);
        }
    }

    function toggleImportSection() {
        const content = document.getElementById('importContent');
        const icon = document.getElementById('importToggleIcon');
        content.classList.toggle('open');
        icon.textContent = content.classList.contains('open') ? '▼' : '▶';
    }

    // FILM-116: Script Stats Functions
    function toggleScriptStats() {
        const content = document.getElementById('scriptStatsContent');
        const icon = document.getElementById('statsToggleIcon');
        content.classList.toggle('open');
        icon.textContent = content.classList.contains('open') ? '▼' : '▶';
        if (content.classList.contains('open')) {
            updateScriptStats();
        }
    }

    // FILM-126: Switch between stats dashboard tabs
    function switchStatsTab(tabName) {
        document.querySelectorAll('.stats-tab').forEach(tab => {
            tab.classList.toggle('active', tab.textContent.toLowerCase() === tabName);
        });
        document.querySelectorAll('.stats-tab-content').forEach(content => {
            const contentId = content.id.replace('statsTab', '').toLowerCase();
            content.classList.toggle('active', contentId === tabName);
        });
    }

    function updateScriptStats() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        // Get Fountain text and parse it
        const fountainText = editorToFountain(editor);
        if (!fountainText.trim()) {
            document.getElementById('scriptStatsSummary').textContent = 'No content';
            return;
        }

        // Use the FountainParser's analyzeScreenplay function
        // Since the parser is isomorphic, we can use it in browser if loaded
        let parsed, stats;
        if (typeof FountainParser !== 'undefined') {
            parsed = FountainParser.parseFountain(fountainText);
            stats = FountainParser.analyzeScreenplay(parsed);
        } else {
            // Fallback: basic local analysis
            stats = analyzeScreenplayLocal(fountainText);
        }

        // FILM-126: Compute additional stats
        const lineCount = fountainText.split('\n').length;
        const pageCount = Math.ceil(lineCount / 55); // ~55 lines per page
        const runtimeMinutes = pageCount; // ~1 min per page
        const actionPct = stats.total_words > 0 ? Math.round((stats.action_words / stats.total_words) * 100) : 0;

        // Update summary in toggle bar
        document.getElementById('scriptStatsSummary').textContent =
            `${stats.total_words.toLocaleString()} words · ${stats.scene_count} scenes`;

        // Overview tab
        document.getElementById('statTotalWords').textContent = stats.total_words.toLocaleString();
        document.getElementById('statSceneCount').textContent = stats.scene_count;
        document.getElementById('statDialoguePct').textContent = stats.dialogue_percentage + '%';
        document.getElementById('statAvgSceneLen').textContent = stats.avg_scene_length + ' ln';

        // FILM-126: New overview stats
        const pageCountEl = document.getElementById('statPageCount');
        if (pageCountEl) pageCountEl.textContent = pageCount;

        const actionPctEl = document.getElementById('statActionPct');
        if (actionPctEl) actionPctEl.textContent = actionPct + '%';

        const runtimeEl = document.getElementById('statRuntime');
        if (runtimeEl) {
            const hours = Math.floor(runtimeMinutes / 60);
            const mins = runtimeMinutes % 60;
            runtimeEl.textContent = `Est. Runtime: ${hours > 0 ? hours + 'h ' : ''}${mins}min`;
        }

        // Dialogue tab - donut chart
        const donutCircle = document.getElementById('donutDialogue');
        const donutLabel = document.getElementById('donutPctLabel');
        if (donutCircle && donutLabel) {
            const circumference = 2 * Math.PI * 40; // radius = 40
            const dashLen = (stats.dialogue_percentage / 100) * circumference;
            donutCircle.setAttribute('stroke-dasharray', `${dashLen} ${circumference}`);
            donutLabel.textContent = stats.dialogue_percentage + '%';
        }

        // Update dialogue/action word counts (in both tabs)
        document.querySelectorAll('#statDialogueWords').forEach(el => {
            el.textContent = stats.dialogue_words.toLocaleString();
        });
        document.querySelectorAll('#statActionWords').forEach(el => {
            el.textContent = stats.action_words.toLocaleString();
        });

        // Scenes tab
        document.getElementById('statLongestScene').textContent = stats.longest_scene
            ? `Scene #${stats.longest_scene.scene_number} (${stats.longest_scene.length} lines)`
            : '—';
        document.getElementById('statShortestScene').textContent = stats.shortest_scene
            ? `Scene #${stats.shortest_scene.scene_number} (${stats.shortest_scene.length} lines)`
            : '—';

        // FILM-126: INT/EXT ratio bar
        const intExtBar = document.getElementById('intExtBar');
        if (intExtBar && stats.scenes_by_int_ext) {
            const total = Object.values(stats.scenes_by_int_ext).reduce((a, b) => a + b, 0);
            intExtBar.innerHTML = Object.entries(stats.scenes_by_int_ext)
                .map(([k, v]) => {
                    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                    return `<div class="stats-ratio-bar-segment" style="width:${pct}%">${k} (${v})</div>`;
                }).join('');
        }

        // FILM-126: Time of day ratio bar
        const timeOfDayBar = document.getElementById('timeOfDayBar');
        if (timeOfDayBar && stats.scenes_by_time) {
            const total = Object.values(stats.scenes_by_time).reduce((a, b) => a + b, 0);
            timeOfDayBar.innerHTML = Object.entries(stats.scenes_by_time)
                .map(([k, v]) => {
                    const pct = total > 0 ? Math.round((v / total) * 100) : 0;
                    return `<div class="stats-ratio-bar-segment" style="width:${pct}%">${k} (${v})</div>`;
                }).join('');
        }

        // FILM-126: Scene length bars
        const sceneLengthBars = document.getElementById('sceneLengthBars');
        if (sceneLengthBars && stats.scene_lengths) {
            const maxLen = Math.max(...stats.scene_lengths.map(s => s.length), 1);
            const LINES_PER_PAGE = 55;
            const shortThreshold = LINES_PER_PAGE * 0.5; // < 0.5 pages
            const longThreshold = LINES_PER_PAGE * 5;     // > 5 pages

            sceneLengthBars.innerHTML = stats.scene_lengths.slice(0, 20).map(s => {
                const pages = (s.length / LINES_PER_PAGE).toFixed(1);
                const pct = Math.round((s.length / maxLen) * 100);
                const isShort = s.length < shortThreshold;
                const isLong = s.length > longThreshold;
                const fillClass = isShort ? 'short' : isLong ? 'long' : '';

                return `
                    <div class="stats-scene-bar">
                        <span class="stats-scene-bar-label">Sc ${s.scene_number}</span>
                        <div class="stats-scene-bar-track">
                            <div class="stats-scene-bar-fill ${fillClass}" style="width:${pct}%"></div>
                        </div>
                        <span class="stats-scene-bar-value">${pages}pg</span>
                    </div>
                `;
            }).join('');

            if (stats.scene_lengths.length > 20) {
                sceneLengthBars.innerHTML += '<div style="font-size:10px;color:var(--gl-text-muted);text-align:center;margin-top:8px;">Showing first 20 scenes</div>';
            }
        }

        // Characters tab
        const charBreakdown = document.getElementById('statsCharacterBreakdown');
        const charEntries = Object.entries(stats.character_dialogue || {})
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);

        if (charEntries.length > 0) {
            const maxWords = charEntries[0][1];
            const totalDialogue = stats.dialogue_words || 1;

            charBreakdown.innerHTML = `
                <h5 style="margin-bottom:8px;">Dialogue by Character</h5>
                ${charEntries.map(([name, words]) => {
                    const pct = Math.round((words / totalDialogue) * 100);
                    return `
                    <div class="character-stat-bar">
                        <span class="character-stat-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                        <div class="character-stat-fill">
                            <div class="character-stat-fill-inner" style="width: ${Math.round(words / maxWords * 100)}%"></div>
                        </div>
                        <span class="character-stat-count">${words} (${pct}%)</span>
                    </div>
                `;}).join('')}
            `;
        } else {
            charBreakdown.innerHTML = '<p class="text-sm text-muted">No character dialogue detected.</p>';
        }
    }

    // Fallback local analysis if FountainParser not available
    function analyzeScreenplayLocal(text) {
        const lines = text.split('\n');
        let totalWords = 0;
        let dialogueWords = 0;
        let actionWords = 0;
        let sceneCount = 0;
        const sceneLengths = [];
        let currentSceneLength = 0;
        let inDialogue = false;
        const characterDialogue = {};
        let currentCharacter = null;
        const scenesByIntExt = {};
        const scenesByTime = {};

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;

            const words = trimmed.split(/\s+/).length;
            totalWords += words;

            // Scene heading detection
            if (/^(INT|EXT|EST|INT\.?\/?EXT|I\/E)[\.\s]/i.test(trimmed) || AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(trimmed)) {
                if (currentSceneLength > 0) {
                    sceneLengths.push({ scene_number: String(sceneCount), length: currentSceneLength });
                }
                sceneCount++;
                currentSceneLength = 1;
                inDialogue = false;

                // Track INT/EXT
                const intExtMatch = trimmed.match(/^(INT|EXT|EST|INT\.?\/?EXT|I\/E)/i);
                if (intExtMatch) {
                    const key = intExtMatch[1].toUpperCase();
                    scenesByIntExt[key] = (scenesByIntExt[key] || 0) + 1;
                }

                // Track time of day
                const timeMatch = trimmed.match(/[-–—]\s*(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|CONTINUOUS|LATER)/i);
                if (timeMatch) {
                    const key = timeMatch[1].toUpperCase();
                    scenesByTime[key] = (scenesByTime[key] || 0) + 1;
                }
            }
            // Character detection (all caps, not too long)
            else if (/^[A-Z][A-Z0-9\s\-'\.]+(\s*\([^)]+\))?$/.test(trimmed) && trimmed.length < 40) {
                currentCharacter = trimmed.replace(/\s*\([^)]+\)\s*$/, '');
                if (!characterDialogue[currentCharacter]) {
                    characterDialogue[currentCharacter] = 0;
                }
                inDialogue = true;
                currentSceneLength++;
            }
            // Dialogue (after character)
            else if (inDialogue && !trimmed.startsWith('(')) {
                dialogueWords += words;
                if (currentCharacter) {
                    characterDialogue[currentCharacter] += words;
                }
                currentSceneLength++;
            }
            // Action
            else {
                actionWords += words;
                inDialogue = false;
                currentSceneLength++;
            }
        }

        // Save final scene
        if (currentSceneLength > 0) {
            sceneLengths.push({ scene_number: String(sceneCount), length: currentSceneLength });
        }

        const avgSceneLength = sceneLengths.length > 0
            ? Math.round(sceneLengths.reduce((sum, s) => sum + s.length, 0) / sceneLengths.length * 10) / 10
            : 0;

        const sortedScenes = [...sceneLengths].sort((a, b) => b.length - a.length);

        return {
            total_words: totalWords,
            dialogue_words: dialogueWords,
            action_words: actionWords,
            dialogue_percentage: totalWords > 0 ? Math.round(dialogueWords / totalWords * 100) : 0,
            scene_count: sceneCount,
            scenes_by_int_ext: scenesByIntExt,
            scenes_by_time: scenesByTime,
            avg_scene_length: avgSceneLength,
            longest_scene: sortedScenes[0] || null,
            shortest_scene: sortedScenes[sortedScenes.length - 1] || null,
            character_dialogue: characterDialogue,
            scene_lengths: sceneLengths // FILM-126: Include for scene length bars
        };
    }

    // FILM-116: AI Script Analysis
    async function runAIScriptAnalysis() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;

        const fountainText = editorToFountain(editor);
        if (!fountainText.trim()) {
            alert('No screenplay content to analyze');
            return;
        }

        // Add user message indicating analysis request
        if (!state.aiChat) state.aiChat = [];
        state.aiChat.push({ role: 'user', content: '[Requesting full script analysis...]' });
        renderAIChatMessages();

        // Open AI chat if not open
        const panel = document.getElementById('aiChatPanel');
        if (!panel.classList.contains('visible')) {
            toggleAIChat();
        }

        // Show typing dots
        showTypingIndicator();

        const analysisMessage = `Please analyze this screenplay and provide a comprehensive assessment including:

1. **Pacing Assessment** - Is the story moving at an appropriate pace? Are there slow sections or rushed moments?
2. **Dialogue-to-Action Ratio** - Is there a good balance between dialogue and visual storytelling?
3. **Character Voice Distinctiveness** - Do characters have unique voices? Can you tell them apart by their dialogue?
4. **Scene Length Distribution** - Are scene lengths varied appropriately? Any scenes that feel too long or too short?
5. **Potential Plot Holes** - Any logical inconsistencies or loose threads?
6. **Formatting Suggestions** - Any screenplay formatting improvements?

Here is the full screenplay:

${fountainText.slice(0, 50000)}`;

        try {
            if (!state.currentProject) {
                throw new Error('No project selected');
            }

            // Stream analysis response
            const container = document.getElementById('aiChatMessages');
            let accumulated = '';
            let liveBubble = null;

            await streamPostSSE(
                API() + `/projects/${state.currentProject.id}/screenplay-ai/stream`,
                {
                    mode: 'brainstorm',
                    message: analysisMessage,
                    conversation_history: []
                },
                {
                    onChunk: (text) => {
                        if (!liveBubble) {
                            removeTypingIndicator();
                            liveBubble = document.createElement('div');
                            liveBubble.className = 'ai-chat-message assistant streaming';
                            container.appendChild(liveBubble);
                        }
                        accumulated += text;
                        liveBubble.textContent = accumulated;
                        container.scrollTop = container.scrollHeight;
                    },
                    onDone: () => { removeTypingIndicator(); },
                    onError: (msg) => {
                        removeTypingIndicator();
                        if (!accumulated) accumulated = `Analysis failed: ${msg}`;
                    }
                }
            );

            if (liveBubble) liveBubble.remove();

            state.aiChat.push({
                role: 'assistant',
                content: accumulated || '(No response received)',
                rawContent: accumulated || '',
                isAnalysis: true
            });

            saveAIChatHistory();
            renderAIChatMessages();

        } catch (error) {
            removeTypingIndicator();
            state.aiChat.push({
                role: 'assistant',
                content: `Analysis failed: ${error.message}. The AI endpoint may not be configured.`
            });
            renderAIChatMessages();
        }
    }

    function importToEditor() {
        const text = document.getElementById('scriptInput').value.trim();
        if (!text) return;
        currentFountainContent = text;
        renderFountainToEditor(text);
        toggleImportSection();
        setStatus('Loaded into editor');
    }

    function loadScreenplayPage() {
        loadScriptVersions();
        loadLatestFountain();
        // FILM-121: Check for entity suggestions
        checkScreenplaySuggestions();
        // FILM-124: Update scene status icons after a small delay to ensure editor is rendered
        setTimeout(updateSceneStatusIcons, 500);
        /*
         * The gutter is painted AFTER the editor has content and a layout.
         *
         * Its markers are positioned from each scene heading's own offsetTop,
         * so painting before the Fountain has rendered puts every marker at 0 —
         * which looks like the gutter is broken rather than early. The shot
         * codes come from the shot list, which the same delay covers.
         */
        SCRIPT_TIMING = null;
        setTimeout(async () => {
            // The shot codes are a bonus, not a prerequisite: a screenplay with
            // no breakdown yet still has eighths and a screen time, and failing
            // the whole gutter for want of a shot list would hide them.
            try {
                const data = await api(`/projects/${state.currentProject.id}/shotlist`);
                state.shots = data.shots || [];
            } catch (_) { /* no breakdown yet */ }
            renderScriptGutter();
        }, 600);
    }

    // FILM-124: Re-render screenplay editor (called after breakdowns)
    function renderScreenplayEditor() {
        // Just update status icons - don't reload entire editor
        updateSceneStatusIcons();
    }

    // ══════════════════════════════════════════════════════════════
    // FILM-118: TEXT-TO-SCREENPLAY CONVERSION
    // ══════════════════════════════════════════════════════════════
    let detectedChapters = [];

    let conversionResults = [];

    let conversionCancelled = false;

    let currentAbortController = null;

    const CONTEXT_OVERLAP = 500;

    function openTextConvertModal() {
        showModal('textConvertModal');
        resetConvertModal();
    }

    function closeTextConvertModal() {
        closeModal('textConvertModal');
    }

    // ══════════════════════════════════════════════════════════════
    // FILM-121: SCREENPLAY SUGGESTIONS
    // ══════════════════════════════════════════════════════════════
    let screenplaySuggestions = { unmatched_characters: [], unmatched_locations: [] };

    async function checkScreenplaySuggestions() {
        if (!state.currentProject) return;

        try {
            const data = await api(`/projects/${state.currentProject.id}/screenplay/suggestions`);
            screenplaySuggestions = data;

            const totalCount = (data.unmatched_characters?.length || 0) + (data.unmatched_locations?.length || 0);
            const btn = document.getElementById('suggestionsBtn');
            const badge = document.getElementById('suggestionsBadge');

            if (totalCount > 0) {
                btn.style.display = '';
                badge.textContent = totalCount;
            } else {
                btn.style.display = 'none';
            }
        } catch (e) {
            // Silently ignore if endpoint doesn't exist yet
        }
    }

    function openSuggestionsPanel() {
        showModal('suggestionsModal');
        renderSuggestions();
    }

    function closeSuggestionsPanel() {
        closeModal('suggestionsModal');
    }

    function renderSuggestions() {
        const chars = screenplaySuggestions.unmatched_characters || [];
        const locs = screenplaySuggestions.unmatched_locations || [];

        // Characters
        document.getElementById('charSuggestionCount').textContent = `(${chars.length})`;
        const charList = document.getElementById('characterSuggestionsList');
        if (chars.length === 0) {
            charList.innerHTML = '<div class="suggestion-item"><span class="text-muted">No new characters detected</span></div>';
        } else {
            charList.innerHTML = chars.map((c, i) => `
                <div class="suggestion-item" id="charSugg_${i}">
                    <div class="suggestion-item-info">
                        <div class="suggestion-item-name">${escapeHtml(c.name)}</div>
                        <div class="suggestion-item-meta">${c.mention_count} mention${c.mention_count !== 1 ? 's' : ''} · First in scene ${c.first_scene}</div>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="createSuggestedCharacter(${i})">Create</button>
                </div>
            `).join('');
        }

        // Locations
        document.getElementById('locSuggestionCount').textContent = `(${locs.length})`;
        const locList = document.getElementById('locationSuggestionsList');
        if (locs.length === 0) {
            locList.innerHTML = '<div class="suggestion-item"><span class="text-muted">No new locations detected</span></div>';
        } else {
            locList.innerHTML = locs.map((l, i) => `
                <div class="suggestion-item" id="locSugg_${i}">
                    <div class="suggestion-item-info">
                        <div class="suggestion-item-name">${escapeHtml(l.name)}</div>
                        <div class="suggestion-item-meta">${l.int_ext || ''} ${l.mention_count} mention${l.mention_count !== 1 ? 's' : ''}</div>
                    </div>
                    <button class="btn btn-sm btn-outline" onclick="createSuggestedLocation(${i})">Create</button>
                </div>
            `).join('');
        }
    }

    async function createSuggestedCharacter(index) {
        const char = screenplaySuggestions.unmatched_characters[index];
        if (!char || !state.currentProject) return;

        try {
            await api(`/projects/${state.currentProject.id}/characters`, {
                method: 'POST',
                body: JSON.stringify({
                    name: char.name,
                    role: '',
                    personality_notes: `Detected from screenplay (${char.mention_count} mentions)`
                })
            });

            // Mark as created
            const el = document.getElementById(`charSugg_${index}`);
            if (el) {
                el.classList.add('created');
                el.querySelector('button').disabled = true;
                el.querySelector('button').textContent = 'Created';
            }

            // Refresh characters list
            await loadCharacters();
            checkScreenplaySuggestions();
        } catch (e) {
            alert('Failed to create character: ' + e.message);
        }
    }

    async function createSuggestedLocation(index) {
        const loc = screenplaySuggestions.unmatched_locations[index];
        if (!loc || !state.currentProject) return;

        try {
            await api(`/projects/${state.currentProject.id}/locations`, {
                method: 'POST',
                body: JSON.stringify({
                    name: loc.name,
                    description: `${loc.int_ext || ''} location (${loc.mention_count} mentions in screenplay)`
                })
            });

            // Mark as created
            const el = document.getElementById(`locSugg_${index}`);
            if (el) {
                el.classList.add('created');
                el.querySelector('button').disabled = true;
                el.querySelector('button').textContent = 'Created';
            }

            // Refresh locations list
            await loadLocations();
            checkScreenplaySuggestions();
        } catch (e) {
            alert('Failed to create location: ' + e.message);
        }
    }

    async function createAllCharacters() {
        const chars = screenplaySuggestions.unmatched_characters || [];
        for (let i = 0; i < chars.length; i++) {
            await createSuggestedCharacter(i);
        }
    }

    async function createAllLocations() {
        const locs = screenplaySuggestions.unmatched_locations || [];
        for (let i = 0; i < locs.length; i++) {
            await createSuggestedLocation(i);
        }
    }

    function resetConvertModal() {
        document.getElementById('convertStep1').style.display = 'block';
        document.getElementById('convertStep2').style.display = 'none';
        document.getElementById('convertStep3').style.display = 'none';
        document.getElementById('convertSourceText').value = '';
        document.getElementById('convertStyleNotes').value = '';
        document.getElementById('chaptersDetectedGroup').style.display = 'none';
        document.getElementById('chaptersList').innerHTML = '';
        detectedChapters = [];
        conversionResults = [];
    }

    async function handleConvertFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        // .docx is a zip, so it cannot be read as text in the browser. Send it
        // to the server, which extracts the prose and hands back plain text.
        // Extraction is local and free; conversion is a paid LLM call, so the
        // text lands in the editor first for review rather than going straight
        // through.
        if (/\.docx$/i.test(file.name)) {
            setStatus('Extracting text from ' + file.name + '…');
            try {
                const buf = await file.arrayBuffer();
                const bytes = new Uint8Array(buf);
                // Chunked so a large manuscript does not blow the argument
                // limit on String.fromCharCode.
                let binary = '';
                const CHUNK = 0x8000;
                for (let i = 0; i < bytes.length; i += CHUNK) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
                }
                checkUploadSize(file, '/projects/' + state.currentProject.id + '/text-to-screenplay/extract');
                const res = await api('/projects/' + state.currentProject.id + '/text-to-screenplay/extract', {
                    method: 'POST',
                    body: JSON.stringify({ filename: file.name, data_base64: btoa(binary) }),
                });
                document.getElementById('convertSourceText').value = res.text;
                const parts = Array.isArray(res.files_read) && res.files_read.length ? ' from ' + res.files_read.length + ' Word part(s)' : '';
                setStatus('Extracted ' + res.characters.toLocaleString() + ' characters' + parts + ' from ' + file.name);
                detectChapters();
                updateConversionEstimate();
            } catch (err) {
                setStatus('Could not read that document: ' + err.message);
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('convertSourceText').value = e.target.result;
            detectChapters();
            updateConversionEstimate();
        };
        reader.readAsText(file);
    }

    function detectChapters() {
        const text = document.getElementById('convertSourceText').value;
        if (!text.trim()) {
            alert('Please enter or upload text first');
            return;
        }

        detectedChapters = [];
        const lines = text.split('\n');

        // Patterns for chapter detection
        const chapterPatterns = [
            /^(chapter|part)\s+\d+/i,
            /^(chapter|part)\s+[a-z]+/i,
            /^(chapter|part):/i,
            /^#{1,3}\s+/,
            /^---+$/
        ];

        let currentChapter = null;
        let currentContent = [];
        let chapterIndex = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isChapterBreak = chapterPatterns.some(p => p.test(line.trim()));
            const isDoubleBlank = i > 0 && lines[i].trim() === '' && lines[i - 1].trim() === '';

            if (isChapterBreak || isDoubleBlank) {
                // Save previous chapter if exists
                if (currentContent.length > 0) {
                    detectedChapters.push({
                        index: chapterIndex++,
                        title: currentChapter || `Section ${chapterIndex}`,
                        content: currentContent.join('\n').trim(),
                        selected: true
                    });
                }
                currentContent = [];
                currentChapter = isChapterBreak ? line.trim() : null;
            } else {
                if (line.trim()) {
                    currentContent.push(line);
                }
            }
        }

        // Save last chapter
        if (currentContent.length > 0) {
            detectedChapters.push({
                index: chapterIndex,
                title: currentChapter || `Section ${chapterIndex + 1}`,
                content: currentContent.join('\n').trim(),
                selected: true
            });
        }

        // If no chapters detected, treat entire text as one
        if (detectedChapters.length === 0) {
            detectedChapters.push({
                index: 0,
                title: 'Full Text',
                content: text.trim(),
                selected: true
            });
        }

        renderChaptersList();
    }

    function renderChaptersList() {
        const container = document.getElementById('chaptersList');
        const group = document.getElementById('chaptersDetectedGroup');

        if (detectedChapters.length > 0) {
            group.style.display = 'block';
            container.innerHTML = detectedChapters.map((ch, i) => `
                <div class="chapter-item">
                    <input type="checkbox" id="chapter_${i}" ${ch.selected ? 'checked' : ''} onchange="toggleChapter(${i})">
                    <div class="chapter-item-content">
                        <div class="chapter-item-title">${escapeHtml(ch.title)}</div>
                        <div class="chapter-item-preview">${escapeHtml(ch.content.slice(0, 150))}${ch.content.length > 150 ? '...' : ''}</div>
                    </div>
                </div>
            `).join('');
        } else {
            group.style.display = 'none';
        }
    }

    function toggleChapter(index) {
        detectedChapters[index].selected = !detectedChapters[index].selected;
    }

    function selectAllChapters() {
        detectedChapters.forEach(ch => ch.selected = true);
        renderChaptersList();
    }

    function deselectAllChapters() {
        detectedChapters.forEach(ch => ch.selected = false);
        renderChaptersList();
    }

    // FILM-119: Chunk text at sentence boundaries
    function chunkText(text, maxSize = legacy.MAX_CHUNK_SIZE) {
        if (text.length <= maxSize) {
            return [{ title: 'Full Text', content: text }];
        }

        const chunks = [];
        let remaining = text;
        let chunkNum = 1;

        while (remaining.length > 0) {
            if (remaining.length <= maxSize) {
                chunks.push({ title: `Chunk ${chunkNum}`, content: remaining });
                break;
            }

            // Find a good break point (sentence end) near maxSize
            let breakPoint = maxSize;
            const searchStart = Math.max(0, maxSize - 500);
            const searchText = remaining.slice(searchStart, maxSize + 200);

            // Look for sentence endings
            const sentenceEnd = searchText.lastIndexOf('. ');
            const questionEnd = searchText.lastIndexOf('? ');
            const exclamEnd = searchText.lastIndexOf('! ');
            const paragraphEnd = searchText.lastIndexOf('\n\n');

            const bestEnd = Math.max(sentenceEnd, questionEnd, exclamEnd, paragraphEnd);
            if (bestEnd > 0) {
                breakPoint = searchStart + bestEnd + 2;
            }

            chunks.push({
                title: `Chunk ${chunkNum}`,
                content: remaining.slice(0, breakPoint).trim()
            });

            remaining = remaining.slice(breakPoint).trim();
            chunkNum++;
        }

        return chunks;
    }

    function formatDuration(seconds) {
        const s = Math.max(0, Math.round(seconds || 0));
        if (s < 60) return s + 's';
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return rem ? `${m}m ${rem}s` : `${m}m`;
    }

    function setConversionProgress(done, total, label, startTime, detail) {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        document.getElementById('convertProgressLabel').textContent = label || 'Converting...';
        document.getElementById('convertProgressFill').style.width = `${pct}%`;
        document.getElementById('convertProgressStatus').textContent = `${done} / ${total} chunks (${pct}%)`;
        if (done > 0 && done < total) {
            const elapsed = (Date.now() - startTime) / 1000;
            const avg = elapsed / done;
            document.getElementById('convertProgressETA').textContent =
                `${formatDuration(elapsed)} elapsed · ${formatDuration(avg * (total - done))} remaining${detail ? ' · ' + detail : ''}`;
        } else {
            document.getElementById('convertProgressETA').textContent = detail || '';
        }
    }

    function buildConversionQueue(chapters) {
        const queue = [];
        chapters.forEach((chapter) => {
            const chunks = chunkText(chapter.content);
            chunks.forEach((chunk, index) => {
                const label = chunks.length > 1
                    ? `${chapter.title} (part ${index + 1}/${chunks.length})`
                    : chapter.title;
                queue.push({
                    title: label,
                    content: chunk.content,
                    sourceTitle: chapter.title,
                    sourceIndex: chapter.index,
                    part: index + 1,
                    parts: chunks.length
                });
            });
        });
        return queue;
    }

    async function readConversionResponse(response) {
        let data = {};
        try { data = await response.json(); } catch (_) {}
        if (!response.ok) {
            const msg = data.details || data.error || `HTTP ${response.status}`;
            throw new Error(msg);
        }
        return data;
    }

    async function runConversionQueue(queue, styleNotes) {
        document.getElementById('convertStep1').style.display = 'none';
        document.getElementById('convertStep2').style.display = 'block';

        conversionResults = [];
        conversionCancelled = false;
        const total = queue.length;
        const startTime = Date.now();
        let previousContext = '';
        let providerLabel = '';

        setConversionProgress(0, total, 'Preparing conversion...', startTime, `${total} chunk${total !== 1 ? 's' : ''} queued`);

        for (let i = 0; i < queue.length; i++) {
            if (conversionCancelled) {
                setConversionProgress(i, total, 'Cancelled', startTime, providerLabel);
                break;
            }

            const chunk = queue[i];
            const detail = `${chunk.content.length.toLocaleString()} chars${providerLabel ? ' · ' + providerLabel : ''}`;
            setConversionProgress(i, total, `Converting ${chunk.title}`, startTime, detail);

            try {
                let textToConvert = chunk.content;
                if (previousContext) {
                    textToConvert = `[CONTEXT FROM PREVIOUS SECTION - do not convert this again:]\n${previousContext}\n\n[NEW SECTION TO CONVERT:]\n${chunk.content}`;
                }

                currentAbortController = new AbortController();
                const response = await fetch(`${API()}/projects/${state.currentProject.id}/text-to-screenplay/preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        text: textToConvert,
                        chapter_title: chunk.title,
                        style_notes: styleNotes
                    }),
                    signal: currentAbortController.signal
                });
                const data = await readConversionResponse(response);
                providerLabel = data.provider ? `provider: ${data.provider}` : providerLabel;

                if (data.fountain_text) previousContext = data.fountain_text.slice(-CONTEXT_OVERLAP);

                conversionResults.push({
                    chapter: chunk,
                    success: true,
                    fountain_text: data.fountain_text,
                    scenes_detected: data.scenes_detected || [],
                    characters_detected: data.characters_detected || [],
                    validation: data.validation,
                    provider: data.provider || '',
                    provider_model: data.provider_model || '',
                    input_length: data.input_length || chunk.content.length,
                    output_length: data.output_length || (data.fountain_text || '').length
                });
            } catch (error) {
                if (error.name === 'AbortError') break;
                conversionResults.push({ chapter: chunk, success: false, error: error.message });
            } finally {
                currentAbortController = null;
            }

            setConversionProgress(i + 1, total, `Finished ${chunk.title}`, startTime, providerLabel);
        }

        if (!conversionCancelled) {
            const failed = conversionResults.filter(r => !r.success).length;
            setConversionProgress(total, total, failed ? 'Finished with errors' : 'Conversion complete', startTime, failed ? `${failed} chunk${failed !== 1 ? 's' : ''} failed` : providerLabel);
        }

        setTimeout(showConversionResults, 500);
    }

    // FILM-119: Convert full document with chunking
    async function convertFullDocument() {
        const text = document.getElementById('convertSourceText').value.trim();
        if (!text) { alert('Please enter text first'); return; }
        if (!state.currentProject) { alert('Please select a project first'); return; }
        const styleNotes = document.getElementById('convertStyleNotes').value.trim();
        await runConversionQueue(buildConversionQueue([{ index: 0, title: 'Full Text', content: text }]), styleNotes);
    }

    // FILM-119: Cancel conversion
    function cancelConversion() {
        conversionCancelled = true;
        if (currentAbortController) {
            currentAbortController.abort();
        }
    }

    async function startConversion() {
        const selectedChapters = detectedChapters.filter(ch => ch.selected);
        if (selectedChapters.length === 0) {
            alert('Please select at least one chapter to convert');
            return;
        }

        if (!state.currentProject) {
            alert('Please select a project first');
            return;
        }

        const styleNotes = document.getElementById('convertStyleNotes').value.trim();
        await runConversionQueue(buildConversionQueue(selectedChapters), styleNotes);
    }

    function showConversionResults() {
        document.getElementById('convertStep2').style.display = 'none';
        document.getElementById('convertStep3').style.display = 'block';

        // Combine original text
        const originalText = conversionResults
            .filter(r => r.success)
            .map(r => `--- ${r.chapter.title} ---\n\n${r.chapter.content}`)
            .join('\n\n');

        // Combine converted text
        const convertedText = conversionResults
            .filter(r => r.success)
            .map(r => r.fountain_text)
            .join('\n\n');

        document.getElementById('convertOriginalPreview').textContent = originalText;
        document.getElementById('convertResultPreview').value = convertedText;

        // Summary
        const successCount = conversionResults.filter(r => r.success).length;
        const failCount = conversionResults.filter(r => !r.success).length;
        const allScenes = conversionResults
            .filter(r => r.success)
            .flatMap(r => r.scenes_detected);
        const allCharacters = [...new Set(
            conversionResults
                .filter(r => r.success)
                .flatMap(r => r.characters_detected)
        )];

        const providersUsed = [...new Set(conversionResults.filter(r => r.success && r.provider).map(r => r.provider))];
        let summaryHtml = `<strong>${successCount}</strong> chunk${successCount !== 1 ? 's' : ''} converted`;
        if (failCount > 0) {
            summaryHtml += ` | <span style="color: var(--gl-error);">${failCount} failed</span>`;
        }
        summaryHtml += ` | <strong>${allScenes.length}</strong> scenes detected`;
        summaryHtml += ` | <strong>${allCharacters.length}</strong> characters: ${allCharacters.slice(0, 5).join(', ')}${allCharacters.length > 5 ? '...' : ''}`;
        if (providersUsed.length) summaryHtml += ` | provider: <strong>${providersUsed.join(', ')}</strong>`;

        document.getElementById('convertResultsSummary').innerHTML = summaryHtml;
    }

    function backToConvertStep1() {
        document.getElementById('convertStep3').style.display = 'none';
        document.getElementById('convertStep1').style.display = 'block';
    }

    function acceptConversion() {
        const convertedText = document.getElementById('convertResultPreview').value;
        if (!convertedText.trim()) {
            alert('No converted text to insert');
            return;
        }

        // Parse and append to editor
        const editor = document.getElementById('screenplayEditor');
        if (!editor) {
            alert('Editor not found');
            return;
        }

        // Parse the Fountain text and append to editor
        const newBlocks = parseFountainToHTML(convertedText);
        if (newBlocks) {
            // Add a separator if editor has content
            if (editor.innerText.trim()) {
                const separator = document.createElement('div');
                separator.dataset.elementType = 'action';
                separator.textContent = '';
                editor.appendChild(separator);
            }

            // Create temp container and append blocks
            const temp = document.createElement('div');
            temp.innerHTML = newBlocks;
            while (temp.firstChild) {
                editor.appendChild(temp.firstChild);
                normalizeEditor();   // every way in leaves the editor sound
            }

            // Trigger updates
            editorDirty = true;
            triggerSceneNavUpdate();
            saveScreenplay();
        }

        closeTextConvertModal();
    }

export {
    currentFountainContent,
    editorDirty,
    AUTO_FORMAT_RULES,
    stripEmphasisMarkers,
    autoDetectTimer,
    AUTO_DETECT_DELAY,
    autocompleteVisible,
    autocompleteItems,
    autocompleteSelectedIndex,
    autocompleteType,
    autoSaveTimer,
    AUTO_SAVE_DELAY,
    currentScriptVersion,
    saveStatus,
    undoStack,
    redoStack,
    MAX_UNDO_ENTRIES,
    UNDO_DEBOUNCE_DELAY,
    undoTimer,
    lastUndoTimestamp,
    sceneNumbersLocked,
    KEYBOARD_SHORTCUTS,
    shortcutHelpVisible,
    uploadScreenplay,
    scriptVersionsData,
    selectedVersions,
    loadScriptVersions,
    toggleVersionSelect,
    clearVersionSelection,
    restoreVersion,
    compareSelectedVersions,
    computeDiff,
    showVersionDiff,
    loadScriptVersion,
    loadLatestFountain,
    renderFountainToEditor,
    parseFountainToHTML,
    SP_KEEP_EMPTY,
    SP_FURNITURE,
    isEditorFurniture,
    blockHoldsCaret,
    sweepEmptyBlocks,
    textOf,
    normalizeEditor,
    onEditorInput,
    triggerAutoSave,
    performAutoSave,
    updateSaveStatus,
    captureEditorState,
    getCursorPath,
    restoreCursorPath,
    pushUndoState,
    triggerUndoCapture,
    editorUndo,
    editorRedo,
    initUndoStack,
    autoDetectElementType,
    isKnownCharacter,
    showAutoDetectSuggestion,
    acceptAutoDetectSuggestion,
    clearAutoDetectSuggestion,
    triggerAutocomplete,
    filterCharacters,
    extractLocationFromSceneHeading,
    filterLocations,
    showAutocomplete,
    positionAutocomplete,
    hideAutocomplete,
    selectAutocompleteItem,
    applyAutocompleteItemToBlock,
    createFromAutocomplete,
    setCursorToEnd,
    navigateAutocomplete,
    onEditorSelectionChange,
    updateCurrentSceneDisplay,
    updateBlockStatusInfo,
    findSpeakingCharacter,
    getCurrentSceneFountain,
    twBurst,
    twThump,
    twBell,
    typewriterKey,
    toggleTypewriterSound,
    onEditorKeydown,
    extractTextAfterCaret,
    getContextualTabCycle,
    detectElementTypeImmediate,
    getCurrentBlock,
    createBlock,
    setBlockElementType,
    setCursorToBlock,
    toggleDualDialogue,
    undualDialogue,
    calculatePageEstimate,
    updateEditorStats,
    MAY_END_PAGE,
    bodyBlocks,
    paginateInto,
    sceneNavTimer,
    SCENE_NAV_UPDATE_DELAY,
    currentSceneIndex,
    updateSceneNavigator,
    parseSceneOutline,
    triggerSceneNavUpdate,
    currentViewMode,
    indexCardsData,
    draggedCardIndex,
    SP_VIEWS,
    setViewMode,
    renderIndexCards,
    SCRIPT_TIMING,
    loadScriptTiming,
    timingRowsForHeadings,
    shotCodesByScene,
    mmss,
    renderScriptGutter,
    loadTreatment,
    saveTreatment,
    analysisBadges,
    analysisNoteHtml,
    analysisByDimension,
    analysisMapHtml,
    analysisWhen,
    loadAnalysis,
    deleteAnalysis,
    openIndexCard,
    blockText,
    sceneActionText,
    setBlockText,
    sceneHeadingBlocks,
    nextEditorBlock,
    spBlock,
    afterCardEdit,
    saveIndexCard,
    printIndexCards,
    deleteIndexCard,
    addIndexCard,
    createIndexCard,
    parseSceneBlocks,
    onCardDragStart,
    onCardDragOver,
    onCardDragLeave,
    onCardDrop,
    draggedNavSceneIndex,
    onSceneNavDragStart,
    onSceneNavDragOver,
    onSceneNavDragLeave,
    onSceneNavDrop,
    reorderScenes,
    jumpToSceneFromCard,
    currentTitlePage,
    appAuthor,
    openTitlePageModal,
    parseTitlePageFromEditor,
    parseTitlePageFromFountain,
    saveTitlePage,
    clearTitlePage,
    titlePageInnerHtml,
    updateEditorTitlePage,
    serializeTitlePageToFountain,
    currentRevision,
    currentRevisionPagesChanged,
    updateRevisionIndicator,
    loadRevisionInfo,
    updateRevisionPageMarkers,
    getMarkAsRevision,
    toggleExportDropdown,
    exportToFountain,
    exportToPlainText,
    fountainToPlainText,
    exportToPDF,
    shootingScriptMarks,
    revisionMark,
    toPrintSheets,
    fitPrintSheets,
    generatePrintHTML,
    downloadBlob,
    openImportModal,
    resetImportModal,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleFileDrop,
    handleFileSelect,
    processImportFile,
    readFileAsText,
    importFDXContent,
    importFountainContent,
    showImportSuccess,
    showImportError,
    toggleLeftPanel,
    toggleRightPanel,
    updateScriptStatsSummary,
    updateCurrentSceneHighlight,
    toggleSceneNavigator,
    scrollToScene,
    toggleLockSceneNumbers,
    updateSceneNumbers,
    updateSceneGutter,
    updateSceneNumberGutters,
    startEditSceneNumber,
    toggleAIChat,
    loadAIChatHistory,
    saveAIChatHistory,
    renderAIChatMessages,
    handleAIChatKeydown,
    streamPostSSE,
    showTypingIndicator,
    removeTypingIndicator,
    copyAIMessage,
    insertAITextAtCursor,
    aiPathBadge,
    sendAIMessage,
    getSelectedEditorContent,
    generateDiffView,
    acceptRewrite,
    rejectRewrite,
    insertAIContent,
    insertAIContentAtCursor,
    appendAIContent,
    replaceCurrentScene,
    saveScreenplay,
    editorToFountain,
    serializeEditorToFountain,
    extractFormattedText,
    toggleShortcutHelp,
    formatBold,
    formatItalic,
    formatUnderline,
    setElementType,
    toggleImportSection,
    toggleScriptStats,
    switchStatsTab,
    updateScriptStats,
    analyzeScreenplayLocal,
    runAIScriptAnalysis,
    importToEditor,
    loadScreenplayPage,
    renderScreenplayEditor,
    detectedChapters,
    conversionResults,
    conversionCancelled,
    currentAbortController,
    CONTEXT_OVERLAP,
    openTextConvertModal,
    closeTextConvertModal,
    screenplaySuggestions,
    checkScreenplaySuggestions,
    openSuggestionsPanel,
    closeSuggestionsPanel,
    renderSuggestions,
    createSuggestedCharacter,
    createSuggestedLocation,
    createAllCharacters,
    createAllLocations,
    resetConvertModal,
    handleConvertFileUpload,
    detectChapters,
    renderChaptersList,
    toggleChapter,
    selectAllChapters,
    deselectAllChapters,
    chunkText,
    formatDuration,
    setConversionProgress,
    buildConversionQueue,
    readConversionResponse,
    runConversionQueue,
    convertFullDocument,
    cancelConversion,
    startConversion,
    showConversionResults,
    backToConvertStep1,
    acceptConversion,
};
