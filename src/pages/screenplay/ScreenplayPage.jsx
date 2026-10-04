import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { legacy } from '../../lib/legacy.js';
import * as E from './engine.js';

/*
 * The Screenplay page, as React. It OWNS the screenplay engine (engine.js): the legacy screenplay chunk and the editor core only this page and its dialogs use, moved. It registers every engine function on window while mounted (the engine and the dialogs draw HTML with inline handlers that call them by name); what core, the dialogs (ScreenplayDialogs) and the Scenes page call by name is in react.json provides.
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function ScreenplayPage() {
    usePageLoader('loadScreenplayPage', E.loadScreenplayPage);
    // What legacy code calls by name (react.json provides).
    usePageLoader('bodyBlocks', E.bodyBlocks);
    usePageLoader('createIndexCard', E.createIndexCard);
    usePageLoader('resetImportModal', E.resetImportModal);
    usePageLoader('handleDragEnter', E.handleDragEnter);
    usePageLoader('handleDragLeave', E.handleDragLeave);
    usePageLoader('handleDragOver', E.handleDragOver);
    usePageLoader('handleFileDrop', E.handleFileDrop);
    usePageLoader('handleFileSelect', E.handleFileSelect);
    usePageLoader('closeTextConvertModal', E.closeTextConvertModal);
    usePageLoader('closeSuggestionsPanel', E.closeSuggestionsPanel);
    usePageLoader('createAllCharacters', E.createAllCharacters);
    usePageLoader('createAllLocations', E.createAllLocations);
    usePageLoader('handleConvertFileUpload', E.handleConvertFileUpload);
    usePageLoader('detectChapters', E.detectChapters);
    usePageLoader('selectAllChapters', E.selectAllChapters);
    usePageLoader('deselectAllChapters', E.deselectAllChapters);
    usePageLoader('convertFullDocument', E.convertFullDocument);
    usePageLoader('cancelConversion', E.cancelConversion);
    usePageLoader('startConversion', E.startConversion);
    usePageLoader('backToConvertStep1', E.backToConvertStep1);
    usePageLoader('acceptConversion', E.acceptConversion);
    usePageLoader('renderScreenplayEditor', E.renderScreenplayEditor);

    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    return (
        <>
        <div className="page" id="page-screenplay">
            {' '}
            <div className="page-header">
                {' '}
                <h2>
                    Screenplay
                </h2>
                {' '}
                <div id="scriptVersionSelector" style={{ "marginLeft": "auto" }}></div>
                {' '}
            </div>
            {' '}
            <div className="screenplay-editor-container">
                {' '}
                {/* Left Toolbar Panel */}
                {' '}
                <div className="screenplay-toolbar-panel collapsed" id="leftToolbarPanel">
                    {' '}
                    <button className="panel-toggle-btn" onClick={(event) => E.toggleLeftPanel()} title="Toggle Panel">
                        ▶
                    </button>
                    {' '}
                    <div className="section-label">
                        Element Type
                    </div>
                    {' '}
                    <select id="elementTypeSelector" onChange={(event) => E.setElementType(event.currentTarget.value)}>
                        {' '}
                        <option value="action">
                            Action
                        </option>
                        {' '}
                        <option value="scene-heading">
                            Scene Heading
                        </option>
                        {' '}
                        <option value="character">
                            Character
                        </option>
                        {' '}
                        <option value="dialogue">
                            Dialogue
                        </option>
                        {' '}
                        <option value="parenthetical">
                            Parenthetical
                        </option>
                        {' '}
                        <option value="transition">
                            Transition
                        </option>
                        {' '}
                        <option value="centered">
                            Centered
                        </option>
                        {' '}
                        <option value="dual-dialogue">
                            Dual Dialogue
                        </option>
                        {' '}
                        <option value="lyrics">
                            Lyrics
                        </option>
                        {' '}
                        <option value="note">
                            Note
                        </option>
                        {' '}
                    </select>
                    {' '}
                    <div className="section-label mt-16">
                        Navigation
                    </div>
                    {' '}
                    <button className="btn btn-outline" onClick={(event) => E.toggleSceneNavigator()} title="Ctrl+Shift+O" style={{ "width": "100%", "fontSize": "11px" }}>
                        {" Scene Navigator "}
                    </button>
                    {' '}
                    <div id="sceneNavigator" className="scene-navigator" style={{ "display": "none" }}>
                        {' '}
                        <div id="sceneNavStats" className="scene-nav-stats"></div>
                        {' '}
                        <div id="sceneNavList" className="scene-nav-list"></div>
                        {' '}
                    </div>
                    {' '}
                    <div className="section-label mt-16">
                        Actions
                    </div>
                    {' '}
                    <button className="btn btn-primary" onClick={(event) => E.saveScreenplay()} style={{ "width": "100%", "fontSize": "11px" }}>
                        {" Save Script "}
                    </button>
                    {' '}
                </div>
                {' '}
                {/* Main Editor Panel */}
                {' '}
                <div className="screenplay-main-panel">
                    {' '}
                    {/* Toolbar */}
                    {' '}
                    <div className="screenplay-toolbar">
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.formatBold()} data-tooltip="Bold text (Ctrl+B)">
                            <b>
                                B
                            </b>
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.formatItalic()} data-tooltip="Italic text (Ctrl+I)">
                            <i>
                                I
                            </i>
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.formatUnderline()} data-tooltip="Underline text (Ctrl+U)">
                            <u>
                                U
                            </u>
                        </button>
                        {' '}
                        <div className="toolbar-divider"></div>
                        {' '}
                        <span id="currentSceneNum" style={{ "fontSize": "11px", "color": "var(--gl-text-muted)" }}>
                            Scene: —
                        </span>
                        {' '}
                        <button className="toolbar-btn" id="lockSceneNumsBtn" onClick={(event) => E.toggleLockSceneNumbers()} data-tooltip="Lock scene numbers to prevent reflow during editing">
                            {" 🔓 "}
                        </button>
                        {' '}
                        <div className="toolbar-stats">
                            {' '}
                            <span id="editorPageCount">
                                Pages: 0
                            </span>
                            {' '}
                            <span id="editorWordCount">
                                Words: 0
                            </span>
                            {' '}
                        </div>
                        {' '}
                        <div className="toolbar-divider"></div>
                        {' '}
                        <span id="saveStatusIndicator" className="save-status saved">
                            Saved
                        </span>
                        {' '}
                        <div className="toolbar-divider"></div>
                        {' '}
                        <button className="toolbar-btn" id="aiChatToggle" onClick={(event) => E.toggleAIChat()} data-tooltip="Open AI writing assistant for brainstorming and rewriting (Ctrl+Shift+A)">
                            AI Chat
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.openTitlePageModal()} data-tooltip="Edit screenplay title page metadata (title, author, draft date)">
                            Title Page
                        </button>
                        {' '}
                        {/* FILM-130: Export Dropdown */}
                        {' '}
                        <div className="export-dropdown" id="exportDropdown">
                            {' '}
                            <button className="toolbar-btn" onClick={(event) => E.toggleExportDropdown()} data-tooltip="Export screenplay as Fountain, plain text, PDF, or Final Draft FDX">
                                Export
                            </button>
                            {' '}
                            <div className="export-dropdown-content">
                                {' '}
                                <button className="export-dropdown-item" onClick={(event) => E.exportToFountain()}>
                                    {" Fountain "}
                                    <small>
                                        .fountain
                                    </small>
                                    {' '}
                                </button>
                                {' '}
                                <button className="export-dropdown-item" onClick={(event) => E.exportToPlainText()}>
                                    {" Plain Text "}
                                    <small>
                                        .txt
                                    </small>
                                    {' '}
                                </button>
                                {' '}
                                <button className="export-dropdown-item" onClick={(event) => E.exportToPDF()}>
                                    {" PDF "}
                                    <small>
                                        Print/Save as PDF
                                    </small>
                                    {' '}
                                </button>
                                {' '}
                            </div>
                            {' '}
                        </div>
                        {' '}
                        {/* FILM-131: Import Button */}
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.openImportModal()} data-tooltip="Import a Final Draft (.fdx) or Fountain (.fountain) screenplay file">
                            Import
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.openTextConvertModal()} data-tooltip="Convert plain text or prose into properly formatted Fountain screenplay">
                            Convert
                        </button>
                        {' '}
                        <button className="toolbar-btn suggestions-btn" id="suggestionsBtn" onClick={(event) => E.openSuggestionsPanel()} data-tooltip="Auto-detected character and location names from your screenplay" style={{ "display": "none" }}>
                            {' '}
                            <span id="suggestionsBadge" className="suggestions-badge">
                                0
                            </span>
                            {' '}
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => legacy.toggleWriterFocus()} data-tooltip="Distraction-free: the page alone, full screen (Ctrl+Shift+F; Esc leaves)">
                            Focus
                        </button>
                        {' '}
                        <button className="toolbar-btn" id="typewriterBtn" onClick={(event) => E.toggleTypewriterSound()} data-tooltip="Typewriter sound as you type">
                            Typewriter
                        </button>
                        {' '}
                        <button className="toolbar-btn" onClick={(event) => E.toggleShortcutHelp()} data-tooltip="Show keyboard shortcut reference (Ctrl+/)">
                            ?
                        </button>
                        {' '}
                        {/* FILM-129: Revision Indicator */}
                        {' '}
                        <div className="revision-indicator" id="revisionIndicator" style={{ "display": "none" }}>
                            {' '}
                            <span className="revision-dot" id="revisionDot"></span>
                            {' '}
                            <span id="revisionLabel">
                                Draft
                            </span>
                            {' '}
                        </div>
                        {' '}
                        <label className="mark-revision-toggle" id="markRevisionToggle" style={{ "display": "none" }}>
                            {' '}
                            <input type="checkbox" id="markAsRevisionCheckbox" />
                            {" Mark as Revision "}
                        </label>
                        {' '}
                        {/* FILM-127: View Mode Toggle */}
                        {' '}
                        <div className="view-mode-toggle" style={{ "marginLeft": "auto" }}>
                            {' '}
                            <button className="view-mode-btn active" onClick={(event) => E.setViewMode('editor')} id="viewModeEditor">
                                Editor
                            </button>
                            {' '}
                            <button className="view-mode-btn" onClick={(event) => E.setViewMode('cards')} id="viewModeCards">
                                Index Cards
                            </button>
                            {' '}
                            <button className="view-mode-btn" onClick={(event) => E.setViewMode('treatment')} id="viewModeTreatment">
                                Treatment
                            </button>
                            {' '}
                            <button className="view-mode-btn" onClick={(event) => E.setViewMode('analysis')} id="viewModeAnalysis">
                                Analysis
                            </button>
                            {' '}
                        </div>
                        {' '}
                    </div>
                    {' '}
                    {/* Editor Container */}
                    {' '}
                    <div className="screenplay-scroll-container" id="editorViewContainer">
                        {' '}
                        <div className="sp-focus-bar">
                            {' '}
                            <span id="focusWordCount"></span>
                            {' '}
                            <button id="typewriterFocusBtn" onClick={(event) => E.toggleTypewriterSound()}>
                                Typewriter
                            </button>
                            {' '}
                            <button onClick={(event) => legacy.toggleWriterFocus(false)}>
                                Leave focus (Esc)
                            </button>
                            {' '}
                        </div>
                        {' '}
                        <button type="button" className="title-page-card" id="titlePageCard" onClick={(event) => E.openTitlePageModal()} title="Edit the title page: title, credit, author, source, draft date, contact, copyright, notes. It prints as the first page of the PDF.">
                            {' '}
                            <span className="tpc-label">
                                Title page
                            </span>
                            <span className="tpc-edit">
                                Edit
                            </span>
                        </button>
                        {' '}
                        <div className="screenplay-page" id="screenplayEditor" contentEditable="true" suppressContentEditableWarning spellCheck="true" onInput={(event) => E.onEditorInput()} onKeyDown={(event) => E.onEditorKeydown(event.nativeEvent)} onClick={(event) => E.onEditorSelectionChange()} onKeyUp={(event) => E.onEditorSelectionChange()}>
                            {' '}
                        </div>
                        {' '}
                    </div>
                    {' '}
                    {/* FILM-127: Index Cards View */}
                    {' '}
                    <div className="index-cards-view" id="indexCardsView">
                        {' '}
                        <div className="index-cards-toolbar">
                            {' '}
                            <button className="btn btn-sm" onClick={(event) => E.addIndexCard()}>
                                + Scene
                            </button>
                            {' '}
                            <span className="text-muted text-sm">
                                Click a card to edit it · drag to reorder · double-click to jump to it in the script
                            </span>
                            {' '}
                        </div>
                        {' '}
                        <div className="index-cards-grid" id="indexCardsGrid"></div>
                        {' '}
                    </div>
                    {' '}
                    {/* The treatment: prose before the screenplay. */}
                    {' '}
                    <div className="index-cards-view" id="treatmentView">
                        {' '}
                        <div className="index-cards-toolbar">
                            {' '}
                            <button className="btn btn-sm btn-primary" onClick={(event) => E.saveTreatment()}>
                                Save treatment
                            </button>
                            {' '}
                            <span id="treatmentMeta" className="text-muted text-sm"></span>
                            {' '}
                        </div>
                        {' '}
                        <p className="text-muted text-sm" style={{ "margin": "0 0 10px" }}>
                            {" What happens, in order — no dialogue, no format. This is what the screenplay gets written "}
                            <em>
                                from
                            </em>
                            {". Ask Claude to draft the script from it: it reads this, writes the Fountain and saves it as a new version. "}
                        </p>
                        {' '}
                        <textarea id="treatmentText" className="treatment-text" placeholder="Act one opens on…" />
                        {' '}
                    </div>
                    {' '}
                    {/* The last reading of the screenplay. */}
                    {' '}
                    <div className="index-cards-view" id="analysisView">
                        {' '}
                        <div className="index-cards-toolbar">
                            {' '}
                            <button className="btn btn-sm" onClick={(event) => E.loadAnalysis()}>
                                Refresh
                            </button>
                            {' '}
                            <span className="text-muted text-sm">
                                {"Ask Claude: "}
                                <em>
                                    read my screenplay and store the analysis
                                </em>
                                {". It uses "}
                                <code>
                                    analysis_brief
                                </code>
                                {" then "}
                                <code>
                                    analysis_write
                                </code>
                                .
                            </span>
                            {' '}
                        </div>
                        {' '}
                        <div id="analysisBody"></div>
                        {' '}
                    </div>
                    {' '}
                    {/* Import Section (Collapsible) */}
                    {' '}
                    <div className="screenplay-import-section">
                        {' '}
                        <div className="screenplay-import-toggle" onClick={(event) => E.toggleImportSection()}>
                            {' '}
                            <span id="importToggleIcon">
                                ▶
                            </span>
                            {' '}
                            <span>
                                Import Text / Upload
                            </span>
                            {' '}
                        </div>
                        {' '}
                        <div className="screenplay-import-content" id="importContent">
                            {' '}
                            <p className="text-sm text-muted mb-8">
                                Paste your screenplay (INT./EXT. scene headings). Scenes are auto-extracted.
                            </p>
                            {' '}
                            <textarea className="script-area" id="scriptInput" placeholder={"INT. COFFEE SHOP - DAY\n\nSARAH sits alone at a corner table...\n\nEXT. CITY STREET - NIGHT\n\nSarah walks through the rain."} />
                            {' '}
                            <div className="btn-row mt-16">
                                {' '}
                                <button className="btn btn-primary" onClick={(event) => E.uploadScreenplay()}>
                                    {"Upload & Extract Scenes"}
                                </button>
                                {' '}
                                <button className="btn btn-outline" onClick={(event) => E.importToEditor()}>
                                    Load into Editor
                                </button>
                                {' '}
                            </div>
                            {' '}
                        </div>
                        {' '}
                    </div>
                    {' '}
                    {/* FILM-116: Script Stats Card */}
                    {' '}
                    <div className="script-stats-section">
                        {' '}
                        <div className="script-stats-toggle" onClick={(event) => E.toggleScriptStats()}>
                            {' '}
                            <span id="statsToggleIcon">
                                ▶
                            </span>
                            {' '}
                            <span>
                                Script Statistics
                            </span>
                            {' '}
                            <span className="script-stats-summary" id="scriptStatsSummary"></span>
                            {' '}
                        </div>
                        {' '}
                        <div className="script-stats-content" id="scriptStatsContent">
                            {' '}
                            {/* FILM-126: Tabbed stats dashboard */}
                            {' '}
                            <div className="stats-dashboard-tabs">
                                {' '}
                                <button className="stats-tab active" onClick={(event) => E.switchStatsTab('overview')}>
                                    Overview
                                </button>
                                {' '}
                                <button className="stats-tab" onClick={(event) => E.switchStatsTab('dialogue')}>
                                    Dialogue
                                </button>
                                {' '}
                                <button className="stats-tab" onClick={(event) => E.switchStatsTab('scenes')}>
                                    Scenes
                                </button>
                                {' '}
                                <button className="stats-tab" onClick={(event) => E.switchStatsTab('characters')}>
                                    Characters
                                </button>
                                {' '}
                            </div>
                            {' '}
                            {/* Overview Tab */}
                            {' '}
                            <div className="stats-tab-content active" id="statsTabOverview">
                                {' '}
                                <div className="stats-runtime" id="statRuntime">
                                    Est. Runtime: —
                                </div>
                                {' '}
                                <div className="stats-runtime-note">
                                    Based on ~1 minute per screenplay page
                                </div>
                                {' '}
                                <div className="script-stats-grid" style={{ "marginTop": "12px" }}>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statTotalWords">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Words
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statPageCount">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Pages
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statSceneCount">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Scenes
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statDialoguePct">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Dialogue
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statActionPct">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Action
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stat-item">
                                        {' '}
                                        <div className="stat-value" id="statAvgSceneLen">
                                            —
                                        </div>
                                        {' '}
                                        <div className="stat-label">
                                            Avg Scene
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                </div>
                                {' '}
                            </div>
                            {' '}
                            {/* Dialogue Tab */}
                            {' '}
                            <div className="stats-tab-content" id="statsTabDialogue">
                                {' '}
                                <div className="stats-donut-container">
                                    {' '}
                                    <div className="stats-donut">
                                        {' '}
                                        <svg viewBox="0 0 100 100" width="100" height="100">
                                            {' '}
                                            <circle className="stats-donut-ring bg" cx="50" cy="50" r="40"></circle>
                                            {' '}
                                            <circle className="stats-donut-ring dialogue" id="donutDialogue" cx="50" cy="50" r="40" strokeDasharray="0 251.2"></circle>
                                            {' '}
                                        </svg>
                                        {' '}
                                        <div className="stats-donut-label">
                                            {' '}
                                            <div className="stats-donut-label-value" id="donutPctLabel">
                                                —%
                                            </div>
                                            {' '}
                                            <div className="stats-donut-label-text">
                                                Dialogue
                                            </div>
                                            {' '}
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stats-donut-legend">
                                        {' '}
                                        <div className="stats-legend-item">
                                            {' '}
                                            <span className="stats-legend-dot dialogue"></span>
                                            {' '}
                                            <span>
                                                {"Dialogue: "}
                                                <strong id="statDialogueWords">
                                                    —
                                                </strong>
                                                {" words"}
                                            </span>
                                            {' '}
                                        </div>
                                        {' '}
                                        <div className="stats-legend-item">
                                            {' '}
                                            <span className="stats-legend-dot action"></span>
                                            {' '}
                                            <span>
                                                {"Action: "}
                                                <strong id="statActionWords">
                                                    —
                                                </strong>
                                                {" words"}
                                            </span>
                                            {' '}
                                        </div>
                                        {' '}
                                    </div>
                                    {' '}
                                </div>
                                {' '}
                            </div>
                            {' '}
                            {/* Scenes Tab */}
                            {' '}
                            <div className="stats-tab-content" id="statsTabScenes">
                                {' '}
                                <div className="script-stats-details" style={{ "border": "none", "padding": "0" }}>
                                    {' '}
                                    <div className="stats-detail-row">
                                        {' '}
                                        <span className="stats-detail-label">
                                            Longest Scene:
                                        </span>
                                        {' '}
                                        <span id="statLongestScene">
                                            —
                                        </span>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stats-detail-row">
                                        {' '}
                                        <span className="stats-detail-label">
                                            Shortest Scene:
                                        </span>
                                        {' '}
                                        <span id="statShortestScene">
                                            —
                                        </span>
                                        {' '}
                                    </div>
                                    {' '}
                                </div>
                                {' '}
                                <div className="stats-ratio-bars">
                                    {' '}
                                    <div className="stats-ratio-bar">
                                        {' '}
                                        <div className="stats-ratio-bar-label">
                                            {' '}
                                            <span>
                                                INT / EXT Distribution
                                            </span>
                                            {' '}
                                        </div>
                                        {' '}
                                        <div className="stats-ratio-bar-track" id="intExtBar"></div>
                                        {' '}
                                    </div>
                                    {' '}
                                    <div className="stats-ratio-bar">
                                        {' '}
                                        <div className="stats-ratio-bar-label">
                                            {' '}
                                            <span>
                                                Time of Day
                                            </span>
                                            {' '}
                                        </div>
                                        {' '}
                                        <div className="stats-ratio-bar-track" id="timeOfDayBar"></div>
                                        {' '}
                                    </div>
                                    {' '}
                                </div>
                                {' '}
                                <h5 style={{ "margin": "16px 0 8px", "fontSize": "11px", "color": "var(--gl-text-muted)" }}>
                                    Scene Lengths
                                </h5>
                                {' '}
                                <div className="stats-scene-bars" id="sceneLengthBars"></div>
                                {' '}
                            </div>
                            {' '}
                            {/* Characters Tab */}
                            {' '}
                            <div className="stats-tab-content" id="statsTabCharacters">
                                {' '}
                                <div className="stats-character-breakdown" id="statsCharacterBreakdown"></div>
                                {' '}
                            </div>
                            {' '}
                        </div>
                        {' '}
                    </div>
                    {' '}
                </div>
                {' '}
                {/* Right Sidebar Panel - Script Versions */}
                {' '}
                <div className="screenplay-sidebar-panel collapsed" id="rightSidebarPanel">
                    {' '}
                    <button className="panel-toggle-btn" onClick={(event) => E.toggleRightPanel()} title="Toggle Panel">
                        ◀
                    </button>
                    {' '}
                    <div className="section-label">
                        Script Versions
                    </div>
                    {' '}
                    <div id="scriptVersions"></div>
                    {' '}
                </div>
                {' '}
                {/* FILM-111: AI Chat Panel */}
                {' '}
                <div className="ai-chat-panel" id="aiChatPanel">
                    {' '}
                    <div className="ai-chat-header">
                        {' '}
                        <h4>
                            AI Assistant
                        </h4>
                        {' '}
                        <select className="ai-chat-mode-select" id="aiChatMode">
                            {' '}
                            <option value="brainstorm">
                                Brainstorm
                            </option>
                            {' '}
                            <option value="write-scene">
                                Write Scene
                            </option>
                            {' '}
                            <option value="rewrite">
                                Rewrite
                            </option>
                            {' '}
                            <option value="convert">
                                Convert
                            </option>
                            {' '}
                        </select>
                        {' '}
                        <button className="ai-analyze-btn" onClick={(event) => E.runAIScriptAnalysis()} title="AI Script Analysis">
                            Analyze
                        </button>
                        {' '}
                        <button className="ai-chat-close" onClick={(event) => E.toggleAIChat()} title="Close">
                            ×
                        </button>
                        {' '}
                    </div>
                    {' '}
                    {/* Which path this panel's requests take. MCP is the default
                         when a host is attached; these HTTP routes are the fallback
                         and they spend this project's own API key. Shown rather than
                         assumed, because a writer cannot otherwise tell that the
                         same work is available for nothing. */}
                    {' '}
                    <div id="aiPathBadge" className="text-sm" style={{ "display": "none", "padding": "6px 10px", "borderBottom": "1px solid var(--gl-border-subtle)" }}></div>
                    {' '}
                    <div className="ai-chat-messages" id="aiChatMessages">
                        {' '}
                        <div className="ai-chat-message assistant">
                            {" Hi! I can help you brainstorm ideas, write scenes, rewrite dialogue, or convert content to screenplay format. What would you like to work on? "}
                        </div>
                        {' '}
                    </div>
                    {' '}
                    <div className="ai-chat-input-area">
                        {' '}
                        <textarea id="aiChatInput" placeholder="Ask me anything about your screenplay..." onKeyDown={(event) => E.handleAIChatKeydown(event.nativeEvent)} />
                        {' '}
                        <div className="send-row">
                            {' '}
                            <label className="ai-context-toggle" title="Include the current scene text as context for more relevant responses">
                                {' '}
                                <input type="checkbox" id="aiIncludeSceneContext" defaultChecked />
                                {' '}
                                <span>
                                    Scene context
                                </span>
                                {' '}
                            </label>
                            {' '}
                            <button className="send-btn" onClick={(event) => E.sendAIMessage()} id="aiSendBtn">
                                Send
                            </button>
                            {' '}
                        </div>
                        {' '}
                    </div>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
        </div>
        </>
    );
}
