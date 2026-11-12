// Reading the source app: the one-file index.html of ../film-engine.
const fs = require('fs');
const acorn = require('acorn');

const parse = (code, onComment) => acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowHashBang: true, onComment });

/** The pieces of index.html, in order: head styles, body markup, the five scripts. */
function readSource(file) {
    const text = fs.readFileSync(file, 'utf8');
    const bodyAt = text.indexOf('<body>');
    if (bodyAt < 0) throw new Error('no <body> in ' + file);
    const head = text.slice(0, bodyAt);
    const styles = [...head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)].map(m => ({ attrs: m[1], css: m[2] }));
    const scripts = [];
    const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
    re.lastIndex = bodyAt;
    let m, between = [], last = null;
    while ((m = re.exec(text))) {
        if (last !== null) between.push(text.slice(last, m.index));
        scripts.push({ attrs: m[1], code: m[2], at: m.index });
        last = re.lastIndex;
    }
    if (scripts.length !== 5) throw new Error(`expected 5 scripts after <body>, found ${scripts.length}`);
    between.push(text.slice(last, text.lastIndexOf('</body>')));
    for (const gap of between) {
        if (gap.replace(/<!--[\s\S]*?-->/g, '').trim()) throw new Error('unexpected markup between scripts: ' + gap.trim().slice(0, 80));
    }
    const html = text.slice(bodyAt + '<body>'.length, scripts[0].at);
    const [three, gltf, app, productionGraph, shell] = scripts.map(s => s.code);
    if (!/production-graph-js/.test(scripts[3].attrs) || !/fe-redesign-js/.test(scripts[4].attrs)) throw new Error('script order changed in source');
    // What the user retired (RETIRED, below) is cut here, as the source is read: every reader sees the app without it,
    // `text` too (the whole page, put back together from the retired parts, for readers of the page's own markup).
    const out = retire({ styles, html, three, gltf, app, productionGraph, shell });
    const keys = ['three', 'gltf', 'app', 'productionGraph', 'shell'];
    const htmlAt = bodyAt + '<body>'.length;
    let whole = text.slice(0, htmlAt) + out.html;
    let at = scripts[0].at;
    scripts.forEach((sc, i) => {
        const codeAt = sc.at + `<script${sc.attrs}>`.length;
        whole += text.slice(at, codeAt) + out[keys[i]];
        at = codeAt + sc.code.length;
    });
    out.text = whole + text.slice(at);
    return out;
}

/** navigateTo's loaders map: page -> the functions its loader calls. */
function loaderMap(app) {
    const nav = parse(app).body.find(s => s.type === 'FunctionDeclaration' && s.id.name === 'navigateTo');
    const decl = nav.body.body.find(s => s.type === 'VariableDeclaration' && s.declarations[0].id.name === 'loaders');
    const out = {};
    for (const p of decl.declarations[0].init.properties) {
        const v = p.value;
        out[p.key.name] = v.type === 'Identifier' ? [v.name] : [...app.slice(v.start, v.end).matchAll(/([A-Za-z_$][\w$]*)\(/g)].map(m => m[1]);
    }
    return out;
}

/** Top-level function declarations, with their source span. */
function topLevelFunctions(code) {
    return parse(code).body.filter(s => s.type === 'FunctionDeclaration').map(s => ({ name: s.id.name, start: s.start, end: s.end }));
}

/** Top-level elements of an HTML fragment: [{tag, id, start, end, outer}]. */
function topLevelElements(html) {
    const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    const out = [];
    let depth = 0, cur = null, m;
    while ((m = tagRe.exec(html))) {
        if (m[0].startsWith('<!--')) continue;
        const [, close, rawTag, attrs, selfClose] = m;
        const tag = rawTag.toLowerCase();
        if (close) {
            depth--;
            if (depth === 0 && cur) { cur.end = tagRe.lastIndex; cur.outer = html.slice(cur.start, cur.end); out.push(cur); cur = null; }
            if (depth < 0) throw new Error('unbalanced markup near ' + m.index);
            continue;
        }
        if (VOID.has(tag) || selfClose) {
            if (depth === 0) out.push({ tag, id: (attrs.match(/\bid="([^"]+)"/) || [])[1], start: m.index, end: tagRe.lastIndex, outer: m[0] });
            continue;
        }
        if (depth === 0) cur = { tag, id: (attrs.match(/\bid="([^"]+)"/) || [])[1], cls: (attrs.match(/\bclass="([^"]+)"/) || [])[1] || '', start: m.index };
        depth++;
    }
    if (depth !== 0) throw new Error('unbalanced markup at end');
    return out;
}

/** The inner HTML of an element's outerHTML. */
const innerOf = (outer) => outer.slice(outer.indexOf('>') + 1, outer.lastIndexOf('</'));

const words = (text) => new Set(text.match(/[A-Za-z_$][\w$]*/g) || []);

/**
 * A top-level statement a React page replaced (src/pages/<id>/react.json "replaces"): a function
 * declaration of that name, or a const/let/var whose every declared name is replaced (the page's
 * own constants, e.g. BRAND_FIELDS_SERVED, which otherwise fall into core as dead code).
 */
function replacedStatement(node, replaced, { mounts } = {}) {
    if (node.type === 'FunctionDeclaration') return replaced.has(node.id.name);
    if (node.type === 'VariableDeclaration') return node.declarations.every(d => d.id.type === 'Identifier' && replaced.has(d.id.name));
    // `window.X = X;` exposing a replaced function: the React page registers X on window itself (react.json
    // `provides`), and left behind this would read a function that no longer exists, at load.
    if (node.type === 'ExpressionStatement') {
        const e = node.expression;
        // `window.addEventListener('keydown', X);` binding a replaced function: the React page binds it on
        // mount (and unbinds it), so the page's handler acts only while the page exists.
        if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed
            && e.callee.object.type === 'Identifier' && e.callee.object.name === 'window' && e.callee.property.name === 'addEventListener'
            && e.arguments.length === 2 && e.arguments[1].type === 'Identifier' && replaced.has(e.arguments[1].name)) return true;
        // `document.addEventListener('mousemove', (evt) => { … })`, an INLINE handler that is wholly a replaced page's:
        // every function it calls by name is replaced (Flows' canvas drag calls svgPoint and flowCanvasRender). The page
        // binds the same handler on mount. One call of anything else keeps the statement, and the split's "still used"
        // check then names it, so a shared listener is never dropped by this.
        if (e.type === 'CallExpression' && e.callee.type === 'MemberExpression' && !e.callee.computed
            && e.callee.object.type === 'Identifier' && ['window', 'document'].includes(e.callee.object.name)
            && e.callee.property.name === 'addEventListener' && e.arguments.length === 2
            && /^(ArrowFunctionExpression|FunctionExpression)$/.test(e.arguments[1].type)) {
            const called = new Set();
            const walk = (n) => {
                if (!n || typeof n.type !== 'string') return;
                if (n.type === 'CallExpression' && n.callee.type === 'Identifier') called.add(n.callee.name);
                for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v.type === 'string') walk(v); }
            };
            walk(e.arguments[1].body);
            // Wholly the page's: dropped. Otherwise not decided here: the mount rule below may still own it.
            if (called.size > 0 && [...called].every(n => replaced.has(n))) return true;
        }
        /*
         * Anything else a chunk did when it LOADED (a listener whose handler also reads core, window.callback = …,
         * Object.assign(window, {…})), when every replaced name it touches belongs to ONE owner whose react.json
         * declares "mount": that page's mount module binds it again on mount, and tools/tests/page-mount.test.js
         * holds every statement dropped this way to being bound there, verbatim. A statement touching two owners, or
         * an owner with no mount, is kept, and the split's "still used" check names it.
         */
        if (mounts && mounts.size && replaced instanceof Map) {
            const owners = new Set();
            const walk = (n, parent, key) => {
                if (!n || typeof n.type !== 'string') return;
                const isKey = parent && ((parent.type === 'MemberExpression' && key === 'property' && !parent.computed)
                    || (parent.type === 'Property' && key === 'key' && !parent.computed && !parent.shorthand));
                if (n.type === 'Identifier' && !isKey && replaced.has(n.name)) owners.add(replaced.get(n.name));
                for (const k of Object.keys(n)) { const v = n[k]; if (Array.isArray(v)) v.forEach(x => walk(x, n, k)); else if (v && typeof v.type === 'string') walk(v, n, k); }
            };
            walk(e, null, null);
            if (owners.size === 1 && mounts.has([...owners][0])) return true;
        }
        return e.type === 'AssignmentExpression' && e.operator === '=' && e.left.type === 'MemberExpression' && !e.left.computed
            && e.left.object.type === 'Identifier' && e.left.object.name === 'window' && e.right.type === 'Identifier'
            && e.left.property.name === e.right.name && replaced.has(e.right.name);
    }
    return false;
}

