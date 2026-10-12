# Manual generation: combined-result verification

This verifies confer `5e3a9491` (branch `feat/manual-generation-handoff`, as built through `b84384e`, plus `8940328`) in confer `fbec7d4c`. Claude drafted it; codex reviewed.

During this verification, an edit of **unverified origin** added `output_paths` to the cleanup trigger's list of output columns, with a test. codex confirms it made no file edits in either confer, and Claude did not make this edit. The files were written in this checkout at 10:09–10:10, about four minutes before `8940328`. The likely writer is another session working in the same folder (one started about 15 minutes earlier), but that is unconfirmed. `film_refsheet_jobs` records its outputs there, and without it a reference-sheet job that had produced output could have been deleted. It was committed as part of `8940328` and is included in the results below.

## 1. What each participant reported

- **Claude:** drove every round and wrote all the branch's code except one unassigned change (below).
- **codex:** reviewed every round and made no file edits in either confer (confirmed by codex). Its only blocker was its own tool calls stalling, which resolved: it later ran `manual-generation` and `manual-route-gate` itself, 16 pass and 0 fail. It raised these review points, and each was answered on the branch:
  - route coverage;
  - character explore (subject-gallery);
  - the scope of the cleanup trigger;
  - batch completeness;
  - streamed progress;
  - original files and tags;
  - Gridlight;
  - closing the direct path to anything else.

## 2. Shared contracts, both sides

Both participants worked in one repo, so the shared contracts are the frontend↔backend boundaries the diff touched, plus one backend-internal family (i) that codex added.

| # | Contract | Producer | Consumer | Agree? | Crossed by |
|---|---|---|---|---|---|
| a | Error `code: FINAL_REQUEST_REVIEW_UNSUPPORTED` | `backend/lib/final-request-plans.js` throws it; `backend/routes/final-request-review.js` returns `{error, code}` | `src/components/FinalRequestReview/request-bridge.js` `reviewApi` copies `data.code`; `prepareFinalRequest` branches on it | yes | `ManualBridge.test.jsx` (68 paths) |
| b | Review marker `FINAL_REQUEST_REVIEW_REQUIRED:<id>`, or `review.id` / `review_id` on a 428 | `backend/lib/final-request-review.js` `authorizeWithStore` | `request-bridge.js` `routeReview`; `FinalRequestReview.jsx` stream observer; `backend/lib/manual-generation.js` `isReviewStop` | yes | `manual-route-gate.test.js`; `ManualBridge.test.jsx` (string and structured) |
| c | `GET /final-request-review/:id/references/:order/original` | `backend/routes/final-request-review.js` (`parts[3]==='references' && parts[5]==='original'`) → `originalReference` | `FinalRequestReview.jsx` `downloadOriginal` | yes | `manual-route-gate.test.js` downloads every path-only asset (200, byte length matches) |
| d | Snapshot reference: `order`, `role`, `tag`, `mime`, `data` or `path` + `byte_length`, `source_path`, `source_transform`, `sha256` | `backend/lib/final-provider-request.js` | `FinalRequestReview.jsx` asset list, brief, download names | yes | `ManualGeneration.test.jsx` (19 provider/capability cases); `manual-generation.test.js` (clip by path) |
| e | Provider catalog `manual` and `manual_capabilities` | `backend/routes/providers.js` | `src/pages/settings/ProviderCards.jsx` (`keyTiles`, `CapabilityMap`, stored-key list) | yes | `ManualProviders.test.jsx` (registry-based) |
| f | Budget estimate entries carry `manual: true` | `backend/routes/budget.js` `markManual` | `src/pages/budget/FilmEstimateTab.jsx` ("your web app" badge) | yes | `manual-generation.test.js` (every registry capability) |
| g | Bridge returns `{__manual_handoff}` for passthrough; dialog returns `{__manual_nav: 'next' / 'previous'}` | `request-bridge.js`; `FinalRequestReview.jsx` | `public/legacy/core.js` `api()` and `streamSSEPost` (generated, unchanged); `request-bridge.js` `walkReviews` | yes | `ManualBridge.test.jsx` (passthrough not replayed; batches 1–4) |
| h | Env and settings: `FILM_DATA_DIR`, `CORS_ALLOWED_ORIGINS`, `FILM_ENGINE_PUBLIC_URL`, `gridlight_enabled` | `backend/lib/data-paths.js` and `db/database.js`; `server.js`; `lib/frame-handles.js`; `routes/app-settings.js` | `final-request-review.js` `mediaRoots` (data root); `docs/manual-generation.md`; `lib/video-edit.js` (no public link for manual vendors); `lib/providers/index.js` `localGatewayEnabled` | yes | route and Gridlight end-to-end tests |
| i | Backend internals: cleanup install and the direct path for kept providers | `backend/db/schema.js` `ensureSchema` → `lib/manual-generation.js` `installReviewStopCleanup` (every job table; output columns incl. `output_paths`; manual-vendor reviews only); `lib/final-request-review.js` `authorizeWithStore` returns `{bypass}` only for a registered, non-manual provider with no review builder | `lib/providers/index.js` wrapper, sync (`approval.bypass === true` → own payload) and stream (`approval.bypass !== true` guards `finalRequest`); `lib/image-fallback.js` (`authorization.bypass` → adapter); `routes/threed.js` passes `finalRequest: undefined`, re-authorized by the wrapper; `worlds.js` and `storyboard-upscale.js` only use manual vendors, so never a bypass | yes | `manual-generation.test.js`: trigger over every registry capability, `output_paths` cases, kept direct path, bypass closed to unregistered ids and manual vendors; Gridlight end-to-end in `manual-route-gate.test.js` |

