# film-engine-v2

Film Engine as an Electron + React app. It is a port of the one-file web app in
`../film-engine` (`src/index.html`): the same pages, the same backend, split into
components, with each page's code loaded only when that page is first opened.

## Run it

```bash
npm install
(cd backend && npm install)

npm run dev      # vite on :5173 + Electron; reuses a backend on :3100 or starts backend/server.js
npm run build    # dist/
npm start        # Electron on the built dist/
```

The backend is `backend/` (Node, SQLite, the same API and data folder as
film-engine). Electron starts it with your system `node` if nothing answers on
:3100, so `better-sqlite3` needs no Electron rebuild.

## How the app is put together

- `tools/split-map.js` generates the app from `../film-engine/src/index.html`
  (`npm run split`; `--check` reports anything stale). Generated files say so in
  their first line; change the source or the tool, not them.
- `src/` is React: `App` renders `Sidebar`, `Main` (all 37 pages, `src/pages/<id>/`),
  `StatusBar` and `ModalHost` (38 overlays) once, at boot. `LegacyElement` mounts
  each piece of markup and never re-renders it.
- `public/legacy/` is the app's own code as classic scripts: `core.js` (shared),
  `production-graph.js`, `shell.js`, and `chunks/<chunk>.js` loaded on a page's
  first visit by `src/lib/pages.js`. three.js loads only with the 3D chunk.
- `electron/` is the main process, the preload, and the smoke runner.

`docs/PORT.md` has the design, the measurements and what is still open.

## Check it

```bash
npm test         # set-based parity checks against the source file
npm run smoke    # Electron opens every page (+ cold deep links); fails on any console error
npm run parity   # every page in the original app and in this one, compared
npm run test:backend  # the backend suite, file by file
```