/**
 * A whole classic script less what React replaced: each top-level statement replacedStatement() matches
 * leaves together with the text that leads into it (its comments), exactly as the app script's
 * statements do. Used for every script the split emits whole (production-graph.js, shell.js), so a
 * react.json can replace code wherever the source keeps it. Returns the text and the names it declares.
 */
function cutScript(code, replaced, opts) {
    const ast = parse(code);
    let out = '', prev = 0;
    const declared = new Set();
    for (const n of ast.body) {
        if (n.type === 'FunctionDeclaration') declared.add(n.id.name);
        if (n.type === 'VariableDeclaration') for (const d of n.declarations) if (d.id.type === 'Identifier') declared.add(d.id.name);
        if (!replacedStatement(n, replaced, opts)) out += code.slice(prev, n.end);
        prev = n.end;
    }
    return { code: out + code.slice(prev), declared };
}

/**
 * Calls of `names` that run while a script LOADS: its top-level statements, and the body of a function
 * it calls on the spot (an IIFE; shell.js is one). A call inside any other function body runs later,
 * when something calls that function. A React page or component registers what it provides when it
 * mounts, so a load-time call is the one kind that could find the name missing.
 * Returns [{ name, at }] (at: the character offset of the call).
 */
function loadTimeCalls(code, names) {
    const want = names instanceof Set ? names : new Set(names);
    const found = [];
    const isFn = (n) => n && /^(FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
    const calledName = (c) => c.type === 'Identifier' ? c.name
        : c.type === 'MemberExpression' && !c.computed && c.object.type === 'Identifier' && c.object.name === 'window' ? c.property.name : null;
    const visit = (n) => {
        if (!n || typeof n.type !== 'string') return;
        if (n.type === 'FunctionDeclaration' || isFn(n) || n.type === 'ClassDeclaration' || n.type === 'ClassExpression') return;
        if (n.type === 'CallExpression' || n.type === 'NewExpression') {
            const name = calledName(n.callee);
            if (name && want.has(name)) found.push({ name, at: n.start });
            // An IIFE: its body runs now.
            const callee = n.callee.type === 'ParenthesizedExpression' ? n.callee.expression : n.callee;
            if (isFn(callee)) visit(callee.body);
        }
        for (const k of Object.keys(n)) {
            if (k === 'type' || k === 'start' || k === 'end') continue;
            const v = n[k];
            if (Array.isArray(v)) v.forEach(visit);
            else if (v && typeof v.type === 'string') visit(v);
        }
    };
    visit(parse(code));
    return found;
}

/*
 * The calls of a React-registered name that the legacy code makes while it LOADS, each with why it is
 * safe: main.jsx mounts App synchronously before any legacy script, and registration is a layout effect
 * (tools/tests/react-pages.test.js holds both). Any other load-time call fails the split: a new one is a
 * decision, made here, not an accident.
 */
const LOAD_TIME_CALLS = {
    loadProjects: 'core INIT: loadProjects().then(applyRoute) restores the route at boot (ProjectsPage registers it)',
};

/*
 * Declarations REMOVED from the legacy core: nothing called them in the original app, and nothing here does
 * (tools/tests/removed.test.js checks both, set-based). Listed so a removal is visible and argued, never silent; decided
 * by the user on 2026-10-04 from docs/core-ownership.md's "dead in the original too" list. The split drops them like
 * replaced code; their routes and MCP tools, where they had any, are untouched.
 */
const UNREAD = 'declared and read by nothing: the app, in the original or here, and no backend test';
const REMOVED = {
    generatorPicker: 'a generator dropdown nothing drew in the original (the confirmation has its own pickers)',
    AI_GENERATE_HINTS: UNREAD, AUTO_NEXT_TYPE: UNREAD, MW_LANE_H: UNREAD, RECOMPOSE: UNREAD,
    REVISION_COLORS: UNREAD, TAB_CYCLE: UNREAD,
};
/*
 * Dead in the original app too, and KEPT, because film-engine's backend tests read them: the three registries are the
 * lists those tests check against (ELEMENT_TYPES, PV_MODES, worldOccupancy), and the rest is dead UI the
 * tests still assert exists (the entity inspector and its location-views panel, two image generators). Removing them
 * is a separate decision, with their tests. Listed so the next look at core's dead code starts here. A test can hold
 * code by NAME or by a line of its TEXT (tools/tests/removed.test.js checks both).
 */
const KEPT_FOR_TESTS = ['ELEMENT_TYPES', 'PV_MODES', 'worldOccupancy', 'inspectEntity', 'renderCharacterViewsInto',
    'renderLocationViews', 'deleteLocationView', 'refineLocationView', 'acceptPlate', 'generateLocationImage', 'generatePropImage',
    'ENTITY_FIELDS', // read by inspectEntity, kept
    // The inline screenplay comments UI: screenplay-pagination pins two of its lines (an element_index built from bodyBlocks).
    'addScreenplayComment', 'clearCommentHighlights', 'commentsVisible', 'loadScreenplayComments', 'renderCommentHighlights', 'screenplayComments'];

/**
 * What React took from the legacy code, as replacedStatement() needs it: every replaced name -> its owner (a page id,
 * or "component:<Name>"), and the pages that bind again, on mount, what their chunk did at load (react.json "mount").
 * One answer for the split, the assembled test page and the parity test, so the three cannot disagree about what left.
 * `react` and `components` are the maps split-map writes (docs/split-map.json "react" / "reactComponents").
 */
function replacedBy(react = {}, components = {}) {
    const replaced = new Map([
        ...Object.entries(react).flatMap(([id, r]) => r.replaces.map(n => [n, id])),
        ...Object.entries(components).flatMap(([name, r]) => r.replaces.map(n => [n, `component:${name}`])),
    ]);
    for (const n of Object.keys(REMOVED)) replaced.set(n, 'removed');
    const mounts = new Set(Object.entries(react).filter(([, r]) => r.mount).map(([id]) => id));
    return { replaced, mounts };
}

/*
 * RETIRED FEATURES: whole features the user took out of Film Engine. Unlike REMOVED (dead code), these were live in
 * the original app, so they are cut from the reference as it is READ (readSource): every reader (the split, the
 * assembled test page, the parity and verbatim tests, core ownership) sees the app without them, and a build cannot
 * bring them back. A retired page loses its markup, its sidebar button, its loader, its guide entry and its place in
 * every list that names it; a retired name loses its top-level declaration; a retired modal its markup; `text` makes
 * the few wording changes the removal needs in what stays (each must match exactly once, or reading fails).
 * tools/tests/retired.test.js holds what is left of the app to none of it.
 */
const RETIRED = {
    music: {
        why: 'Music-making removed by the user on 2026-10-14: the Score workstation, Music Cues and AI score generation. '
            + 'The sound library (SFX, ambient) and imported music files stay.',
        pages: ['musicws', 'musiccues'],
        modals: ['musicCueModal'],
        // Style rules every selector of which names one of these classes (the workstation's, the cue sheet's).
        cssClasses: [/^mw-/, 'cue-card', 'cue-icon', 'snd-actions', 'snd-cards', 'snd-empty', 'snd-grid'],
        names: [
            // Music Cues: the cue list, the cue form, its sections and its rights
            'loadMusicCues', 'CUE_RIGHTS_VOCAB', 'cueRightsTag', 'openCueRights', 'saveCueRights', 'CUE_SECTIONS', 'cueRenderSections',
            'cueAddSection', 'cueRemoveSection', 'cueClearSections', 'cueSectionEdit', 'createMusicCue', 'SOUND_CATEGORIES',
            // the Score workstation
            'loadMusicWorkstation', 'MW', 'MW_TRACK_TABS', 'MW_KIND_TABLE', 'mwLoadSession', 'mwPickSession', 'mwFindRow', 'mwTrackOf',
            'mwLengthMs', 'mwX', 'mwMs', 'mwRender', 'mwSessionListHtml', 'mwStatusHtml', 'mwApprovalHtml', 'mwApprove', 'mwUnapprove',
            'mwDriftHtml', 'mwMoveToEdit', 'mwPictureHtml', 'mwPictureSound', 'mwPictureFollow', 'mwRebase', 'mwContextHtml',
            'mwProviderHtml', 'mwRulerHtml', 'mwEmotionHtml', 'mwTrackHtml', 'mwToggleTrack', 'mwTrackTab', 'mwTrackPlayHtml',
            'mwPlayTrack', 'mwTrackDetailsHtml', 'mwTrackSections', 'MW_ROW_H', 'MW_BLACK', 'MW_PITCH_NAMES', 'mwPitchName', 'mwNotesOf',
            'mwRollRange', 'mwTempoBpm', 'mwSnapMs', 'mwSnap', 'mwPartPaneHtml', 'mwRollHtml', 'mwSetProgram', 'mwRollPointerDown',
            'mwRollDelete', 'mwSaveNotes', 'mwPreviewPitch', 'mwHear', 'mwClipHtml', 'mwEnumOptions', 'mwControl', 'mwInspectorHtml',
            'mwInstrumentControl', 'mwTrackOfAutomation', 'mwTakeGroupHtml', 'mwChooseTake', 'mwAddClipFromAsset',
            'mwAddClipFromAssetSubmit', 'mwFieldChanged', 'mwSave', 'mwNote', 'mwRepaint', 'mwSelect', 'mwShowTrack', 'mwCreate',
            'mwDelete', 'mwCreateSession', 'mwCreateSessionSubmit', 'mwSeek', 'mwZoom', 'mwClipPointerDown', 'mwDragOver', 'mwDrop',
            'mwImportFiles', 'mwHeard', 'mwClipLevel', 'mwBuffer', 'mwTogglePlay', 'mwPlay', 'mwStopSources', 'mwPause', 'mwStop',
            'mwRestartAudio',
            // its DAW (Ableton) panel
            'DAW_ACTIONS', 'DAW_ADAPTER', 'dawState', 'dawBase', 'dawPaint', 'dawCanChange', 'dawUndecided', 'dawConnectionHtml',
            'dawPortableHtml', 'dawSessionHtml', 'dawPushHtml', 'dawResultHtml', 'dawPullHtml', 'dawTransportHtml', 'dawAuditHtml',
            'dawPanelHtml', 'dawRefresh', 'dawRun', 'dawReadSession', 'dawPlanPush', 'dawResolve', 'dawPush', 'dawPlanPull', 'dawPull',
            'dawTransport', 'dawExportPackage', 'dawImportPackage',
            // its AI score actions
            'SCORE_AI_ACTIONS', 'scoreAiCapability', 'scoreAiNeed', 'scoreAiPanelHtml', 'scoreAiSelectedClip', 'scoreAiInputs',
            'scoreAiGenerate', 'scoreAiCompose', 'scoreAiSection', 'scoreAiParts', 'scoreAiReference', 'scoreAiVideo', 'scoreAiInpaint',
            'scoreAiRegenerate', 'scoreAiSeparate', 'scoreAiAudition', 'scoreAiApprove', 'scoreAiEmotion', 'scoreAiAcceptProposal',
            'scoreAiRejectProposal', 'scoreAiUsd', 'scoreAiPlanHtml', 'scoreAiSeparationPlanHtml', 'scoreAiRetryHtml', 'scoreAiJobsHtml',
            'scoreAiPoll', 'scoreAiRetry',
            // Music & Sound: the cue sheet, its notes and instruments, and generating a score
            'soundCueCard', 'openCueMidi', 'renderCueInstruments', 'playCuePart', 'uploadCueMidiPart', 'renderSoundSheet',
            'generateCueAudio', 'addSoundCue', 'deleteSoundCue', 'generateScoreFor', 'saveScoreDirection', 'generateAllMusic',
            // Edit: "Score this edit"
            'scoreThisEdit', 'openScoreSession',
        ],
        text: [
            ['html', '\n                <button class="btn btn-primary" onclick="generateAllMusic()">Generate All (score + ambient)</button>', ''],
            ['html', /\n {12}<div id="musicProgress"[\s\S]*?\n {12}<\/div>(?=\n)/, ''],
            ['html', '<h3 style="margin:0 0 2px;">Cues</h3>', '<h3 style="margin:0 0 2px;">Scenes</h3>'],
            ['html', 'What the music should be, per scene — the brief a score is generated from.', 'Each scene’s ambient bed, the music you bring in for it, and its direction.'],
            ['html', '\n                                <option value="music">Score</option>', ''],
            ['html', 'data-tooltip="Generate score, ambient, and SFX per scene"', 'data-tooltip="Sound effects and ambient beds, per scene and in the library"'],
            ['html', ', which shot plays where, and a score timed to the edit"', ', and which shot plays where"'],
            ['html', /\n {16}<strong>Score this edit<\/strong> opens a score session timed to the cut, whose stems drop onto the\n {16}Premiere sequence at 00:00\./, ''],
            ['app', "tooltip: 'Generate score, ambient beds, and sound effects per scene or shot'", "tooltip: 'Ambient beds and sound effects per scene or shot, and the music you bring in'"],
            ['app', "purpose: 'The audio half of the film. Generates original score, location ambience, and spot effects from what each scene is doing emotionally and where it takes place.'",
                "purpose: 'The audio half of the film. Generates location ambience and spot effects from what each scene is doing and where it takes place, and holds the music you bring in.'"],
            ['app', "          'Score generation driven by scene mood',\n", ''],
            ['app', "pro: 'Composer + sound design + re-recording mixer'", "pro: 'Sound design + re-recording mixer'"],
            ['app', "            'Music Cues': 'Score, sound effect, and ambient audio cues tied to specific scenes with mood, tempo, and instrumentation metadata.',\n", ''],
            // The Edit page's guide entry: no score is written against a cut any more.
            ['app', "which shot plays where, and a score timed to the edit'", "and which shot plays where'"],
            ['app', ", and a score can be written against the cut rather than the assembly.", "."],
            ['app', "'Name what the cut uses that Film Engine did not make: titles, stock, pickups',\n          'Open a score session timed to the edit, whose stems line up at 00:00 in Premiere'\n",
                "'Name what the cut uses that Film Engine did not make: titles, stock, pickups'\n"],
            ['app', "pro: 'Assistant editor + music editor'", "pro: 'Assistant editor'"],
            ['productionGraph', " * reachable by URL either way; the Score workspace stays in the menu too,\n * because the graph opens it rather than replacing it.", " * reachable by URL either way."],
            // Playback's switch plays the music each scene brings in; there is no score any more.
            ['html', 'title="Play each scene\'s score under its shots">', 'title="Play each scene\'s music under its shots">'],
            ['html', 'onchange="pbBedsToggled()"> Score\n', 'onchange="pbBedsToggled()"> Music\n'],
            ['html', 'Off, Production is its separate pages. The Score workspace stays\n                            in the menu either way, and every old page is still reachable by its address.',
                'Off, Production is its separate pages.\n                            Every old page is still reachable by its address.'],
        ],
    },
    resync: {
        why: 'Resync on the Storyboard removed by the user on 2026-11-11, with the Sync button the top bar carried (a v2 '
            + 'component): neither carried a rewritten, added or cut line onto its card, so the board kept the old words. '
            + 'The Screenplay page\'s Update storyboard (src/components/UpdateStoryboard) replaces both: it plans for free '
            + 'which cards change and how, and writes only that plan once confirmed. The Audit beside Resync stays.',
        pages: [],
        modals: [],
        names: ['previewResync', 'applyResync'],
        text: [
            // The drift strip points at the Screenplay, where the update now lives, instead of offering Resync.
            ['app', "detail: `${shots} shot${shots === 1 ? '' : 's'} \\u00b7 ${where}`,\n            actions: `\n"
                + '                <button class="btn btn-primary btn-sm" onclick="previewResync()"\n'
                + '                        title="Show exactly what a resync would change. Nothing is written until you say so.">Resync\\u2026</button>\n',
            "detail: `${shots} shot${shots === 1 ? '' : 's'} \\u00b7 ${where} \\u00b7 <a href=\"#/${esc(state.currentProject.id)}/screenplay\" style=\"color:var(--gl-brand-blue,#6690ff);\"\n"
                + '                    title="Update storyboard, on the Screenplay page, shows which cards change before it writes anything">update them from the Screenplay</a>`,\n'
                + '            actions: `\n'],
            ['app', 'Nothing is blocked. <strong>Resync</strong> reconciles what can be reconciled without a\n'
                + '                judgement \\u2014 who and what is in each frame, dialogue that still matches word for word \\u2014\n'
                + '                and shows you the plan first. It never rewrites a description and never deletes a shot.\n'
                + '                Anything needing a decision comes back as a list. The affected frames are marked below.`,',
            'Nothing is blocked. <strong>Update storyboard</strong>, on the Screenplay page, carries the new\n'
                + '                words onto these cards \\u2014 rewritten, added and cut lines, who and what is in each frame \\u2014\n'
                + '                and lists every card it will change before it writes anything. It never rewrites a description\n'
                + '                and never deletes a shot. The affected frames are marked below.`,'],
        ],
    },
    boardAudit: {
        why: 'The Audit button on the Storyboard\'s "Screenplay changed" notice removed by the user on 2026-11-11, after '
            + 'Resync went: the last action left on that warning besides why and Still matches. The report it opened '
            + '(GET /projects/:id/shot-audit, the shot_audit MCP tool) stays, and the run plan still checks it.',
        pages: [],
        modals: [],
        names: ['runShotAudit'],
        text: [
            ['app', '                <button class="btn btn-secondary btn-sm" onclick="runShotAudit()"\n'
                + '                        title="Check every card for subjects that would reach the model as neither picture nor description \\u2014 free">Audit</button>\n',
            ''],
        ],
    },
    boardImpact: {
        why: 'The "Generated work behind its inputs" notice on the Storyboard, its Still current button and the per-frame '
            + 'redo/waiting marks, removed by the user on 2026-11-11. The impact report itself stays (GET /projects/:id/impact, '
            + 'the impact_report MCP tool, and the states Production reads).',
        pages: [],
        modals: [],
        names: ['IMPACT', 'loadImpact', 'impactTag', 'impactNotice', 'acceptAllStale'],
        text: [
            ['app', '        await loadImpact();\n', ''],
            ['app', '        // One strip for both notices now \u2014 impactBanner() composes them, so the\n'
                + '        // board gets a single line rather than two stacked paragraphs.\n',
            '        // One strip: impactBanner() composes it (the screenplay notice, the generated-work one removed).\n'],
            ['app', '    /** Both notices, one strip, ordered as the work is done. */\n    function impactBanner() {\n'
                + '        return noticeStrip([screenplayDriftNotice(), impactNotice()]);\n',
            '    /** The notice strip: the screenplay notice. */\n    function impactBanner() {\n'
                + '        return noticeStrip([screenplayDriftNotice()]);\n'],
            ['app', 'return screenplayDriftTag(f) + impactTag(f) + dialogueTag(f)', 'return screenplayDriftTag(f) + dialogueTag(f)'],
        ],
    },
    classicProduction: {
        why: 'Production\'s older layout, removed by the user on 2026-11-11: the "Production graph" setting that chose between '
            + 'the Production studio and its six separate pages (Shot Board, Video Shots, Music & Sound, Playback, Pipeline, Flows), '
            + 'then the six pages themselves and everything only they used ("no traces of it if unused"). A fresh sandbox opened '
            + 'the older pages and read as an old version of the app. Production is the studio alone; the backend routes the '
            + 'studio, the graph and the MCP tools still use stay.',
        pages: [],
        // Page ids that are also ordinary words (music, playback, pipeline, flows): `pages` would cut every `music` key and
        // 'music' item in the app (the sound library's capability, the served folders). So their markup and sidebar
        // buttons are cut as screens, and the lists and maps that name them as pages by the `text` edits below.
        screens: ['shotboard', 'videoshots', 'music', 'playback', 'pipeline', 'flows'],
        modals: ['soundGenModal'],
        // Styles for classes only these pages drew (each checked against what stays): a rule naming only these goes,
        // a selector list loses just them.
        cssClasses: [
            'kanban-column',
            'btn-warning', 'fbody', 'fedge', 'flow-canvas', 'flow-canvas-wrap', 'flow-inspector', 'flow-node-btn',
            'flow-palette', 'flow-status', 'flow-toolbar', 'flow-workspace', 'fnode', 'fport', 'fportlabel', 'fsub',
            'ftitle', 'kanban-board', 'kanban-card', 'kanban-column-header', 'pb-columns', 'pb-gap', 'pb-gap-title',
            'pb-note-box', 'pb-note-item', 'pb-note-list', 'pb-note-marker', 'pb-note-markers', 'pb-note-tc',
            'pb-playhead', 'pb-playlist', 'pb-playlist-item', 'pb-scrub', 'pb-scrub-fill', 'pb-scrub-wrap', 'pb-sep',
            'pb-shot-tick', 'pb-shot-ticks', 'pb-stage', 'pb-still', 'pb-timecode', 'pb-transport', 'pb-video',
            'shot-code', 'shot-meta', 'snd-cat', 'snd-facts', 'snd-meta', 'snd-origin', 'snd-play', 'snd-tile',
            'snd-warn', 'snd-wave',
        ],
        names: [
            'saveProductionGraphFlag', 'playFromShot', 'shotDetailPanel', 'videoTierRow', 'pickVideoTier', 'VIDEO_TIER_BLURB',
            'CONFIRM_GEN_VIDEO_TIER', 'videoEstimateHtml', 'loadSequences', 'stripSequence', 'openStrip',
            'correctStation', 'approveStrip', 'previewSequence', 'generateNextSequenceLeg', 'deleteSequence', 'PG_OLD_PAGES', 'PRODUCTION_GRAPH_ON', 'FLOW', 'pgEditFlow',
            'flowBackToGraph', 'loadShotboardRuntime', 'loadShotBoard', 'dragShotId', 'onShotDragStart',
            'onShotDragEnd', 'onShotDragOver', 'onShotColumnOver', 'onShotColumnLeave', 'onShotColumnDrop',
            'onShotDrop', 'openShotDetail', 'closeShotDetail', 'loadShotDetailNotes', 'addShotDetailNote',
            'runShotPipeline', 'saveShotTransition', 'openABCompare', 'loadABCompare', 'updateABCrossfade',
            'closeABCompare', 'loadVideoShots', 'renderSequencePicker', 'toggleSequenceShot', 'SEQ',
            'generateAllVoices', 'createSequence', 'generateAllVideos', 'generateAllVideosRun',
            'askBackgroundInstruction', 'BG_INSTRUCTION', 'bgInstructionDone', 'generateVideoFor', 'lipsyncShot',
            'pickCoverageRun', 'postShot', 'replaceBackground', 'setClipCoverage', 'stitchShot', 'fmtDuration',
            'fmtSize', 'fmtAge', 'drawWaveform', 'paintWaveforms', 'SOUND_LIB', 'SOUND_FILTER', 'soundFileCard',
            'loadSoundLibrary', 'renderSoundLibrary', 'openSoundGenerator', 'soundGenPreview', 'runSoundGenerate',
            'sndPlay', 'loadMusic', 'saveAmbientDirection', 'saveSceneDelivery', 'generateAmbientFor',
            '_pbProtectBound', 'bindPlaybackProtect', 'renderPlaybackProtect', 'playbackStartIndex', 'loadPlayback',
            'renderPlaybackSummary', 'pbEntry', 'pbAbsoluteMs', 'loadShotIntoStage', 'renderPlaylist', 'renderScrub',
            'motionTransformAt', 'motionCss', 'pbMovingTrack', 'pbApplyMotion', 'pbMotionLabel', 'pbMotionToggled',
            'BED_KINDS', 'bedVolume', 'bedAt', 'pbSyncBeds', 'pbBedLabel', 'pbRegenerateDialogue', 'pbBedsToggled',
            'updatePlayhead', 'msToTc', 'pbGoTo', 'pbStep', 'pbTogglePlay', 'pbLastFrame', 'pbPlayLine',
            'pbDialogueToggled', 'pbTick', 'PB_MARK_FLOOR_S', 'pbResolveMarks', 'pbMarks', 'pbFrameRate',
            'pbFrameStep', 'pbKeydown', 'pbRunRepair', 'pbMarkIn', 'pbMarkOut', 'pbClearMarks', 'pbRenderMarks',
            'pbSeekFromClick', 'pbSyncAudio', 'pbSeekAbsolute', 'pbAddNote', 'renderNoteList', 'loadPipeline',
            'renderPipelineReadiness', 'renderPipelineSteps', 'runPipelineLive', 'runPipelineScope',
            'PIPE_STEP_ICONS', 'NODE_W', 'NODE_HEAD', 'PORT_ROW', 'PORT_R', 'nodeHeight', 'PORT_COLOR', 'portY',
            'portsCompatibleClient', 'loadFlowsPage', 'setFlowStatus', 'renderFlowPalette', 'flowCanvasOpen',
            'flowCanvasRender', 'renderFlowNode', 'portPos', 'svgPoint', 'flowCanvasStartDrag',
            'flowCanvasStartLink', 'flowCanvasEndLink', 'flowNextNodeSuggestions', 'flowNextNodeMenuHtml',
            'flowOpenNextNode', 'flowNextNodeOutside', 'flowCloseNextNode', 'flowPickNextNode',
            'flowCanvasDeleteEdge', 'flowCanvasAddNode', 'flowCanvasDeleteSelected', 'flowCanvasZoom',
            'flowCanvasFit', 'renderFlowInspector', 'flowNodeSet', 'flowNodeSetConfig', 'flowCanvasFromTemplate',
            'flowCanvasNew', 'flowCanvasDuplicate', 'flowCanvasSave', 'flowCanvasRun', 'flowPaintRun',
            'flowCanvasBackgroundDown',
        ],
        text: [
            // Always the studio.
            ['productionGraph', ' * Behind the `production_graph` setting. Off, the phase is its eight pages.\n',
                ' * Always on: the older separate pages and the setting that chose them were removed (2026-11-11).\n'],
            ['productionGraph', '    try {\n        const r = await api(\'/settings\');\n'
                + '        PRODUCTION_GRAPH_ON = !!(r && r.settings && r.settings.production_graph);\n'
                + '    } catch (_) { /* a settings read that fails leaves the classic pages, which is the safe side */ }\n', ''],
            ['productionGraph', '    const toggle = document.getElementById(\'settingsProductionGraph\');\n'
                + '    if (toggle) toggle.checked = PRODUCTION_GRAPH_ON;\n', ''],
            // A page that no longer exists (an old bookmark, a remembered route, a link left somewhere) opens Home.
            ['app', '    function navigateTo(page) {\n',
                '    function navigateTo(page) {\n'
                + '        // A page that no longer exists (an old bookmark, a remembered route) opens Home.\n'
                + '        if (!document.getElementById(\'page-\' + page)) page = \'dashboard\';\n'],
            // The router's loaders, the guide's entries, the shell's Production group and the graph's menu rule.
            ...['shotboard: loadShotBoard', 'pipeline: loadPipeline', 'flows: loadFlowsPage', 'videoshots: loadVideoShots', 'music: loadMusic']
                .map(l => ['app', `            ${l},\n`, '']),
            ['app', '            // ==== CLAUDE:START loaders (gaps 3/4/5/7d) ====\n            playback: loadPlayback,\n            // ==== CLAUDE:END ====\n', ''],
            ...['shotboard', 'videoshots', 'music', 'pipeline'].map(p => ['app', new RegExp(`\n      ${p}: \\{\n[\\s\\S]*?\n      \\},\n`), '\n']),
            ['shell', "pages:['productiongraph','shotboard','videoshots','music','musiccues','musicws','playback','pipeline','flows'] }", "pages:['productiongraph'] }"],
            ['productionGraph', '    document.querySelectorAll(\'.nav-item[data-page]\').forEach(b => {\n'
                + '        const p = b.dataset.page;\n'
                + '        const hide = (p === \'productiongraph\' && !PRODUCTION_GRAPH_ON) || (PRODUCTION_GRAPH_ON && PG_OLD_PAGES.includes(p));\n'
                + '        if (hide) b.dataset.flagHidden = \'1\'; else delete b.dataset.flagHidden;\n'
                + '    });\n', ''],
            ['productionGraph', '    const on = PRODUCTION_GRAPH_ON && state.currentProject;\n', '    const on = state.currentProject;\n'],
            // Leaving the Flows page by Back no longer has anything to reset.
            ['app', "        // Left the Flows page by Back: the way back to the graph has been used.\n"
                + "        if (typeof FLOW !== 'undefined' && state.currentPage !== 'flows') { FLOW.returnTo = null; FLOW.pushed = false; }\n", ''],
            // The graph's Edit flow buttons opened the Flows page: gone with it (Apply flow stays).
            ['productionGraph', "Cancel run</button>` : ''}${\n               it.flow_id ? `<button class=\"pg-sbtn\" onclick=\"event.stopPropagation();pgEditFlow('${esc(it.flow_id)}')\" title=\"Open this flow on the Flows canvas\">Edit flow</button>` : ''}`", "Cancel run</button>` : ''}`"],
            ['productionGraph', "</button>\n        <button class=\"pg-sbtn\" onclick=\"pgEditFlow('${esc(f.id)}')\" title=\"Open this flow on the Flows canvas\">Edit flow</button></div>`", "</button></div>`"],
            ['productionGraph', "    const edit = f.flow_id ? ` <button class=\"pg-sbtn\" onclick=\"pgEditFlow('${esc(f.flow_id)}')\" title=\"Change the flow itself on the Flows canvas instead of filling it in\">Edit flow</button>` : '';\n    return `<h3 style=\"margin-top:0;\">${esc(f.flow_name || 'Flow')}${edit}</h3>", "    return `<h3 style=\"margin-top:0;\">${esc(f.flow_name || 'Flow')}</h3>"],
            ['productionGraph', "    const edit = n.flow_id ? `<button class=\"${compact ? 'pg-sbtn' : 'btn btn-secondary btn-sm'}\" onclick=\"pgEditFlow('${esc(n.flow_id)}')\"\n        title=\"Open the flow that made this on the Flows canvas\">${compact ? 'Edit' : 'Edit flow'}</button>` : '';\n    if (!pickable && !edit) return '';", "    if (!pickable) return '';"],
            ['productionGraph', "    if (compact) return btn + edit;", "    if (compact) return btn;"],
            ['productionGraph', "Cancel run</button>` : ''}${edit}</div>`;", "Cancel run</button>` : ''}</div>`;"],
            ['productionGraph', "    const edit = f.flow && f.flow.id ? `<div class=\"pg-btnrow\"><button class=\"btn btn-secondary btn-sm\" onclick=\"pgEditFlow('${esc(f.flow.id)}')\"\n        title=\"Open this flow on the Flows canvas\">Edit flow</button></div>` : '';\n    return `<div class=\"pg-kicker\"><span>Made by a flow</span></div><div class=\"pg-list\">${rows.join('')}</div>${edit}", "    return `<div class=\"pg-kicker\"><span>Made by a flow</span></div><div class=\"pg-list\">${rows.join('')}</div>"],
            // What the six pages left running in core: the Flows canvas's pointer listeners, Playback's keys, Video Shots as
            // the default refresh of a shot action, the Shot Board's detail panel as a busy surface, Playback's protect picker.
            ['app', /\n    \/\/ Canvas-level pointer handling: pan on background drag, move on node drag\.\n[\s\S]*?if \(svg\) svg\.classList\.remove\('panning'\);\n    \}\);\n/, '\n'],
            ['app', "    window.addEventListener('keydown', pbKeydown);\n", ''],
            ['app', '            (reload || loadVideoShots)();\n', '            if (reload) reload();\n'],
            ['app', "            // The shot detail panel.\n            () => {\n                const panel = document.getElementById('shotDetailPanel');\n                return panel ? panel.querySelector('img') : null;\n            },\n", ''],
            ['app', "host.closest('.card') || host.closest('#shotDetailPanel') || host", "host.closest('.card') || host"],
            ['app', "    /** Keep both pickers offering what the job actually ships. */\n    function refreshProtectOptions() {\n        for (const id of ['boardProtectRatio', 'pbProtectRatio']) {\n",
                "    /** Keep the board's picker offering what the job actually ships. */\n    function refreshProtectOptions() {\n        for (const id of ['boardProtectRatio']) {\n"],
            // Playback's player state (`pb` is also a local name elsewhere, so it is cut here rather than retired by name).
            ['app', /\n    const pb = \{\n        timeline: null,[\s\S]*?\n        localMs: 0,\n    \};\n/, '\n'],
            // Words that sent people to the removed pages.
            ['app', "tip: 'Changed on the Shot Board after it was applied here.' }", "tip: 'Changed on the shot card after it was applied here.' }"],
            ['app', "tip: 'Changed here AND on the Shot Board since it was applied.' }", "tip: 'Changed here AND on the shot card since it was applied.' }"],
            ['app', "re-seed from the Shot Board before locking", "re-seed from the shot card before locking"],
            ['app', "                + '. It plays in Playback now.'\n", ""],
            ['app', "     * THE UPSCALE CONFIRMATION, shared by the Video Shots button and the\n     * production canvas.", "     * THE UPSCALE CONFIRMATION, for the production canvas."],
            ['app', "title=\"Generate the dialogue for this scene's shots, then hear it in Playback. Spends one generation per line; lines already spoken are reused.\"", "title=\"Generate the dialogue for this scene's shots. Spends one generation per line; lines already spoken are reused.\""],
            // The clip confirmation's priced tier row: only Video Shots opted into it (videoTiers).
            ['app', "    window.pickVideoTier = pickVideoTier;\n", ""],
            ['app', "        if (CONFIRM_GEN_VIDEO_TIER) q.set('tier', CONFIRM_GEN_VIDEO_TIER);\n", ""],
            ['app', "        const holder = document.getElementById('confirmVideoTierRow');\n        const opts = document.getElementById('confirmVideoOptions');\n        if (!CONFIRM_GEN_PREVIEW_URL || (!holder && !opts)) return;\n        if (holder) holder.innerHTML = '<div class=\"text-sm\" style=\"opacity:.6;\">Re-reading what this would cost&hellip;</div>';\n        try {\n            const d = await api(videoPreviewUrl());\n            if (holder) holder.innerHTML = videoTierRow(d);\n            if (opts) opts.innerHTML = videoOptionsHtml(d.options);\n        } catch (err) {\n            // A failed re-read must not leave a stale price under the button.\n            if (holder) holder.innerHTML = `<div class=\"text-sm\" style=\"color:var(--gl-danger,#ef4444);\">\n                Could not re-price this: ${esc(err.message)}</div>`;\n        }\n", "        const opts = document.getElementById('confirmVideoOptions');\n        if (!CONFIRM_GEN_PREVIEW_URL || !opts) return;\n        try {\n            const d = await api(videoPreviewUrl());\n            opts.innerHTML = videoOptionsHtml(d.options);\n        } catch (err) {\n            setStatus('Could not re-read this clip\\'s options: ' + err.message);\n        }\n"],
            ['app', "        CONFIRM_GEN_VIDEO_TIER = null;\n        CONFIRM_GEN_VIDEO_OPTIONS = {};\n", "        CONFIRM_GEN_VIDEO_OPTIONS = {};\n"],
            ['app', "        const pickers = await confirmPickers(o.capability || 'image', { ownTiers: !!o.videoTiers });", "        const pickers = await confirmPickers(o.capability || 'image');"],
            ['app', "          ${o.videoTiers ? `<div id=\"confirmVideoTierRow\">${videoTierRow(d)}</div>` : ''}\n", ""],
            ['app', "    async function confirmPickers(capability, how) {\n        const cap = capability || 'image';\n        // A clip dialog with its own priced tier row (\"How good does this one\n        // need to be?\") must not draw a second, unpriced one beside it.\n        const ownTiers = !!(how && how.ownTiers);\n", "    async function confirmPickers(capability) {\n        const cap = capability || 'image';\n"],
            ['app', "        const tierBox = ownTiers ? '' : tiers && tiers.length ? box('Quality for this one',", "        const tierBox = tiers && tiers.length ? box('Quality for this one',"],
            ['app', "        const sizeBox = ownTiers ? '' : sizes && sizes.length ? box('Size for this one',", "        const sizeBox = sizes && sizes.length ? box('Size for this one',"],
            // The glossary's entries for the pages, and the style sheet's heading for the Shot Board's rules.
            ['styles', "        /* ══════════════════════════════════════════════════════════\n           KANBAN (Shot Board)\n           ══════════════════════════════════════════════════════════ */\n", ""],
            ['app', "            'Shot Board': 'Kanban-style board organizing individual shots by scene. Each shot has a scene card (YAML) describing camera, lighting, characters, and style.',\n", ""],
            ['app', "            'Pipeline': 'Automated 9-step shot production: keyframe, video, voice, lipsync, music, SFX, ambient, post-production, and assembly.',\n", "            'Production': 'The studio where the storyboard becomes footage: shots directed on a timeline (camera, acting, dialogue, sound), generated, then cut in order and sent to DaVinci Resolve.',\n"],
            // A joined sequence no longer refreshes a Video Shots page.
            ['app', "            loadSequences();\n            if (typeof loadVideoShots === 'function') loadVideoShots();\n", ''],
            // The sequence list (loadSequences) was drawn into Video Shots only, with its strip, preview, next-leg and delete
            // actions: gone with it. The graph's sequence drawer keeps generating, stitching and upscaling.
            ['app', "/generate-native', {\n                        method: 'POST', body: JSON.stringify(choices || {}),\n                    });\n"
                + "                    setStatus('Done.');\n                    if (typeof loadSequences === 'function') loadSequences();\n",
            "/generate-native', {\n                        method: 'POST', body: JSON.stringify(choices || {}),\n                    });\n"
                + "                    setStatus('Done.');\n"],
            ['app', /(note: 'Each segment travels between two frames you have already approved\.',[\s\S]*?setStatus\('Done\.'\);\n)                    if \(typeof loadSequences === 'function'\) loadSequences\(\);\n/, '$1'],
            // The guide lists the studio, not the older pages, and its next steps point at live pages.
            ['app', "        'dashboard', 'screenplay', 'scenes', 'shotboard', 'storyboard',\n"
                + "        'characters', 'locations', 'props', 'assets', 'threed', 'videoshots',\n"
                + "        'music', 'musiccues', 'colorgrading', 'milestones', 'notes', 'renderhistory',\n"
                + "        'continuity', 'consistency', 'budget', 'exportpage', 'pipeline', 'settings',\n",
            "        'dashboard', 'screenplay', 'scenes', 'storyboard', 'productiongraph',\n"
                + "        'characters', 'locations', 'props', 'assets', 'threed',\n"
                + "        'colorgrading', 'milestones', 'notes', 'renderhistory',\n"
                + "        'continuity', 'consistency', 'budget', 'exportpage', 'settings',\n"],
            ['app', "next: ['screenplay', 'shotboard']", "next: ['screenplay', 'storyboard']"],
            ['app', "next: ['shotboard']", "next: ['storyboard']"],
            ['app', "next: ['videoshots', 'continuity']", "next: ['productiongraph', 'continuity']"],
            ['app', "next: ['shotboard', 'milestones']", "next: ['storyboard', 'milestones']"],
            ['app', "next: ['videoshots', 'exportpage']", "next: ['productiongraph', 'exportpage']"],
            ['app', "next: ['exportpage', 'pipeline']", "next: ['exportpage', 'productiongraph']"],
            ['app', "next: ['shotboard', 'renderhistory']", "next: ['storyboard', 'renderhistory']"],
            ['app', "next: ['storyboard', 'videoshots']", "next: ['storyboard', 'productiongraph']"],
            ['app', '\n      acts: {\n',
                '\n      productiongraph: {\n'
                + "        title: 'Production', icon: '&#9672;', group: 'Production', stage: 'produce', order: 6,\n"
                + "        tooltip: 'Direct, generate and cut the film: one studio for the whole Production phase',\n"
                + "        purpose: 'Where the storyboard becomes footage. Pick shots, direct acting, camera, dialogue, sound and light on a timeline, watch the prompt rebuild as you direct, check it against the model and generate; then cut the picked shots in order and send the timeline to DaVinci Resolve.',\n"
                + '        does: [\n'
                + "          'Generate: shots and sequences directed on a timeline with camera, acting, dialogue and sound tracks',\n"
                + "          'Cut: the rough edit, footage or not, sent to DaVinci Resolve as a timeline',\n"
                + "          'Generators: local AI tools on any video (slow motion, upscale, depth, rotoscope, stems, subtitles)'\n"
                + '        ],\n'
                + "        needs: ['Storyboard frames. Locked character identities give far better results.'],\n"
                + "        next: ['edits', 'exportpage'],\n"
                + "        pro: 'Director, DP and editor in one room',\n"
                + "        note: 'Credits are shown before anything is sent. Nothing is spent until you confirm.'\n"
                + '      },\n\n      acts: {\n'],
            // The first-open tour walks the studio where it walked the older pages.
            ['app', "      'shotboard',    // plan it\n      'storyboard',   // see it\n      'videoshots',   // shoot it\n"
                + "      'music',        // score it\n      'pipeline',     // automate it\n",
            "      'storyboard',   // see it\n      'productiongraph', // direct and shoot it\n"],
        ],
    },
};