## 3. Tests

Every result below was run on **`5fd2b9e`** (the head when the suites ran; later commits change only this report and tests named in the revise round). The baseline is **`main` @ `8ab7121`**, before any of this work.

| Command | Result on `5fd2b9e` | Baseline `8ab7121` |
|---|---|---|
| `cd backend && node --test tests/manual-generation.test.js tests/manual-route-gate.test.js` | 18 tests: 18 pass, 0 fail. "routes 31: generation 17 reached review; not manual 14"; batch reviews: music 14, voice 7 | (files did not exist) |
| `cd backend && node --test tests/*.test.js` | 5460 tests = 5151 pass + 302 fail + 7 skipped (0 cancelled, 0 todo). New failures against the baseline: none. 40 baseline failures now pass | 5567 tests = 5219 pass + 341 fail + 7 skipped |
| `npx vitest run` | 1240 tests = 1237 pass + 2 fail + 1 skipped. The 2 (`App.boot`, `PilotPanel`) also fail on `main` | same 2 fail |
| `node --test tools/tests/*.test.js` | 240 tests: 239 pass, 0 fail (1 skipped) | 0 fail |
| `npm run smoke` | 49/52 pages clean, 0 console errors. 3 FAIL: screenplay editor, switch project, subject sheets | the same 3 FAIL on `main` |

The backend suite shrank from 5567 to 5460 tests because 122 tests that only proved sending to manual vendors were retired (and new tests were added).

Independent run by codex (its own tools): `npx vitest run src/components/FinalRequestReview/ManualBridge.test.jsx src/components/FinalRequestReview/ManualGeneration.test.jsx src/components/FinalRequestReview/FinalRequestReview.test.jsx src/pages/settings/ManualProviders.test.jsx` → 4 files, 182 tests pass (77 + 24 + 60 + 21). Earlier: the two backend manual-generation files → 16 pass, 0 fail.

### Streamed reviews, end to end

