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
- **Backend**: `backend/` copied verbatim from film-engine HEAD (tracked files). Tests set aside, listed with reasons in `backend/tests/REMOVED-TESTS.txt` (they stay in film-engine): 209 that read `src/index.html` (directly or via `console-render.js`/`css-cascade.js`), `approved-score` (reads it through `lib/music-approval.js`), and 51 that assert on film-engine's own repo files (docs/plans, epics, briefs, `ios/`, `CLAUDE.md`, `gridlight.json`, `scripts/`). `ffmpeg-stdin.test.js` lost the three exemptions that named removed tests. Nothing in the backend reads `src/index.html` at runtime. `src/vendor/splat-viewer.js` + `src/assets/` copied because server.js serves them from `../src`.

## Status
- [x] Milestone 1 (Frame): approach agreed (2026-10-02). Agreement sent to peer and Frame signalled done in NeonCore.
- [x] Round 1 (2026-10-02): scaffold + split tool + all 37 pages' markup as components; the 12 R1 pages have their own script chunks.
  - Chunk sizes (KB): screenplay 108, settings 50, stylebook 15, dashboard 9, brand 7, moodboard 5, notes 5, scenes 3. projects, characters, locations, props: 0 (every function they use is also reached from core or another page; they move as later rounds port their sharers).
  - Core is still 1,576 KB: the 25 unported pages' code is in it until R2/R3.
  - Verify: `npm test` (8 set-based parity checks) green; `npm run smoke` → 38/38 (37 pages + cold deep link) with 0 console errors.
- [x] Round 2 (2026-10-03): the 16 Plan + Production pages chunked; chunk groups; comment-blind, guard-aware reachability; movable pure declarations and wiring; three.js + GLTFLoader (~700 KB) no longer at boot, loaded with `stage3d`.
  - Core 1,576 KB (R1) → 897 KB. Chunks (KB): stage3d 288, music 178, screenplay 135, budget 66, settings 53, graph 27, consistency 25, shotboard 23, stylebook 15, deliverables 13, pipeline 12, dashboard 11, notes 5, moodboard 5, videoshots 5, milestones 4, scenes 3, subjects 2, storyboard 2, brand 7; projects, jobsqueue 0.
  - Verify: `npm test` 10/10 set-based; `npm run smoke` 38/38 clean; `npm run parity` → 37/37 pages render the same element count and text length as the original one-file app against the same backend (with a 4 s settle; at 1.2 s music/stylebook were still loading in one of the two runs).
- [x] Round 3 (2026-10-03): the 9 Post pages chunked (assets, playback, renderhistory, edits, exportpage, rights, titles, subtitles, marketing). All 37 pages now load their code on first visit.
  - Core 1,576 KB (R1) → 897 KB (R2) → 792 KB. Chunks (KB): stage3d 288 (+ three.js/GLTF, ~700 KB, on demand), music 178, screenplay 135, budget 66, settings 53, playback 46, graph 27, consistency 25, shotboard 23, stylebook 15, deliverables 13, pipeline 12, titles 12, dashboard 11, rights 10, edits 10, subtitles 9, brand 7, exportpage 6, marketing 6, moodboard 5, notes 5, videoshots 5, assets 4, milestones 4, scenes 3, renderhistory 3, subjects 2, storyboard 2; projects and jobsqueue need nothing of their own.
  - Boot now: React bundle 360 KB (React + all markup) + CSS 180 KB + core 792 KB + production-graph 215 KB + shell 15 KB. The original loaded ~2.8 MB of script (three.js 608 KB, GLTFLoader 103 KB, app 1.8 MB, graph 215 KB) before the first paint.
  - Smoke now also cold-starts `#/<project>/previs` (three.js must load before the stage3d chunk).
  - R2 review by the film-engine agent: the deferred `worldSyncPanelShots` call and the Previs listeners/native callbacks registering on first visit are safe (Previs-only state; iOS callbacks only fire after UI in their own chunk starts the flow; the iOS app bundles film-engine's page, not this one).
  - Verify: `npm test` 10/10; `npm run smoke` 39/39 clean; `npm run parity` 37/37 pages identical to the original.

## Where to pick up next
1. Shared clusters still in core: ~294 KB used by dashboard/screenplay/moodboard/subjects/shotboard/storyboard/marketing and ~172 KB by dashboard/shotboard/storyboard (`SPLIT_DEBUG=1 node tools/split-map.js`). A "shared chunk" loaded as a dependency of those chunks would take them off boot.
2. Per-page CSS (still the two source sheets, 180 KB built).
3. Packaging: electron-builder, `asarUnpack` for ffmpeg-static, a bundled node for the backend (or utilityProcess + electron-rebuild), and Claude Desktop's MCP config pointing at `backend/mcp-server.js` of whichever copy is live.
4. Idiomatic React for page internals, page by page; the split map and parity run are the safety net.
5. Keeping in sync with film-engine: re-run `npm run split` after changes to its `src/index.html`; `npm test` fails if the generated files are stale.

## Open / deferred (after round 3)
- Done in R3 — backend suite: `npm run test:backend` → 232/232 test files pass (2026-10-03, one file per process, 3 in parallel). Under heavier parallelism (6+) a few network/ffmpeg tests time out or reset; they pass when run alone, and passed on a scratch copy of film-engine HEAD.
- Per-page CSS split: CSS is still the source's two sheets (`src/styles/base.css`, `redesign.css`), 182 KB.
- Packaging (electron-builder, asarUnpack ffmpeg-static, bundling node for the backend): not started.
- Idiomatic React rewrites of page internals: out of scope for the port, page by page later.
