# Film Engine → React/Electron port: progress

Source: `../film-engine` (frontend = one 51,611-line `src/index.html`, 37 `page-*` views; backend = Node API on :3100 + SQLite).

## Approach (agreed with the film-engine agent, Milestone 1)
- **Shell:** Electron + Vite 5 + React 18, plain JS/JSX (no TS).
- **Backend:** `backend/` copied as-is (not a submodule) into this repo, same API on :3100, same DB at `~/.gridlight/film-engine/data`. Electron main spawns it; renderer talks HTTP. `backend/mcp-server.js` unchanged, so Claude Desktop keeps working. better-sqlite3 must be rebuilt for Electron's Node (electron-rebuild) if spawned via utilityProcess.
- **Split:** `src/pages/<Page>/index.jsx` via `React.lazy` + `<page>.js` (copied functions as an ES module) + its own CSS. Shared code in `src/lib/` (api, esc, state, setStatus, showModal, confirm*, uploadControl, frameSrc/plateSrc, router) and `src/components/` (TopBar, PhasePanel, StatusBar, ModalHost). Inline `onclick="fn()"` kept working via a `registerHandlers` helper that puts a page's handlers on `window` on mount. three.js/GLTF/Spark load only in Previs/3D pages.
- **Routes:** hash routes `#/<projectId>/<page>` unchanged (links + iOS app keep working).
- **All new code lives in this repo.** `../film-engine` is read-only source: nothing is added or changed there. The split map is generated here by `tools/split-map.js` (reads `../film-engine/src/index.html`) into `docs/split-map.json`. The film-engine agent is the read-only source expert: each round it sends, by message, which functions, modals and CSS rules belong to which page, which are shared, and the gotchas (onclick-string handlers, globals like state/API_BASE, the modal stack, live SSE refresh, page-route hash). It reviews commits here against the source and never edits either repo.
- **Done test (set-based):** iterate the 37 page ids from the split map: each has a route, a lazy component, every mapped function in its module or `src/lib`, every modal mounted; plus an Electron smoke run loading each page with no console error.
- **Known follow-up:** ~200 backend tests read `src/index.html`; in the copied backend they need retargeting or skipping (to settle in R1).

## The set: 37 pages
assets, brand, budget, characters, consistency, dashboard, deliverables, edits, exportpage, flows, jobsqueue, locations, marketing, milestones, moodboard, music, musiccues, musicws, notes, pipeline, playback, previs, productiongraph, projects, props, renderhistory, rights, scenes, screenplay, settings, shotboard, storyboard, stylebook, subtitles, threed, titles, videoshots

## Rounds (agreed: 12 + 16 + 9 = 37)
1. Scaffold + Write & Design: projects, dashboard, screenplay, scenes, moodboard, characters, locations, props, notes, stylebook, settings, brand.
2. Plan + Production: shotboard, storyboard, previs, deliverables, consistency, milestones, budget, productiongraph, flows, videoshots, music, musicws, musiccues, threed, pipeline, jobsqueue.
3. Post + finish: assets, playback, renderhistory, edits, exportpage, rights, titles, subtitles, marketing + parity test green.

Drafting first: this repo (split map + scaffold). Peer answers from the source and reviews each round.