const RETIRED_PAGES = new Set(Object.values(RETIRED).flatMap(f => f.pages));
const RETIRED_NAMES = new Set(Object.values(RETIRED).flatMap(f => f.names));
const RETIRED_MODALS = new Set(Object.values(RETIRED).flatMap(f => f.modals));
// Retired pages whose ids are ordinary words: only their markup and sidebar buttons are cut by id (retireHtml); the
// feature's `text` edits cut the lists and maps that name them as pages.
const RETIRED_SCREENS = new Set(Object.values(RETIRED).flatMap(f => f.screens || []));

/** Cut spans [start, end) out of a string, last first (spans never overlap). */
function cutSpans(text, spans) {
    for (const [s, e] of [...spans].sort((a, b) => b[0] - a[0])) text = text.slice(0, s) + text.slice(e);
    return text;
}

/** Every node of an acorn tree under `node`, depth first. */
function* nodesOf(node) {
    if (!node || typeof node.type !== 'string') return;
    yield node;
    for (const v of Object.values(node)) {
        if (Array.isArray(v)) for (const x of v) yield* nodesOf(x);
        else if (v && typeof v === 'object' && typeof v.type === 'string') yield* nodesOf(v);
    }
}

/**
 * A script without the retired: top-level declarations whose every name is retired (with the comments before them),
 * object properties keyed by a retired page, and array items that are a retired page's id.
 */
