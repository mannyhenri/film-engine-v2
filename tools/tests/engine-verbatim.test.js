// A page engine module (Playback's player.js, the Production graph's engine.js, the Screenplay's engine.js)
// MOVED its legacy code: every declaration it exports is the reference source's declaration of the same name,
// character for character, except for the one mechanical rewrite a module needs to reach core VARIABLES
// (another script's `let` cannot be assigned or read live from a module):
//
//     X            ->  legacy.X               (a read of core variable X)
//     X = value;   ->  setLegacy('X', value); (an assignment to it)
//
// Undo exactly those two and the text must be identical. That is what lets the backend tests that read these
// functions' source keep testing the code that runs, and it is why an engine is reviewed by this test rather
// than by eye. Set-based over every engine module and every name it exports; a hand edit fails here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const acorn = require('acorn');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const { readSource } = require('../split-lib');

const ROOT = path.join(__dirname, '..', '..');

/*
 * Declarations changed ON PURPOSE after the move, by name, each with its reason. An entry that no longer
 * differs from the reference fails, so the list cannot outlive the change it records.
 */
const CHANGED = {
    "src/components/VideoPipeline/engine.js": {
        "generateNativeMultiShot": "Runway removed (2026-10-24): the recipe is the local gateway's"
    },
    "src/pages/screenplay/engine.js": {
        "onEditorKeydown": "Preserve the live writer-focus shortcut and Escape exit before typewriter input",
        "toggleAIChat": "the existing AI Chat button and keyboard shortcut open Ask AI (the project AI workspace was removed as its duplicate, 2026-10-24); the legacy panel remains the fallback",
        "renderIndexCards": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "openIndexCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "saveIndexCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "onCardDrop": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "jumpToSceneFromCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "deleteIndexCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "addIndexCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "createIndexCard": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "loadScriptVersion": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor",
        "loadLatestFountain": "Authorized independent scene summaries and notes; screenplay changes stay in the Editor"
    },
    "src/components/SubjectSheet/engine.js": {
        "exportSubjectSheet": "printed location and prop sheets redesigned (2026-10-25): built from the sheet's data through the shared print renderer (src/lib/print-sheet.js) instead of copying the on-screen form"
    },
    "src/components/CharacterSheet/engine.js": {
        "renderCharacterSheet": "authorized expression slots: load captured character/slot data and reject late or superseded sheet reads",
        "characterSheetHtml": "authorized six face expression slots and non-destructive description/appearance consolidation; body plates remain present",
        "generateOfficialViews": "authorized manual ChatGPT handoff: stop the body-view loop on a saved external handoff and retain its captured character identity",
        "generateCharacterImage": "authorized manual ChatGPT handoff: a pending external image is reported as a handoff rather than an already generated image",
        "exportCharacterSheet": "the director's sheet: the main picture on top, its variations below, then the description (MainSheet), printed through the shared print renderer (src/lib/print-sheet.js, redesigned 2026-10-25)"
    },
    "src/pages/storyboard/engine.js": {
        "generateAllStoryboards": "user-approved exact final review: POST streaming sends the complete ordered approval list only after every batch item has been reviewed",
        "renderAnnotationFeedbackToggle": "user-approved annotation references: the switch controls optional prompt text while visible reference marks remain included"
    },
    "src/components/PageHelpers/engine.js": {
        "streamSSE": "user-approved exact final review: unreviewable paid GET streams fail closed before constructing EventSource"
    },
    "src/pages/previs/engine.js": {
        "worldLightShow": "approved local lighting changes schedule one renderer frame instead of rendering repeatedly",
        "worldSetViewMode": "approved lazy collider preparation commits only the latest requested view",
        "worldMeshCanvas": "approved set loading changes raster dimensions only when the container size changes",
        "worldMeshRenderOnce": "approved frozen capture synchronously renders and cancels the queued frame",
        "worldWalkRepaint": "approved walkthrough marks camera movement before deferred source replies and schedules rendering",
        "worldScoutMakeShot": "approved location-first creation uses the frozen current-view dialog and its recovery flow",
        "stageKeyHere": "approved timeline edits schedule one renderer frame",
        "stageDeleteKey": "approved timeline edits schedule one renderer frame",
        "stageClearPath": "approved timeline edits schedule one renderer frame",
        "worldSeekTo": "approved timeline navigation schedules one renderer frame",
        "worldPaintFrame": "approved navigation does not reset an unchanged canvas raster size",
        "worldLoadForShot": "approved source loading releases outgoing geometry and rejects stale source replies",
        "loadPrevisPage": "approved location-first workflow opens sets before selecting a destination",
        "PV_TABS": "approved Shot brief inspector replaces Direct",
        "worldWalkStep": "Reuse structural support and wall sliding inside a location workspace.",
        "worldBoardSrc": "Contextual Current shot reads the selected target frame without replacing local blocking.",
        "SPLAT": "Version-keyed in-flight source information cannot return a previous set.",
        "worldSplatInfo": "Guard deferred source requests against location/version switches.",
        "worldSplatSync": "Guard renderer preparation against location/view switches.",
        "MESHLOOK": "Loaded native mesh tracks immutable source version identity.",
        "worldMeshSync": "Only install the current source version; use exact raster aspect for native matching.",
        "MESH_MODE_NOTES": "Location-first browser capture guidance.",
        "setEditRebuild": "Editing a location must not pin or mutate its contextual destination shot.",
        "worldRailHtml": "Both supported console layouts browse location sets.",
        "worldNudge": "Location workspace evaluates and applies cameras locally without canonical shot writes.",
        "worldExploreBrief": "Location workspace evaluates and applies cameras locally without canonical shot writes.",
        "worldExploreAccept": "Location workspace evaluates and applies cameras locally without canonical shot writes.",
        "worldExploreCompare": "Location workspace evaluates and applies cameras locally without canonical shot writes.",
        "worldExploreLoad": "Location workspace evaluates and applies cameras locally without canonical shot writes.",
        "worldConsoleV2Html": "approved location heading, contextual target, frozen draft/render delivery and brief",
        "worldScoutSelect": "load authoritative set source audit and room viewpoints",
        "worldSyncPanelShots": "approved primary rail lists 3D sets and real room viewpoints",
        "worldModeButtonsHtml": "approved Current shot and 3D view labels",
        "stageFollow": "Follow the local staged subject path without rewriting the contextual destination shot.",
        "stageSyncLook": "Hash the actual loaded GLB bytes so cached previews cannot adopt regenerated assets silently.",
        "stageSave": "location staging remains local until a draft is approved",
        "worldWalkKeep": "location camera remains local until capture",
        "worldTimelineSave": "local location timeline snapshot without rewriting destination",
        "worldLightSet": "use the existing lighting vocabulary to preview local location lighting",
        "worldWalkBarHtml": "location walkthrough sends through the chosen real target",
        "worldSplatModule": "the splat viewer's import('./vendor/splat-viewer.js') resolved against the document in a classic script; in a module it would resolve against the module (and Vite rewrites it at build), so it is built from document.baseURI and marked @vite-ignore: the same URL, at run time"
    },
    "src/pages/productiongraph/engine.js": {
        "PG_PORT_COLOR": "adds distinct depth and alpha colors for typed processing lineage",
        "pgDrawerVersion": "user-requested resolution badge: measure the opened clip display pixels and show exact dimensions without trusting generation settings",
        "loadProductionGraph": "project-switch fix (3ee8beb): the in-flight load is keyed by project, so a switch never waits on the previous film",
        "pgLoad": "project-switch fix (3ee8beb): a switch resets every per-project field of PG, the queue, picks and palette included",
        "pgPollRunning": "approved Production refresh preserves captured editing ownership and rereads immutable origins",
        "pgBounds": "approved arrangement: include measured empty sound footprints in canvas bounds",
        "pgMinimap": "approved arrangement: show the complete sound footprint in the workspace overview",
        "pgGroupHtml": "approved freely movable and resizable scene groups contain vertical narrative rows",
        "pgPort": "approved immutable origins have diagnostic ports without permitting live provenance rewrites",
        "pgNodeHtml": "renders typed depth/matte/composite input and immutable version cards with their named ports",
        "pgRender": "user-requested overlap correction: measure actual node border boxes and reflow scene geometry on content/media changes",
        "pgHeader": "user-requested vertical scene correction: expose reversible workspace arrangement with current-project ownership",
        "pgTidy": "user-requested overlap correction: retain lineage projection and project ownership after workspace tidy",
        "pgToggleCollapse": "user-requested overlap correction: force fresh scene geometry and reject stale collapse responses",
        "pgInitCanvas": "approved scene movement/resizing persists geometry independently of narrative order",
        "pgCanWire": "accepts exact typed processing inputs while refusing depth as a subject alpha input",
        "pgWire": "opens processing controls with a pending typed input; revisions still require explicit review and save",
        "pgBusy": "approved captured-context busy guards prevent duplicate or stale Production dispatch",
        "pgRunNode": "approved Production generation uses its captured target and final request review",
        "pgRenderDrawer": "opens typed processing controls for node and version inspection",
        "pgDrawerShot": "approved shot inspector exposes immutable version lineage and draft recipe actions",
        "pgLoadShotDetails": "approved source-bound inspector loads reject superseded project/node responses",
        "pgRefreshVideoPreview": "approved captured video draft preserves source ownership while preparing the final review",
        "pgGenerateVideo": "approved video dispatch uses the visible frozen recipe and one final human review",
        "pgDrawerSequence": "approved sequence inspector keeps immutable membership and draft recipe actions visible",
        "pgGenerateSequence": "approved sequence dispatch preserves native per-shot JSON, ordered source ownership and final review",
        "pgRecipeHtml": "approved origins separate recorded exact prompt and transport from missing legacy provenance",
        "pgMakeAnotherPlan": "approved reruns derive a new draft from immutable captured origin bytes and settings",
        "pgLoadHowMade": "approved version selection reads immutable origins without inventing historical provenance",
        "pgMakeAnother": "approved reruns open an editable new recipe while preserving the original version",
        "pgTiles": "approved timeline uses selected media and a five-second image fallback with explicit missing selections",
        "pgRenderPlayback": "approved playback shows independent source sounds and availability",
        "pgPlayCurrent": "approved playback follows selected video or the exact five-second image fallback",
        "pgSyncAudio": "approved playback applies explicit full-source offsets, trims, gain and mute independently of conditioning",
        "PG_KIND": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): a sound node is an effect or room tone; the music kind is gone",
        "PG_ADD_CUE_TYPES": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): the palette adds effect and room-tone cues only",
        "pgRunPending": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): pending sounds confirm under their own kind's capability, not music's",
        "pgDrawerSound": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): no Mood/Genre for a music kind, no link to the Score workspace",
        "pgGenerateSound": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): an unknown kind falls back to an effect, not to music",
        "pgEnsureSide": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): the palette has no Music node",
        "pgDuplicate": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): a duplicated sound carries no mood or genre (sound cues have none)",
        "pgDropTarget": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): a file dropped on a sound uploads under its own kind, not as music"
    },
    "src/components/MediaInput/engine.js": {
        "uploadLimitFor": "music-making retired by the user (2026-10-14, tools/split-lib.js RETIRED): no score session takes a batch of stems, so `stems` is not a file-carrying path (mirrors backend/lib/body-limit.js)"
    },
};
// New exported helpers are declared separately; a reference declaration is never waived here.
const ADDED = {
    "src/pages/screenplay/engine.js": {
        "printIndexCards": "Authorized independent scene-card print/PDF layout, four readable slots per page"
    },
    "src/pages/productiongraph/engine.js": {
        "pgOpenDepth": "dispatches the typed depth workbench request to its React owner",
        "pgContext": "user-approved Production: capture project/node/source ownership for asynchronous Production work",
        "pgContextLive": "user-approved Production: reject stale captured ownership after switches or remounts",
        "pgDispose": "user-approved Production: retire outstanding UI ownership when Production unmounts",
        "pgFocusWorkspace": "approved arrangement: enter and refocus a readable shot work area independently of global Fit",
        "pgWorkspacesHtml": "approved arrangement: render measured shot guides and ordered workflow columns",
        "pgSyncGeometry": "approved arrangement: move every visual occurrence and guide with scene and child gestures",
        "pgMeasureLayout": "user-requested overlap correction: reflow measured border boxes without persisting automatic coordinates",
        "pgArrange": "user-requested vertical scene correction: arrange workspace geometry with conflict-checked Undo and stale-context guards",
        "pgReadOrigins": "user-approved Production: read immutable asset origins with bounded parallelism and honest missing states",
        "pgOriginNodeHtml": "user-approved Production: draw immutable request/reference/output origin nodes",
        "pgLineageHtml": "user-approved Production: draw ordered left references and right resulting footage for each selected version",
        "pgDrawerOrigin": "user-approved Production: inspect recorded request and actual transport without changing the origin",
        "pgOpenDraft": "user-approved Production: open a source-bound new draft or independent timeline sound editor",
        "pgRenderDraft": "user-approved Production: render editable prompt, model, settings and ordered source references",
        "pgDraftKind": "user-approved Production: choose a supported new draft capability",
        "pgDraftField": "user-approved Production: edit only the current draft field",
        "pgDraftSettings": "user-approved Production: validate explicit draft settings before save",
        "pgDraftRefRole": "user-approved Production: edit an attached draft reference role",
        "pgDraftRef": "user-approved Production: swap, reorder or detach a draft reference without touching historic origins",
        "pgSaveDraft": "user-approved Production: save a captured draft through revision conflict guards",
        "pgGenerateDraft": "user-approved Production: review and dispatch a saved recipe once to its captured target",
        "pgPickReference": "user-approved Production: show the draft reference attachment picker",
        "pgPickReferenceAsset": "user-approved Production: attach a chosen same-project original asset to the draft",
        "pgAudioTracksHtml": "user-approved Production: show independent source audio edits and unresolved placement",
        "pgSaveAudioTracks": "user-approved Production: save explicit independent source audio placement and edit ranges",
        "pgEditAudioTrack": "user-approved Production: edit a source sound range, gain, mute or order",
        "pgRemoveAudioTrack": "user-approved Production: detach a timeline sound while preserving its original media",
        "pgSoundChoice": "user-approved Production: retain the explicitly chosen source sound identity",
        "pgAttachChosenSound": "user-approved Production: attach a full original source sound with explicit timeline edits",
        "pgExportResolve": "user-approved Production: prepare the existing Resolve package and show availability",
        "pgWriteResolvePackage": "user-approved Production: write the reviewed Resolve package without claiming a Resolve import",
        "pgOpenComposite": "dispatches the typed matte/composite workbench request to its React owner"
    },
    "src/pages/previs/engine.js": {
        "worldEnsureGeometry": "approved bounds-first navigation fetches the dense collider only for explicit geometry views",
        "worldMeshRelease": "approved renderer resource ownership aborts outgoing downloads and disposes prior set/prop resources",
        "worldMeshRequestRender": "approved renderer scheduling coalesces repeated navigation updates into one animation frame"
    }
};
// Pages and React components (src/components/<Name>/react.json) alike: an engine is an engine wherever it lives.
const ownModules = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter(id => fs.existsSync(path.join(ROOT, dir, id, 'react.json')))
    .flatMap(id => fs.readdirSync(path.join(ROOT, dir, id))
        // A *.markup.js module holds markup as a string (a verbatim modal frame), not code.
        .filter(f => f.endsWith('.js') && !f.includes('.test.') && f !== 'reach.js' && f !== 'index.js' && !f.endsWith('.markup.js'))
        .map(f => `${dir}/${id}/${f}`));
