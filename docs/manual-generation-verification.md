# Manual generation: combined-result verification

This verifies confer `5e3a9491` (branch `feat/manual-generation-handoff`, as built through `b84384e`, plus `8940328`) in confer `fbec7d4c`. Claude drafted it; codex reviewed.

During this verification, a peer edit in the shared checkout added `output_paths` to the cleanup trigger's list of output columns, with a test. `film_refsheet_jobs` records its outputs there, and without it a reference-sheet job that had produced output could have been deleted. It was committed as part of `8940328` and is included in the results below.

## 1. What each participant reported

- **Claude:** drove every round. All code on the branch is Claude's.
- **codex:** reviewed every round and made no edits. Its only blocker was its own tool calls stalling, which resolved: it later ran `manual-generation` and `manual-route-gate` itself, 16 pass and 0 fail. It raised these review points, and each was answered on the branch:
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

## 3. Tests (run on `8940328`)

| Command | Result |
|---|---|
| `cd backend && node --test tests/manual-generation.test.js tests/manual-route-gate.test.js` | 18 tests, 18 pass, 0 fail; "routes 31: generation 17 reached review; not manual 14"; batch reviews: music 14, voice 7 |
| `cd backend && node --test tests/*.test.js` | 5460 tests, 5151 pass, 302 fail. Against the pre-change baseline (341 fail): new failures `[]`, and 40 baseline failures now pass |
| `npx vitest run` | 2 failed, 1237 passed, 1 skipped. Both failures (`App.boot`, `PilotPanel`) also fail on `main` |
| `node --test tools/tests/*.test.js` | 239 pass, 0 fail |
| `npm run smoke` | 49/52 pages clean, 0 console errors. The same 3 failures (screenplay editor, switch project, subject sheets) occur on `main` |

### Streamed reviews, end to end

The backend side: the music batch stream announces a review for every scene (14 for the demo's 7 scenes; `manual-route-gate.test.js`). The frontend side: `ManualGeneration.test.jsx` sends 14 distinct ids through the stream observer, each repeated across two typed events. Each review is fetched once and shown in order through the queued dialog with its own prompt, and each Close cancels that id exactly once. The caller keeps reading its own stream (`request-bridge.js` returns stream paths untouched to `streamSSEPost`).

## 4. Blockers never resolved

None from the participants. Known items outside this task:

- **Demo project data:** `card.dialogue` is stored as a string where an array is expected, so voice batch finds no dialogue and creating a music session fails on the demo. `PUT /shots/:id` can't edit demo cards. The route fixtures work around both.
- **CORS:** it defaults to accepting every origin. This is pre-existing and documented with the `CORS_ALLOWED_ORIGINS` fix.
- **Paid jobs:** collecting a job paid before this change still contacts that vendor. It is documented as an exception.
- **Test race:** `mcp-staleness.test.js` and `mcp-no-server-llm.test.js` can collide when the suite runs in parallel. Pre-existing.

## Verdict

**It fits.** Every contract above agrees on both sides, each is crossed by a test, and the full suites show no new failures against the baseline.