The backend side: the music batch stream announces a review for every scene (14 for the demo's 7 scenes; `manual-route-gate.test.js`). The frontend side: `ManualGeneration.test.jsx` sends 14 distinct ids through the stream observer, each repeated across two typed events. Each review is fetched once and shown in order through the queued dialog with its own prompt. Its assets offer Download original, which fetches `/film/final-request-review/<that id>/references/1/original` from the configured backend base, and each Close cancels that id exactly once.

The download base is `window.__feFinalReviewBase()`, which the app's `api()` sets on every call. `http://localhost:3100/film` is only the fallback when it is unset, the same rule as `reviewApi`. The caller keeps reading its own stream (`request-bridge.js` returns stream paths untouched to `streamSSEPost`).

### Revise-round hardening (from the critique)

- **One marker reader (C4):** `src/components/FinalRequestReview/review-marker.js` `reviewIdsIn()` reads the marker string anywhere and a structured `review.id` / `review_id`. Both the bridge (`request-bridge.js`) and the stream observer (`FinalRequestReview.jsx`) use it. `ReviewMarker.test.jsx` pins every format and fails if either file grows its own pattern. The backend keeps its own `isReviewStop` for batch routes.
- **Generated-code guard (C5):** `LegacyBridgeContract.test.jsx` reads `public/legacy/core.js`. It fails if `api()` or `streamSSEPost` stops returning the `__manual_handoff` passthrough before fetching. Without that, a route already completed through the fallback would be posted twice.
- **CORS (C6):** if `CORS_ALLOWED_ORIGINS` is set, it must include the renderer's origin (`http://localhost:5173` in dev). Otherwise every API call fails, Download original included.
- **Typed stream events (C7):** the observer only reads typed stream events (`data.type` is a string), so job listings carrying old markers open nothing. Events from today's streaming routes are typed. With `reviewIdsIn`, it now also reads a structured id inside such an event.

### Live check in a real browser (C1)

The check ran in isolation, so nothing touched the user's Electron window or data:
- a throwaway backend on port 3297 with a temporary data folder;
- the Vite dev server on port 5297;
- a fake local Gridlight on port 3891;
- headless Chromium (Playwright), driving the app's own `api()`.

**A. Manual vendor: character expression on muapi.**
- The real dialog opened: "Prompt and assets for muapi", the full prompt, settings to match, and 1 asset (`@identity`). There is no Send or Approve button.
- **Copy prompt** put exactly that prompt on the clipboard.
- **Download original** saved `01-identity.png`, 852 bytes, byte-identical to the imported plate.
- **Close** settled the caller with `FINAL_REQUEST_CANCELLED` ("Closed: the prompt was prepared and nothing was sent"). The dialog closed, and the review is `cancelled` on the server.
- Screenshot: `docs/manual-generation-handover.png`.

**B. Kept Gridlight: sound through `api()`.**
- The generation completed with a saved asset and no dialog.
- It hit the fake gateway exactly once, so the planner-less fallback did not post the route twice.
- No page errors were logged.

## 4. Blockers never resolved

- **Product or code blockers:** none. Every point a participant raised has a commit and a test.
- **Process (open):** codex's own tool calls are still delayed, so its independent reads of the latest audit commits are pending. Its last independent run was 16/0 on the manual-generation tests. This does not block the code, but the audit is not yet independently confirmed for its final commit.

Known items outside this task:

- **Demo project data:** `card.dialogue` is stored as a string where an array is expected, so voice batch finds no dialogue and creating a music session fails on the demo. `PUT /shots/:id` can't edit demo cards. The route fixtures work around both.
- **CORS:** it defaults to accepting every origin. This is pre-existing and documented with the `CORS_ALLOWED_ORIGINS` fix.
- **Paid jobs:** collecting a job paid before this change still contacts that vendor. It is documented as an exception.
- **Test race:** `mcp-staleness.test.js` and `mcp-no-server-llm.test.js` can collide when the suite runs in parallel. Pre-existing.

## Verdict

**It fits, by tests and by a live headless run.** Every contract above agrees on both sides, each is crossed by a test, and the full suites show no new failures against the baseline.
