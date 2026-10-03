# Converting a page to React

Each page moves from generated legacy markup + chunk code to a real React component, one page per
commit, with the app working after every commit. Notes (`src/pages/notes/`) is the worked example.

## The recipe

1. **Read the legacy page.** Its markup is `src/pages/<id>/markup.html`; its code is the functions
   listed for its chunk in `docs/split-map.json` (`chunks.<chunk>.functions`), in
   `public/legacy/chunks/<chunk>.js`. Its modals are `map.pages.<id>.modals`.
2. **Write `src/pages/<id>/<Name>Page.jsx`.** Same root (`<div className="page" id="page-<id>">`),
   same ids, classes and `data-field` names, same routes, request bodies and status messages.
   - Reach the legacy core only through `legacy.<name>` from `src/lib/legacy.js`
     (`api`, `setStatus`, `state`, `esc`, `showModal`, `closeModal`, `navigateTo`). Need another
     global? Add it to `LEGACY_GLOBALS` with a one-line reason; the split keeps it in core.
   - Register the loader navigateTo calls: `usePageLoader('<loaderName>', load)`. That one line is
     what makes navigation, live refresh (another process wrote) and refresh-after-write reach the page.
   - A modal only this page opens becomes `<Modal id="<sameId>" title="…">` (`src/components/Modal.jsx`),
     opened and closed with `openModal(id)` / `closeModal(id)`: the legacy stack still orders it.
   - Render text as text (no `dangerouslySetInnerHTML`); React escapes it.
3. **Write `src/pages/<id>/react.json`**: `loader`, every legacy function (and the page's own top-level
   constants, so they do not fall into core as dead code) you `replaces`, and the
   `modals` you now render. Replace `index.jsx` with a one-line re-export of your component.
4. **`npm run split`**, then `git rm src/pages/<id>/markup.html` and the modal `.html` files you took over.
   The split FAILS if any remaining legacy code still calls what you replaced (an onclick in another
   page, a call from core). Then either leave that function legacy (do not list it) or convert the caller.
5. **Write `src/pages/<id>/<Name>Page.test.jsx`** (Vitest + Testing Library, `installLegacy()` from
   `src/test/setup.js` fakes the core): the loader's request, what each control sends, the status lines,
   the empty and error states. Break the page on purpose once and see a test fail.
6. **Verify:** `npm test` (structural + React tests), `npm run test:backend`, `npm run smoke`.

## What the checks hold you to

- `tools/tests/react-pages.test.js`: every react.json page renders `id="page-<id>"`, registers its
  loader, renders each modal it took, has no generated wrapper or stale markup, and no legacy file
  still uses what it replaced; React touches the legacy app only through `LEGACY_GLOBALS`.
- `tools/tests/parity.test.js`: everything not replaced is still in core or one chunk, exactly once.
- `tools/assemble-page.js` renders each React page to static HTML for the backend's UI tests, so a
  control the API accepts must still be on the page (`manual-edit.test.js`).
- `npm run smoke`: every page becomes active with no console error, and a React page's loader is on `window`.

## Registry checks (whole-app "a person can do this" lists)

Some backend tests iterate a registry (media imports, dialogue scopes, paid controls) and look for each
entry's control in the page source. Before skipping one, re-run it: the test page carries each React page's
source (`<template data-react-source>`, components written unnamed so a scan attributes requests to the real
handlers), so a check that reads a function by name often simply passes. Where a control must stay core's
own (an upload control, a paid confirmation), render core's builder (`legacy.mediaUploadControl(...)`,
`legacy.uploadControl(...)`) rather than re-implementing it.

A check that can only see legacy `onclick` text is held by `src/pages/registry-reach.test.jsx` instead: it
imports the backend registry and, for an entry whose control is React, renders the page from its
`src/pages/<id>/reach.js` (`fixture` = routes and project; `controls` = registry function -> button) and
CLICKS the button, which must reach the API or core. Converting a page with such a control means writing its
`reach.js`; the shared test is not edited.

## Who is converting what

Each page is converted by one person at a time; claim it in this table before starting, in its own
commit. A page whose functions are shared with another page converts together with it (or after it).

| Page | Status | Owner |
|---|---|---|
| notes, renderhistory, milestones, rights, subtitles, titles, assets | done | film-engine agent |
| brand, edits, deliverables, pipeline, exportpage, videoshots | done | film-engine-v2 agent |
| scenes, moodboard, stylebook, marketing | batch 2 | film-engine agent |
| consistency, jobsqueue | done | film-engine-v2 agent |
| projects, dashboard | batch 2 | film-engine-v2 agent |
| characters + locations + props (one chunk), shotboard, storyboard | batch 3, unclaimed: shared modals | |
| budget, settings, playback, productiongraph + flows | batch 4, one owner each | |
| screenplay, music + musicws + musiccues, threed + previs | batch 5, the big three, one owner each | |