function retireScript(code) {
    const ast = parse(code);
    const spans = [];
    let prev = 0;
    const kept = [];
    for (const n of ast.body) {
        const names = n.type === 'FunctionDeclaration' ? [n.id.name]
            : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.type === 'Identifier' ? d.id.name : null) : [];
        if (names.length && names.every(x => RETIRED_NAMES.has(x))) spans.push([prev, n.end]);
        else {
            if (names.some(x => RETIRED_NAMES.has(x))) throw new Error(`retired and kept names share one declaration: ${names.join(', ')}`);
            kept.push(n);
        }
        prev = n.end;
    }
    const pageOf = (n) => n && ((n.type === 'Identifier' && n.name) || (n.type === 'Literal' && typeof n.value === 'string' && n.value));
    // An item of a list: from the end of the one before it (its comma and the gap) to its own end, or for the first,
    // from its start to the next one's start.
    const listCut = (items, i) => (i > 0 ? [items[i - 1].end, items[i].end] : [items[i].start, items[i + 1] ? items[i + 1].start : items[i].end]);
    for (const top of kept) {
        for (const n of nodesOf(top)) {
            if (n.type === 'ObjectExpression') {
                const ps = n.properties;
                ps.forEach((p, i) => { if (p.type === 'Property' && !p.computed && RETIRED_PAGES.has(pageOf(p.key))) spans.push(listCut(ps, i)); });
            } else if (n.type === 'ArrayExpression') {
                const es = n.elements;
                es.forEach((e, i) => { if (e && e.type === 'Literal' && RETIRED_PAGES.has(e.value)) spans.push(listCut(es, i)); });
            }
        }
    }
    // Two neighbours cut from one list overlap at the comma between them: merge.
    const merged = [];
    for (const s of spans.sort((a, b) => a[0] - b[0])) {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]); else merged.push([...s]);
    }
    return cutSpans(code, merged);
}

