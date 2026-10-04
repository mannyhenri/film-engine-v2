# Plan for load-time core (d): DRAFT, for review by both agents

The numbers come from `node tools/load-time.js` and `docs/core-ownership.md` (section (d)), at 9e83a42 plus the report
update. Load-time core is **202** declarations: **66 run at load** and **136 are only reachable** from load-time code.

## How the app starts today

`index.html` loads `src/main.jsx` (a module) and then `legacy/core.js`, `legacy/production-graph.js` and `legacy/shell.js`
(all deferred). Deferred scripts run in document order, so:

1. **React renders first.** `flushSync(root.render(<App/>))` draws every page and modal frame and registers the page
   loaders. This is why core can call `loadProjects()` at load: React has already filled the placeholder `var`.
2. **core.js runs its top-level statements.** There are 38 of them, in six kinds:

| kind | statements | what they need |
|---|---|---|
| A. settings and storage | `feStore`, `DEFAULT_API_BASE = defaultApiBase(location)`, `API_BASE`, the `PROJECT_LIST` restore | ready before the first `api()` call |
| B. document listeners | click busy-marking, focusout/click flush-after-write, focus and visibility refresh, two keydown (Escape for onboarding, frame viewer), fullscreenchange, modal backdrop click, hashchange, DOMContentLoaded (typewriter, conversion estimate) | bound once, for the life of the app |
| C. `window.X = X` | `state`, `renderTitlePageCard`, `plateCameraDone`, three `shotCardStyle*`, `setGenOption`, `pickVideoTier`, `setVideoOption`, four angle-sheet functions | callers that name them in drawn HTML or across scripts |
| D. start-up calls | `initProductionGuide`, `initCollapsibleCards`, `initCollapsibleNav`, `checkHealth`, `loadProjects().then(applyRoute / writeRoute)`, `liveConnect` | run once, in this order, after the frames exist |
| E. a wrapped function | `showModal = function (id) { _origShowModal(id); … glossary … }` | must wrap before anything opens the glossary |
| F. data | `PV_MODES`, `PROMPT_PART_LABEL` (initialisers that call `Object.freeze`) | none: they are data |

3. **production-graph.js** binds one DOMContentLoaded listener (`applyProductionFlag`). **shell.js** runs one IIFE (the
   nav).

## What "runs at load" means for the move

The 66 are not stuck in a classic script for good. They have to **exist and be callable when the start-up runs**, and
today that start-up is core's top level. Once the start-up itself lives in a module, they can live in modules too.
The order constraint stays the same: frames first, then the start-up.

## Proposed phases

**Phase 1: the 136 reachable, by entry.** Each entry in the (d) table is reached through one door: a listener, a
`window.X =` exposure, a promise, a timer or a name in drawn HTML. An entry with a single React owner moves to that owner
with what it pulls in ("also reached through it"), and the owner provides it. Its door stays in core until phase 2:
the listener keeps calling it by name. Measurement: re-run `core-ownership` with the door counted as a by-name caller,
which turns these from (d) into (a2). Largest groups first:
- `frameViewerStep` (34, the frame viewer and markup), `exploreAngles` (25, the angle sheet and the generation
  confirmation), `pickVideoTier` (9), `openProductionGuide` (7, now mostly CoreDialogs).
- An entry with several owners joins (b), the shared door, and waits.

**Phase 2: the start-up as a module.** `src/lib/boot.js`, called by `App` after the first render (`useLayoutEffect`
in App, once):
- **A** becomes `src/lib/api.js`: `feStore`, `defaultApiBase`, `API_BASE`, `api`, and the busy and refresh-after-write
  machinery it drives. Most of the 66 belong here.
- **B** becomes one listener module, each handler unchanged and bound with an unbind for tests.
- **C** disappears: each `window.X` becomes a `provides` on its owner (phase 1) or stays an exposure in `boot.js` if its
  owner is still core.
- **D** runs in the same order inside `boot()`.
- **E** folds into the modal stack (`showModal` and `restackModals` are in the 66) as a glossary hook, not a wrap.
- **F** moves with its readers.

**Phase 3: shell.js and production-graph.js.** The nav IIFE becomes the nav component's mount, and the DOMContentLoaded
listener becomes an effect.

**End state.** core.js holds only what (c) keeps for film-engine's tests (decided 2026-10-04) and anything the
measurement still says is shared.

## Open questions for the two of us

1. **The backend tests read core's source by name.** Do any of the 66 have backend tests that search
   `public/legacy/core.js` or the assembled page specifically? `tools/assemble-page.js` builds the page the tests read.
   It must keep finding each moved declaration, as it already does for engines.
2. **Splitting the 66.** I'd split them by job: api and storage, modal stack, collapsible cards and nav, the
   production guide, and the shot card's directing panels. Before cutting, should `tools/load-time.js` report which
   start-up statement pulls each one in?
3. **Who takes what.** I can take phase 2 A and B (api, listeners). You'd take phase 1 for the dialog-heavy entries
   (frame viewer, angle sheet, production guide), since CoreDialogs is yours.
