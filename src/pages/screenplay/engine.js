/*
 * The Screenplay page's engine: the editor's keyboard, formatting, pagination and PDF, the scene navigator and
 * index cards, statistics, import and export (Fountain, FDX, plain text), the AI writing panel, text conversion,
 * suggestions and the typewriter. MOVED from the legacy screenplay chunk (generated from film-engine's page), with
 * the page's loader from core: same names, same bodies. React renders the page (ScreenplayPage.jsx); this drives the
 * editor and its panels through their ids, as before.
 *
 * Kept as the reference wrote it on purpose: the backend's screenplay tests read and execute these functions from
 * the page source, so the text they check is the code that runs. tools/tests/engine-verbatim.test.js holds every
 * declaration to the reference, character for character, except one mechanical rewrite: the editor's shared state
 * stays in core (normalizeEditor, the autosave and Sync screenplay read it too), and a module cannot assign another
 * script's `let` or read it live, so a core variable X is read as legacy.X and assigned with setLegacy('X', value).
 *
 * The core functions this code calls are reached through the bridge below, by the same names;
 * tools/tests/engine-bridge.test.js holds that nothing is reached any other way.
 */
import { legacy, setLegacy } from '../../lib/legacy.js';

const acceptAutoDetectSuggestion = (...a) => legacy.acceptAutoDetectSuggestion(...a);
const afterCardEdit = (...a) => legacy.afterCardEdit(...a);
const api = (...a) => legacy.api(...a);
const captureEditorState = (...a) => legacy.captureEditorState(...a);
const checkScreenplaySuggestions = (...a) => legacy.checkScreenplaySuggestions(...a);
const checkUploadSize = (...a) => legacy.checkUploadSize(...a);
const clearAutoDetectSuggestion = (...a) => legacy.clearAutoDetectSuggestion(...a);
const closeModal = (...a) => legacy.closeModal(...a);
const createBlock = (...a) => legacy.createBlock(...a);
const editorToFountain = (...a) => legacy.editorToFountain(...a);
const esc = (...a) => legacy.esc(...a);
const escapeHtml = (...a) => legacy.escapeHtml(...a);
const focusWordCount = (...a) => legacy.focusWordCount(...a);
const getCurrentBlock = (...a) => legacy.getCurrentBlock(...a);
const hideAutocomplete = (...a) => legacy.hideAutocomplete(...a);
const isKnownCharacter = (...a) => legacy.isKnownCharacter(...a);
const loadCharacters = (...a) => legacy.loadCharacters(...a);
const loadLatestFountain = (...a) => legacy.loadLatestFountain(...a);
const loadLocations = (...a) => legacy.loadLocations(...a);
const loadRevisionInfo = (...a) => legacy.loadRevisionInfo(...a);
const loadScriptTiming = (...a) => legacy.loadScriptTiming(...a);
const loadScriptVersions = (...a) => legacy.loadScriptVersions(...a);
const normalizeEditor = (...a) => legacy.normalizeEditor(...a);
const parseFountainToHTML = (...a) => legacy.parseFountainToHTML(...a);
const renderFountainToEditor = (...a) => legacy.renderFountainToEditor(...a);
const renderScriptGutter = (...a) => legacy.renderScriptGutter(...a);
const saveScreenplay = (...a) => legacy.saveScreenplay(...a);
const selectAutocompleteItem = (...a) => legacy.selectAutocompleteItem(...a);
const serializeEditorToFountain = (...a) => legacy.serializeEditorToFountain(...a);
const setBlockElementType = (...a) => legacy.setBlockElementType(...a);
const setCursorToBlock = (...a) => legacy.setCursorToBlock(...a);
const setStatus = (...a) => legacy.setStatus(...a);
const showModal = (...a) => legacy.showModal(...a);
const spBlock = (...a) => legacy.spBlock(...a);
const timingRowsForHeadings = (...a) => legacy.timingRowsForHeadings(...a);
const toggleWriterFocus = (...a) => legacy.toggleWriterFocus(...a);
const triggerAutoSave = (...a) => legacy.triggerAutoSave(...a);
const triggerSceneNavUpdate = (...a) => legacy.triggerSceneNavUpdate(...a);
const twBurst = (...a) => legacy.twBurst(...a);
const typewriterButtons = (...a) => legacy.typewriterButtons(...a);
const updateConversionEstimate = (...a) => legacy.updateConversionEstimate(...a);
const updateCurrentSceneHighlight = (...a) => legacy.updateCurrentSceneHighlight(...a);
const updateEditorStats = (...a) => legacy.updateEditorStats(...a);
const updateSaveStatus = (...a) => legacy.updateSaveStatus(...a);
const updateSceneNavigator = (...a) => legacy.updateSceneNavigator(...a);
const updateSceneNumbers = (...a) => legacy.updateSceneNumbers(...a);
const updateSceneStatusIcons = (...a) => legacy.updateSceneStatusIcons(...a);
const updateScriptStats = (...a) => legacy.updateScriptStats(...a);
const live = (name) => new Proxy({}, {
    get: (_, k) => legacy[name][k],
    set: (_, k, v) => { legacy[name][k] = v; return true; },
    has: (_, k) => k in legacy[name],
    ownKeys: () => Reflect.ownKeys(legacy[name]),
    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(legacy[name], k); if (d) d.configurable = true; return d; },
    deleteProperty: (_, k) => delete legacy[name][k],
});
const state = live('state');

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

    function editorUndo() {
        if (legacy.undoStack.length === 0) {
            setStatus('Nothing to undo');
            return;
        }

        // Push current state to redo stack
        const currentState = captureEditorState();
        if (currentState) {
            legacy.redoStack.push(currentState);
        }

        // Pop from undo stack
        const previousState = legacy.undoStack.pop();

        // Restore
        const editor = document.getElementById('screenplayEditor');
        if (editor && previousState) {
            editor.innerHTML = previousState.html;
            normalizeEditor();   // every way in leaves the editor sound
            restoreCursorPath(previousState.cursor);
            setLegacy('editorDirty', true);
            triggerAutoSave();
        }
    }

    function editorRedo() {
        if (legacy.redoStack.length === 0) {
            setStatus('Nothing to redo');
            return;
        }

        // Push current state to undo stack
        const currentState = captureEditorState();
        if (currentState) {
            legacy.undoStack.push(currentState);
        }

        // Pop from redo stack
        const nextState = legacy.redoStack.pop();

        // Restore
        const editor = document.getElementById('screenplayEditor');
        if (editor && nextState) {
            editor.innerHTML = nextState.html;
            normalizeEditor();   // every way in leaves the editor sound
            restoreCursorPath(nextState.cursor);
            setLegacy('editorDirty', true);
            triggerAutoSave();
        }
    }

    // Navigate autocomplete with arrow keys
    function navigateAutocomplete(direction) {
        if (!legacy.autocompleteVisible || legacy.autocompleteItems.length === 0) return false;

        if (direction === 'up') {
            setLegacy('autocompleteSelectedIndex', Math.max(0, legacy.autocompleteSelectedIndex - 1));
        } else if (direction === 'down') {
            setLegacy('autocompleteSelectedIndex', Math.min(legacy.autocompleteItems.length - 1, legacy.autocompleteSelectedIndex + 1));
        }

        // Update UI
        const dropdown = document.getElementById('autocompleteDropdown');
        if (dropdown) {
            const items = dropdown.querySelectorAll('.autocomplete-item');
            items.forEach((item, i) => {
                item.classList.toggle('selected', i === legacy.autocompleteSelectedIndex);
            });
            // Scroll into view
            items[legacy.autocompleteSelectedIndex]?.scrollIntoView({ block: 'nearest' });
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
        if (!legacy.TYPEWRITER.on() || event.ctrlKey || event.metaKey || event.altKey) return;
        const k = event.key || '';
        const printable = k.length === 1;
        if (!printable && !['Enter', 'Backspace', 'Tab', 'Delete'].includes(k)) return;
        const ctx = legacy.TYPEWRITER.audio();
        if (!ctx) return;
        const now = ctx.currentTime;
        if (now - legacy.TYPEWRITER.last < 0.025) return;   // a held key is a rattle, not a roar
        legacy.TYPEWRITER.last = now;
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
        legacy.TYPEWRITER.set(!legacy.TYPEWRITER.on());
        if (legacy.TYPEWRITER.on()) legacy.TYPEWRITER.audio();
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
                toggleAIChat();
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
        if (legacy.autocompleteVisible && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            navigateAutocomplete(event.key === 'ArrowUp' ? 'up' : 'down');
            return;
        }

        // Escape key: close autocomplete, help, or clear suggestion
        if (event.key === 'Escape') {
            if (legacy.autocompleteVisible) {
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
            if (legacy.autocompleteVisible && legacy.autocompleteItems.length > 0) {
                selectAutocompleteItem(legacy.autocompleteSelectedIndex);
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
            if (legacy.autocompleteVisible && legacy.autocompleteItems.length > 0) {
                selectAutocompleteItem(legacy.autocompleteSelectedIndex);
                return;
            }

            const block = getCurrentBlock();

            // Clear any pending auto-detect
            if (legacy.autoDetectTimer) clearTimeout(legacy.autoDetectTimer);

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
                const emptyType = legacy.AUTO_FORMAT_RULES.emptyLineType[finalType] || 'action';
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
                    : (legacy.AUTO_FORMAT_RULES.nextType[finalType] || 'action');

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
            return legacy.AUTO_FORMAT_RULES.tabCycles['in-dialogue'];
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
            return legacy.AUTO_FORMAT_RULES.tabCycles['after-scene'];
        }

        return legacy.AUTO_FORMAT_RULES.tabCycles['default'];
    }

    // Immediate element type detection (called on Enter, no debounce)
    function detectElementTypeImmediate(text, currentType) {
        if (!text) return null;

        // Structure first, and `centered` before `forcedTransition`: both open
        // with `>` and only the closing `<` separates them. Kept in the same
        // order as autoDetectElementType, because two classifiers that disagree
        // about what a line is are worse than one that is wrong.
        if (legacy.AUTO_FORMAT_RULES.patterns.centered.test(text)) return 'centered';
        if (legacy.AUTO_FORMAT_RULES.patterns.section.test(text)) return 'section';
        if (legacy.AUTO_FORMAT_RULES.patterns.synopsis.test(text)) return 'synopsis';
        if (legacy.AUTO_FORMAT_RULES.patterns.lyrics.test(text)) return 'lyrics';
        if (legacy.AUTO_FORMAT_RULES.patterns.note.test(text)) return 'note';

        // Check for forced element markers
        if (legacy.AUTO_FORMAT_RULES.patterns.forcedSceneHeading.test(text)) {
            return 'scene-heading';
        }
        if (legacy.AUTO_FORMAT_RULES.patterns.forcedCharacter.test(text)) {
            return 'character';
        }
        if (legacy.AUTO_FORMAT_RULES.patterns.forcedTransition.test(text)) {
            return 'transition';
        }

        // Check for scene heading
        if (legacy.AUTO_FORMAT_RULES.patterns.sceneHeading.test(text)) {
            return 'scene-heading';
        }

        // Check for transition (ALL CAPS ending with :)
        if (legacy.AUTO_FORMAT_RULES.patterns.transition.test(text) && text.length > 3) {
            return 'transition';
        }

        // Check for parenthetical in dialogue context
        if (legacy.AUTO_FORMAT_RULES.patterns.parenthetical.test(text) &&
            ['dialogue', 'character'].includes(currentType)) {
            return 'parenthetical';
        }

        // Check for character (all caps, reasonable length)
        if (currentType === 'action' && isKnownCharacter(text)) {
            return 'character';
        }

        return null;
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

        setLegacy('editorDirty', true);
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

        setLegacy('editorDirty', true);
        setStatus('Dual dialogue removed');
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

    /** A new scene, added at the end — where a writer adds the next one. */
    function addIndexCard() {
        document.getElementById('newSceneHeading').value = '';
        document.getElementById('newSceneSynopsis').value = '';
        showModal('newSceneCardModal');
    }

    function createIndexCard() {
        const editor = document.getElementById('screenplayEditor');
        if (!editor) return;
        const heading = document.getElementById('newSceneHeading').value.trim();
        if (!heading) { setStatus('A scene needs a heading'); return; }
        const synopsis = document.getElementById('newSceneSynopsis').value.trim();

        editor.appendChild(spBlock('scene-heading', heading.toUpperCase()));
        if (synopsis) editor.appendChild(spBlock('action', synopsis));

        closeModal('newSceneCardModal');
        afterCardEdit('Scene added');
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
        shootingScriptMarks(printable, legacy.SCRIPT_TIMING);
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
            setLegacy('currentFountainContent', script.fountain_content || data.script.fountain_content);
            setLegacy('currentScriptVersion', script.version);
            renderFountainToEditor(legacy.currentFountainContent);
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

    // FILM-111: AI Chat Panel functions
    function toggleAIChat() {
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
        setLegacy('editorDirty', true);
        triggerAutoSave();
        setStatus('AI content inserted');
    }

    async function aiPathBadge() {
        const el = document.getElementById('aiPathBadge');
        if (!el) return;
        // Cheap and cached: presence changes on the scale of a session, not a
        // keystroke, and asking on every render would spend a request per typed
        // character to learn the same thing.
        if (Date.now() - legacy.AI_PATH.checked > 60000) {
            try {
                const r = await api('/agent');
                legacy.AI_PATH.connected = !!r.connected;
                legacy.AI_PATH.client = r.client;
                legacy.AI_PATH.alternatives = r.ai_endpoints || [];
            } catch (_) { legacy.AI_PATH.connected = false; }
            legacy.AI_PATH.checked = Date.now();
        }

        el.style.display = 'block';
        if (legacy.AI_PATH.connected) {
            el.style.background = 'rgba(34,197,94,0.10)';
            el.innerHTML = `<strong>${esc(legacy.AI_PATH.client || 'An agent host')} is connected.</strong> `
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
                legacy.API() + `/projects/${state.currentProject.id}/screenplay-ai/stream`,
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

        setLegacy('editorDirty', true);
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

        setLegacy('editorDirty', true);
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

        setLegacy('editorDirty', true);
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

        setLegacy('editorDirty', true);
        triggerAutoSave();
        triggerSceneNavUpdate();
        updateSceneNumbers();
        setStatus('Scene replaced with AI content');
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
                legacy.API() + `/projects/${state.currentProject.id}/screenplay-ai/stream`,
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
        setLegacy('currentFountainContent', text);
        renderFountainToEditor(text);
        toggleImportSection();
        setStatus('Loaded into editor');
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

    function openSuggestionsPanel() {
        showModal('suggestionsModal');
        renderSuggestions();
    }

    function closeSuggestionsPanel() {
        closeModal('suggestionsModal');
    }

    function renderSuggestions() {
        const chars = legacy.screenplaySuggestions.unmatched_characters || [];
        const locs = legacy.screenplaySuggestions.unmatched_locations || [];

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
        const char = legacy.screenplaySuggestions.unmatched_characters[index];
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
        const loc = legacy.screenplaySuggestions.unmatched_locations[index];
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
        const chars = legacy.screenplaySuggestions.unmatched_characters || [];
        for (let i = 0; i < chars.length; i++) {
            await createSuggestedCharacter(i);
        }
    }

    async function createAllLocations() {
        const locs = legacy.screenplaySuggestions.unmatched_locations || [];
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
                const response = await fetch(`${legacy.API()}/projects/${state.currentProject.id}/text-to-screenplay/preview`, {
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
            setLegacy('editorDirty', true);
            triggerSceneNavUpdate();
            saveScreenplay();
        }

        closeTextConvertModal();
    }

    // ── The page's loader, from core ──

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
        setLegacy('SCRIPT_TIMING', null);
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

export {
    KEYBOARD_SHORTCUTS,
    shortcutHelpVisible,
    uploadScreenplay,
    restoreCursorPath,
    editorUndo,
    editorRedo,
    navigateAutocomplete,
    onEditorSelectionChange,
    updateCurrentSceneDisplay,
    updateBlockStatusInfo,
    findSpeakingCharacter,
    getCurrentSceneFountain,
    twThump,
    twBell,
    typewriterKey,
    toggleTypewriterSound,
    onEditorKeydown,
    extractTextAfterCaret,
    getContextualTabCycle,
    detectElementTypeImmediate,
    toggleDualDialogue,
    undualDialogue,
    MAY_END_PAGE,
    bodyBlocks,
    paginateInto,
    saveTreatment,
    addIndexCard,
    createIndexCard,
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
    toggleSceneNavigator,
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
    toggleShortcutHelp,
    formatBold,
    formatItalic,
    formatUnderline,
    setElementType,
    toggleImportSection,
    toggleScriptStats,
    switchStatsTab,
    runAIScriptAnalysis,
    importToEditor,
    detectedChapters,
    conversionResults,
    conversionCancelled,
    currentAbortController,
    CONTEXT_OVERLAP,
    openTextConvertModal,
    closeTextConvertModal,
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
    loadScreenplayPage,
};