/** Where the element whose start tag begins at `at` ends (just after its end tag). */
function elementEnd(html, at) {
    const tagRe = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']+))?)*)\s*(\/?)>/g;
    const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
    tagRe.lastIndex = at;
    let depth = 0, m;
    while ((m = tagRe.exec(html))) {
        if (m[0].startsWith('<!--')) continue;
        if (m[1]) { if (--depth === 0) return tagRe.lastIndex; continue; }
        if (VOID.has(m[2].toLowerCase()) || m[4]) { if (depth === 0) return tagRe.lastIndex; continue; }
        depth++;
    }
    throw new Error('unbalanced markup from ' + at);
}

/** The markup without the retired pages, their sidebar buttons and the retired modals (with the blank line before each). */
function retireHtml(html) {
    const spans = [];
    const elementAt = (at) => [html.lastIndexOf('\n', at), elementEnd(html, at)];
    for (const p of [...RETIRED_PAGES, ...RETIRED_SCREENS]) {
        const page = html.indexOf(`<div class="page" id="page-${p}">`);
        if (page < 0) throw new Error(`retired page ${p} is not in the source`);
        spans.push(elementAt(page));
        let at = 0, buttons = 0;
        while ((at = html.indexOf(`data-page="${p}"`, at)) >= 0) { spans.push(elementAt(html.lastIndexOf('<button', at))); at += 1; buttons++; }
        if (!buttons) throw new Error(`retired page ${p} has no sidebar button in the source`);
    }
    for (const m of RETIRED_MODALS) {
        const at = html.search(new RegExp(`<div class="modal-overlay" id="${m}"`));
        if (at < 0) throw new Error(`retired modal ${m} is not in the source`);
        spans.push(elementAt(at));
    }
    return cutSpans(html, spans);
}

