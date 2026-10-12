# Final editable request review coverage

This document distinguishes verified frozen submissions from generation deliberately blocked until an exact review is available. It does not claim deterministic model output.

## Legacy gateway boundaries

`backend/lib/gridlight-client.js` rejects every legacy `callGridlight` and `relayGridlightSSE` generation call with HTTP-style status 428 and `FINAL_REQUEST_REVIEW_REQUIRED` before queue acquisition or fetch. This includes image, video, music, voice, lipsync, postprocess and the 3D generate/from-image/batch/rig/retexture/animate families. Passing an arbitrary `finalRequest` option cannot bypass the guard. Read-only `checkEndpointHealth` still performs HEAD without a generation body.

`backend/lib/gridlight-video.js` independently rejects `generateVideo`, `generateProduction` and `postAndStream` with the same code before capability discovery or POST. The legacy runner previously selected models, snapped sizes, dropped references and retried POST requests; none of that is an approved frozen submission. Its read-only capability discovery and result download helpers remain available.

`backend/tests/final-request-paths.test.js` verifies these boundaries with mocked fetch. Four tests pass: all twelve legacy gateway endpoint families cause zero fetch calls, SSE reports refusal without opening a connection, health uses HEAD, and the separate single-video/production/raw-POST runner causes zero fetch calls. No provider job is created by these tests.

## Other entrypoints and supported providers

Music sessions resolve providers through `backend/lib/music-generation.js` and the provider registry; their protection depends on the registry's final-review boundary. Sequence, batch, flow and orchestration paths likewise require per-submission authorization at the registry. A preview of only the first batch item is insufficient.

The storyboard legacy direct image POST in `backend/routes/storyboard.js` has its own refusal guard before fetch. Existing image downloads are read-only and should remain available. Supported frozen adapter resolution and exact serialized outbound payload tests are owned by the final-provider-request implementation; the gateway tests above do not establish matching outbound payloads for those adapters.

The release report must list supported adapters and actual transport matching tests separately from blocked adapters and entrypoints. A blocked paid path is safe against an unreviewed send but is not a completed editable-review workflow. No live backend or Electron process was restarted for this change.

## Subject plates and character sheets

`backend/lib/final-subject-request-plans.js` now prepares canonical location/prop plate generation and refinement, older one-off subject image generation, every character reference-sheet view, static location compass sweeps, and character orbit video. It shares the actual execution builders extracted from `routes/locations.js`, `routes/characters.js` and `lib/reference-plates.js`. Registry preview mode resolves pinned models, chosen options and video audio policy before the final adapter review. No job or provider submission occurs during planning.

Every character view and compass side receives its own review. Compass requests all use the same already-existing anchor plate; they do not depend on a preceding result. Automatic moderation retries that removed style words or images have been removed from character and shared plate generation. A refused payload cannot silently become a different paid request.

`backend/tests/final-subject-plans.test.js` has five passing integration tests using actual route handlers, the real durable approval store and mocked provider fetch. The tests compare serialized outgoing endpoint/body against each approved snapshot for two character views, both older subject image routes, canonical location/prop generate and refine, and character orbit video. Refinement additionally checks uploaded reference bytes and their SHA-256. The compass test proves all sides are planned and separately approved, and a first provider refusal stops without later paid submissions or fallback. It verifies the first compass request's transport; successful persistence and delivery of every compass side is not exercised by this transport test.

## Implemented review and transport evidence

The React final request modal prepares the actual route before any generation submission. It shows the adapter-resolved endpoint/model, complete native prompt, native body/options, ordered reference roles and SHA-256, and quote/expiry. Editing requires a fresh resolve before Send. References use frozen bytes, including annotation composites. Single and mixed-provider batches approve every item; server preflight checks the whole set before route execution.

Durable reviews bind the original route payload separately from editable provider payloads. They bind semantic project/shot/flow settings, selected source bytes, adapter/schema/endpoint routing versions, and pricing state. Operational progress, canvas positions and unrelated sibling completions do not stale a review. Submitted tokens cannot create duplicate jobs. Unknown acceptance is retained for reconciliation and is not retried automatically.