## How it is built (round 1, as implemented)
- `tools/split-map.js` reads `../film-engine/src/index.html` and writes every generated file (`npm run split`). Never hand-edit generated files; edit the source or the tool. `--check` fails if anything is stale.
- **Markup, all mounted at boot** (other pages read ids out of each other's markup): `src/pages/<id>/markup.html` + `index.jsx` (37), `src/components/{Sidebar,StatusBar,Main}`, `src/components/modals/*.html` (38 overlays) via `ModalHost`. `LegacyElement` creates each element once and never re-renders it; attributes (incl. inline `onclick` strings) are set on the DOM, not owned by React.
- **Code**: `public/legacy/core.js` (shared core, source order), `production-graph.js`, `shell.js` (fe-redesign chrome), loaded as deferred classic scripts in source order (`index.html` is generated from `tools/index.template.html`). `public/legacy/chunks/<chunk>.js` = code only that chunk's pages reach; injected once on first visit by `window.__fePages.ensure(page)` (`src/lib/pages.js`), after the vendored libraries the chunk needs (`vendor/three.min.js` + `gltf-loader.js` for `stage3d`). `navigateTo` is patched to await it before running the page loader.
- **Chunks** are pages or groups of pages that share code (`groups` in `tools/port-plan.json`): subjects = characters+locations+props, stage3d = previs+threed, music = music+musicws+musiccues, graph = productiongraph+flows.
- **Reachability**: graph nodes = top-level functions, classes, and const/let/var whose initialisers run nothing (functions, literals, `Object.freeze({...})`, empty `new Map()`), plus modals. Edges = identifiers in the code with comments stripped (strings/templates count, so `onclick="fn()"` does); `typeof x` and guarded `window.x` (`if (window.x)`, `window.x &&`) are not uses. Roots = a chunk's pages' loaders + markup. Reached only by one chunk → that chunk; anything else (core, 2+ chunks, unported pages) → core. Wiring statements (`window.f = f`, `window.f = function…` callbacks, `Object.assign(window, {...})`, window/document `addEventListener`) travel with the one chunk their non-core targets belong to; a listener nothing else reaches goes to the one chunk everything downstream of it belongs to, else core. Debug: `SPLIT_DEBUG=1`, `SPLIT_WHY=<reach>`, `SPLIT_PATH=<node>` on `node tools/split-map.js`.
- **Electron**: `electron/main.cjs` reuses a backend already on :3100 or spawns `node backend/server.js` (system node, no electron-rebuild); `preload.cjs` sets `__filmEngineApiBase` under file://. `npm run dev` (vite + electron), `npm run build`, `npm start`, `npm run smoke`.
- **Backend**: `backend/` copied verbatim from film-engine HEAD (tracked files). 209 tests that read `src/index.html` (directly or via `console-render.js`/`css-cascade.js`) removed; listed in `backend/tests/REMOVED-HTML-TESTS.txt`. `src/vendor/splat-viewer.js` + `src/assets/` copied because server.js serves them from `../src`.

## Status
- [x] Milestone 1 (Frame): approach agreed (2026-10-02). Agreement sent to peer and Frame signalled done in NeonCore.
- [x] Round 1 (2026-10-02): scaffold + split tool + all 37 pages' markup as components; the 12 R1 pages have their own script chunks.
  - Chunk sizes (KB): screenplay 108, settings 50, stylebook 15, dashboard 9, brand 7, moodboard 5, notes 5, scenes 3. projects, characters, locations, props: 0 (every function they use is also reached from core or another page; they move as later rounds port their sharers).
  - Core is still 1,576 KB: the 25 unported pages' code is in it until R2/R3.
  - Verify: `npm test` (8 set-based parity checks) green; `npm run smoke` → 38/38 (37 pages + cold deep link) with 0 console errors.
- [x] Round 2 (2026-10-03): the 16 Plan + Production pages chunked; chunk groups; comment-blind, guard-aware reachability; movable pure declarations and wiring; three.js + GLTFLoader (~700 KB) no longer at boot, loaded with `stage3d`.
  - Core 1,576 KB (R1) → 897 KB. Chunks (KB): stage3d 288, music 178, screenplay 135, budget 66, settings 53, graph 27, consistency 25, shotboard 23, stylebook 15, deliverables 13, pipeline 12, dashboard 11, notes 5, moodboard 5, videoshots 5, milestones 4, scenes 3, subjects 2, storyboard 2, brand 7; projects, jobsqueue 0.
  - Verify: `npm test` 10/10 set-based; `npm run smoke` 38/38 clean; `npm run parity` → 37/37 pages render the same element count and text length as the original one-file app against the same backend (with a 4 s settle; at 1.2 s music/stylebook were still loading in one of the two runs).
- [ ] Round 3: assets playback renderhistory edits exportpage rights titles subtitles marketing; final doc.

## Open / deferred
- Backend test suite in the copy: 60 test files read film-engine repo-root files (docs/, todos/, ios/, README…) that were not copied; the full suite takes hours (ffmpeg tests run minutes each). A partial run (stopped after several hours) counted 1,944 passing and 349 failing test cases. Not yet triaged: decide in R3 whether to copy the docs those tests assert on or remove them like the html tests, then run the API/lib tests in a shorter configuration.
- Per-page CSS split: CSS is still the source's two sheets (`src/styles/base.css`, `redesign.css`), 182 KB.
- Packaging (electron-builder, asarUnpack ffmpeg-static, bundling node for the backend): not started.
- Idiomatic React rewrites of page internals: out of scope for the port, page by page later.