/** The few wording changes in what stays; each must match exactly once. */
function retireText(src) {
    for (const f of Object.values(RETIRED)) {
        for (const [part, before, after] of f.text || []) {
            const count = (text) => (typeof before === 'string' ? text.split(before).length - 1 : (text.match(new RegExp(before.source, 'g')) || []).length);
            // `styles` is the list of <style> blocks: the edit must match once across all of them.
            const n = part === 'styles' ? src.styles.reduce((k, st) => k + count(st.css), 0) : count(src[part]);
            if (n !== 1) throw new Error(`retired text in ${part} matched ${n} times (expected once): ${String(before).slice(0, 80)}`);
            if (part === 'styles') src.styles = src.styles.map(st => (count(st.css) ? { ...st, css: st.css.replace(before, after) } : st));
            else src[part] = src[part].replace(before, after);
        }
    }
    return src;
}

/**
 * A stylesheet without the rules that style only retired markup: a rule goes when EVERY selector in it names a
 * retired class; an @media block emptied that way goes too. Comments and everything else stay as they are.
 */
function retireCss(css) {
    const patterns = Object.values(RETIRED).flatMap(f => f.cssClasses || []);
    if (!patterns.length) return css;
    const retiredClass = (c) => patterns.some(p => (p instanceof RegExp ? p.test(c) : p === c));
    const onlyRetired = (selectors) => {
        const list = selectors.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map(x => x.trim()).filter(Boolean);
        return list.length > 0 && list.every(sel => [...sel.matchAll(/\.([\w-]+)/g)].some(m => retiredClass(m[1])));
    };
    // Rules of a block body [from, to): returns the text with retired rules cut, and whether anything is left.
    const block = (from, to) => {
        let out = '', at = from, i = from;
        while (i < to) {
            if (css.startsWith('/*', i)) { const e = css.indexOf('*/', i + 2); i = e < 0 ? to : e + 2; continue; }
            if (css[i] === '{') {
                // The prelude runs from the end of the previous rule (or comment) to here.
                let p = i; while (p > at && css[p - 1] !== '}' && css[p - 1] !== ';' && !(css[p - 1] === '/' && css[p - 2] === '*')) p--;
                const prelude = css.slice(p, i);
                let depth = 1, j = i + 1;
                while (j < to && depth) { if (css.startsWith('/*', j)) { const e = css.indexOf('*/', j + 2); j = e < 0 ? to : e + 2; continue; } if (css[j] === '{') depth++; else if (css[j] === '}') depth--; j++; }
                const lineStart = css.lastIndexOf('\n', p + prelude.search(/\S|$/)) + 1;
                if (/^\s*@media/.test(prelude)) {
                    const inner = block(i + 1, j - 1);
                    if (inner.empty) { out += css.slice(at, Math.max(at, lineStart - 1)); at = j; }
                    else { out += css.slice(at, i + 1) + inner.text + '}'; at = j; }
                } else if (!/^\s*@/.test(prelude) && onlyRetired(prelude)) {
                    out += css.slice(at, Math.max(at, lineStart - 1)); at = j;
                } else if (!/^\s*@/.test(prelude) && !/\/\*/.test(prelude)) {
                    // A list that names retired classes beside kept ones loses just those selectors.
                    const parts = prelude.split(',');
                    const keep = parts.filter(sel => ![...sel.matchAll(/\.([\w-]+)/g)].some(m => retiredClass(m[1])));
                    if (keep.length && keep.length < parts.length) {
                        const lead = prelude.match(/^\s*/)[0], tail = prelude.match(/\s*$/)[0];
                        out += css.slice(at, p) + lead + keep.map(x => x.trim()).join(', ') + tail; at = i;
                    }
                }
                i = j; continue;
            }
            i++;
        }
        out += css.slice(at, to);
        return { text: out, empty: !out.replace(/\/\*[\s\S]*?\*\//g, '').trim() };
    };
    return block(0, css.length).text;
}

function retire(src) {
    retireText(src);
    if (src.styles) src.styles = src.styles.map(st => ({ ...st, css: retireCss(st.css) }));
    src.html = retireHtml(src.html);
    for (const k of ['app', 'productionGraph', 'shell']) src[k] = retireScript(src[k]);
    return src;
}

module.exports = { RETIRED, REMOVED, KEPT_FOR_TESTS, replacedBy, LOAD_TIME_CALLS, cutScript, loadTimeCalls, replacedStatement, parse, readSource, loaderMap, topLevelFunctions, topLevelElements, innerOf, words };