const ENGINES = [...ownModules('src/pages'), ...ownModules('src/components')]
    .filter(f => /^export \{/m.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

// Every top-level declaration of the reference's scripts, by name -> its source text.
const REFERENCE = (() => {
    const src = readSource(path.join(ROOT, 'reference/fb8c770/src/index.html'));
    const out = new Map();
    for (const code of [src.app, src.productionGraph]) {
        const ast = acorn.parse(code, { ecmaVersion: 'latest' });
        for (const n of ast.body) {
            const names = n.type === 'FunctionDeclaration' ? [n.id.name]
                : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : [];
            for (const name of names) out.set(name, code.slice(n.start, n.end));
        }
    }
    return out;
})();

/** The declaration's text with the two bridge rewrites undone. */
function undoRewrites(text) {
    const ast = parse(text, { sourceType: 'module' });
    const edits = [];
    traverse(ast, {
        CallExpression(p) {
            const { callee, arguments: a } = p.node;
            if (callee.type === 'Identifier' && callee.name === 'setLegacy' && a.length === 2 && a[0].type === 'StringLiteral') {
                edits.push([p.node.start, a[1].start, `${a[0].value} = `], [a[1].end, p.node.end, '']);
            }
        },
        MemberExpression(p) {
            const { object, property, computed } = p.node;
            if (!computed && object.type === 'Identifier' && object.name === 'legacy' && !p.scope.hasBinding('legacy', true)) {
                edits.push([p.node.start, p.node.end, property.name]);
            }
        },
    });
    let out = text;
    for (const [s, e, r] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + r + out.slice(e);
    return out;
}

test('there are engines to check, and the reference was read (this runs over something)', () => {
    assert.ok(ENGINES.includes('src/pages/screenplay/engine.js') && ENGINES.includes('src/pages/productiongraph/engine.js'), ENGINES.join(', '));
    assert.ok(REFERENCE.size > 1000, `only ${REFERENCE.size} reference declarations`);
});

for (const file of ENGINES) {
    test(`${file}: every declaration it exports is the reference's, verbatim but for the bridge rewrites`, () => {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        const ast = acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
        const exported = new Set(ast.body.filter(n => n.type === 'ExportNamedDeclaration' && !n.declaration)
            .flatMap(n => n.specifiers.map(s => s.local.name)));
        assert.ok(exported.size > 0, 'exports nothing');
        const seen = new Set();
        const bad = [];
        for (const n of ast.body) {
            const names = n.type === 'FunctionDeclaration' ? [n.id.name]
                : n.type === 'VariableDeclaration' ? n.declarations.map(d => d.id.name) : [];
            const mine = names.filter(x => exported.has(x));
            if (!mine.length) continue;
            for (const x of mine) seen.add(x);
            const ref = REFERENCE.get(mine[0]);
            if (ref === undefined) {
                if (!(ADDED[file] || {})[mine[0]]) bad.push(`${mine[0]}: not a top-level declaration of the reference`);
                continue;
            }
            if ((ADDED[file] || {})[mine[0]]) bad.push(`${mine[0]}: declared new but exists in the reference`);
            const same = undoRewrites(code.slice(n.start, n.end)) === ref;
            const declared = (CHANGED[file] || {})[mine[0]];
            if (!same && !declared) bad.push(`${mine[0]}: differs from the reference`);
            if (same && declared) bad.push(`${mine[0]}: declared changed but is the reference's (stale entry)`);
        }
        for (const name of Object.keys(CHANGED[file] || {})) if (!seen.has(name)) bad.push(`${name}: declared changed and not exported`);
        for (const name of Object.keys(ADDED[file] || {})) if (!seen.has(name)) bad.push(`${name}: declared new and not exported`);
        const unseen = [...exported].filter(x => !seen.has(x));
        assert.deepStrictEqual(unseen, [], 'exported names with no top-level declaration in the module');
        assert.deepStrictEqual(bad, [], `${file}: hand-edited declarations`);
    });
}