Actual mocked native transport tests cover OpenAI image JSON/multipart, Google image, MuAPI image, Runway image/video/multi-shot, Seedance video/post, Higgsfield image/video, Meshy initial image/3D and separately reviewed refinement, World Labs, Magnific, ElevenLabs audio multipart and MuAPI Topaz image upscale. They inspect final serialized endpoint/body and upload bytes. Unsupported nested fields/options, reference roles/counts, endpoint drift and credential-bearing URLs are rejected before fetch.

Actual HTTP dispatcher tests cover edited storyboard Refine, three-item storyboard/video batches, cancellation of the last item before any upload, mixed-provider batches, dependent flow stages, edited fan-out branches and chained inbetween stages. Newly generated references require another review after their bytes exist; resuming uses the saved run and does not repeat completed generation. These tests use temporary databases and mocked fetch, not live providers.

Legacy Gridlight generation and legacy streaming language/audio/Meshy paths deliberately fail closed. They are not completed editable-review workflows. Native Topaz video finishing has a separate free-create/provider-quote/paid-accept contract; it remains blocked. Automatic approval review rejected implementing its paid acceptance/upload stage because the recorded authorization covers image upscaling; no rejected source edits executed. Explicit native Topaz video authorization and staged transport tests are required before enabling it. MuAPI storyboard image upscale is a different supported path.

Validation evidence is copied into `/Users/mannyhenri/Documents/Codex/2026-10-04/task/storyboard-refinements/final-request-review`. The running Electron app/backend were not restarted, and no paid generation, real provider submission, commit or push was performed.

## Additional completed native workflows

Pipeline shot, scene and project runs now review every ready item before submission. Dependent stages pause with durable next-review state and resume the same run after reviewing the newly saved reference bytes. Pause and cancellation stop later submissions. Seven actual HTTP pipeline tests verify these transitions.

Single native Meshy text/from-image requests and World Labs generation have route planners. Three transport tests verify their approved native bodies. World-version semantic changes require a new review; operational status changes do not.

Existing repair and bridge workflows freeze locally extracted reference frames, bind both original clips and cached frame bytes, and recheck source hashes after extraction. Existing Seedance/Magnific post-upscale paths bind the selected asset row, its bytes and the current default selection. Eight actual transport tests cover repair, bridge, upscale, changed selection and cancellation. No new provider capability was introduced.

Real stored replacement reviews allow full-prompt and native-body edits while protecting inherited metadata. Actual HTTP Send tests verify the edited full prompt and 2K option reach the mocked native transport unchanged.

## Remaining review workflow coverage

These paths remain unavailable for an editable approved submission:

| Path | Reason |
|---|---|
| Marketing generation and subject exploration | Automatic approval review rejected integration outside the recorded storyboard/upscale authorization; proposed edits did not execute. |
| Storyboard 4 Angles | Requested button removed; legacy backend generation remains blocked. |
| Runway Aleph background editing | Automatic approval review rejected frozen-video hosting as external egress outside the recorded approval; proposed provider changes did not execute. |
| Native Meshy 3D batch | Automatic approval review rejected multiple paid submissions outside the recorded approval; single native requests are supported. |
| Native Topaz video finishing | Separate provider quote/paid acceptance/upload contract is outside image-upscale approval; automatic approval review rejected enabling it. |
| Legacy Gridlight generation/streaming, unsupported post operations and unplanned voice/casting/music entrypoints | Guarded against unreviewed paid submission; native adapter transport coverage alone does not establish a complete route review workflow. |

Local stitching, encoding and color matching do not submit paid provider requests. The shared legacy GET SSE wrapper rejects generation before opening EventSource. Raw Gridlight LLM streaming rejects before fetch, including forged approval flags.

This is verified coverage of the listed workflows, not universal application coverage. No live backend/Electron restart, real provider submission, paid generation, commit or push occurred. A Blender render test previously crashed in the local native binary and remains unverified.
