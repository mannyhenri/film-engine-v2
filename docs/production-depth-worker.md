# Film Depth Map worker contract

The node integration is implemented. The verified Gridlight VDA Small MPS worker is available for reviewed local use; the live Film backend is not enabled or relaunched by this change. Production defaults to “Depth backend unavailable.” The deterministic adapter in `backend/tests/fixtures/depth-fixture-worker.cjs` is test-only and never substitutes for inferred depth.

## Configuration after approval

An operator must supply an audited executable and pinned model weights, then configure the Film backend launcher with `FILM_DEPTH_ENABLED=1`, an absolute `FILM_DEPTH_WORKER` path and `FILM_DEPTH_MODEL_SHA256`. These are administrator settings, not browser-supplied paths. Restarting Film is a separate activation action; this implementation does not restart a shared service automatically.

The executable supports `--describe` and `--run`. It must verify its actual weights against the pinned checksum, require no network upload or paid request, and provide temporal video inference. Film verifies its descriptor and executable checksum; descriptor claims do not independently prove model quality or enforce an OS network sandbox. Audit and benchmark a real worker before activation.

`--describe` prints one JSON object with these required fields:

```json
{
  "contract": "film-depth-worker-v1",
  "operation": "temporal_video_depth",
  "provider": "approved-local-provider",
  "model": "approved-temporal-model",
  "revision": "pinned-code-and-model-revision",
  "license": "verified-license",
  "model_sha256": "64-hex-digit-checksum-of-actual-weights",
  "temporal_consistency": true,
  "source_timestamps": true,
  "network_uploads": false,
  "paid": false,
  "raw_format": "f32le",
  "fixture": false,
  "max_width": 1920,
  "max_height": 1080,
  "max_frames": 120
}
```

The numerical limits above are examples, not claims for a particular model. Unsupported requests are refused before inference. Optional descriptor `model_input_size_min` and `model_input_size_max` bounds are validated and checked during plan review and dispatch. A changed executable, backend fingerprint, source or node revision invalidates the reviewed plan.

`--run` receives one JSON request line on stdin. Fields include project/node/revision identity, request/source fingerprints and source SHA/version; an owned immutable local `source_path`; requested width/height; original rational FPS and time base; the selected half-open frame range, every source PTS and duration tick; mode and settings; and `output_dir`. The worker must decode and use those exact selected source frames, preserve correspondence, and resample depth to requested dimensions if its internal resolution differs. Model input size is recorded in settings. No source file mutation is permitted.

The worker writes `raw.f32` into `output_dir`: finite little-endian float32, frame-major, row-major, one value per pixel. It prints newline-delimited JSON progress `{ "type":"progress", "progress":0.5, "phase":"Estimating depth" }`, then exactly one result with `type:"result"`, exact `request_fingerprint` and `source_fingerprint`, `raw_file:"raw.f32"`, `depth_kind` (`relative_depth`, `relative_inverse_depth` or `metric_depth`), and the exact requested `timing` object with output width/height. It exits successfully after closing the raw file. Errors use a bounded `{ "type":"error", "message":"..." }` event and nonzero exit. Stdout is capped at 1 MiB; stderr is not returned to the browser. Cancellation sends TERM to the owned child and KILL after three seconds if needed, waits for exit, and publishes no version. Workers must not detach children or leave unmanaged subprocesses running.

## Published data and limits

Film validates source identity before dispatch and publication, exact frame count/dimensions/relative timestamps/final duration, rational worker FPS, byte count and finite values. A successful version contains raw floats, one globally normalized display MP4 and a JSON timing/provenance manifest, with hashes and source/model/settings identities. Existing source and versions remain intact. Project-bound GET file routes support bounded video byte ranges; URLs never expose arbitrary filesystem paths.

Preview is at most two seconds, 120 frames and 640 pixels on the longest edge, explicitly `preview_only`. Full output preserves the saved range and source dimensions or refuses the request. Input inspection currently allows up to 100,000 frames; display timestamp expressions support at most 128 consecutive duration segments. Highly irregular VFR ranges beyond that are refused before inference. Temporary disk and worker limits are checked. Even dimensions use browser-compatible H.264 4:2:0; odd dimensions use 4:4:4 without silent padding, whose playback support can differ by browser. Authoritative floats retain all requested pixels.

Typed graph: `VideoAsset → Depth Map → DepthSequence → DepthPreview`. Raw/display outputs cannot feed ordinary image/video generation ports or masquerade as source footage. A source-video connection opens reviewed input editing; it does not silently rebind or dispatch. Depth is not an alpha matte. No hair extraction, segmentation, background replacement or paid hybrid reference route is enabled.

## Verification and next backend

The synthetic tests cover fractional FPS, portrait data, selected ranges, VFR timing, final-frame duration, grayscale patterns that can fool image format probes, publication guards, cancellation, invalid outputs, project ownership, real HTTP download hashes and range requests. They establish integration and timing, not inferred depth accuracy, temporal model quality, hair boundaries or blur handling.

MuAPI's documented `POST /api/v1/depth-anything` accepts image/video URLs and returns grayscale depth. Its public schema does not establish temporal consistency, raw float output or exact timestamp correspondence; it is listed as `contract_insufficient`, with no production adapter or paid dispatch. Film's existing MuAPI Seedance builder rejects reference videos. Do not add an unsupported depth-plus-original edge.

The separately owned Gridlight installation has an isolated pinned Video Depth Anything Small environment and a synthetic CPU benchmark. Small has an Apache 2.0 model license. That earlier CPU benchmark used an Intel Xeon W-3265M with 96 GiB RAM and a runtime reporting no MPS or CUDA; it is historical evidence, superseded for current GPU execution by the v3 section below. Its four-frame synthetic 160×96 benchmark at model input 128 measured 5.45 seconds wall time, 1.56 seconds inference and about 1.18 GiB peak RSS. This measures small CPU inference, not production latency or real footage quality. Upstream's Small FP16 6.8 GB VRAM number is an A100 benchmark for 32 frames at 518×518, not a universal minimum. The experimental streaming path has a stated quality tradeoff and is not silently substituted.

Fal is an unimplemented alternative requiring a separately approved adapter, credential setup, source upload and paid execution. Its documented list price is $0.04 per input second (about $0.08 for two seconds, $2.40 for a minute, before any billing rounding). Exact source alignment still needs verification. No charge was incurred.

Sources checked 2026-10-11: [MuAPI API reference](https://muapi.ai/docs/api-reference), [public OpenAPI](https://api.muapi.ai/openapi.json), [public model catalog](https://api.muapi.ai/api/v1/models), [VDA official repository](https://github.com/DepthAnything/Video-Depth-Anything), [Fal API](https://fal.ai/models/fal-ai/depth-anything-video/api), [Fal price](https://fal.ai/models/fal-ai/depth-anything-video).


## Prepared Gridlight configuration (2026-10-11)

`docs/depth-worker.gridlight.env.example` supplies the exact executable path and model checksum for this machine. It is a reviewable template and is not automatically loaded. The app still requires the pending owner-approved Film relaunch before activation. Removing the three variables restores the default unavailable state. No Gridlight files, dependencies, shared services or production projects were changed by this integration.

The verified descriptor uses `film-depth-worker-v1`, `temporal_video_depth`, `f32le`, relative inverse depth, CPU FP32, Apache 2.0, no paid dispatch or uploads, and pinned code/weights. Current Gridlight v2 limits: 1800 selected frames and 60 seconds; output edges at most 1920, at most 2,073,600 pixels/frame and 512 MiB raw; source at most 8192 on an edge and 16,777,216 pixels/frame; model input 128–518 with at most 300,000 actual model-grid pixels. Preview remains at most 2 seconds, 120 frames and 640 pixels on the longest edge. Film retains its exact selected PTS/durations and full requested output dimensions. A node outside the audited model input range is now refused during review before dispatch.

The opt-in `backend/tests/production-depth-real-worker.test.js` creates only six synthetic frames in a disposable Film database, selects four, uses model input 128 and validates real raw float depth, global display MP4, exact source timing, manifest hashes, graph lineage and unchanged source. It deletes its files after completion and never loads the live database. Default test runs skip actual model inference. To run explicitly with the prepared three variables, add `FILM_DEPTH_REAL_WORKER_SMOKE=1` and run `node --test backend/tests/production-depth-real-worker.test.js` using Film's installed Node version. Optionally set `FILM_DEPTH_SMOKE_EVIDENCE` to a writable JSON evidence path.

No real footage, longer clip, full-resolution quality, hair/blur accuracy, GPU acceleration or model-response quality claim follows from this synthetic smoke check. Depth remains a relative depth signal, not an alpha matte.


## Recorded source rotation and bounded-worker update

The Gridlight v2 executable still uses Film's v1 transport, model pin and encoded-coordinate raw depths. Source inspection now records and validates canonical 0/90/180/−90 display rotation from FFprobe's display matrix. Mirrored/scaled/arbitrary/changing transforms fail explicitly. Source dimensions and selected PTS/durations stay encoded and exact; the rotation becomes part of the reviewed source/request fingerprints. Existing source revisions and plans require fresh explicit review after this update; no saved input is silently rewritten.

Film validates the worker's orientation against the immutable source, records encoded/display geometry in the manifest, and attaches the same rotation to the display MP4 by stream-copy remux with `-display_rotation` and `-noautorotate`. Raw floats and preview encoded dimensions remain unchanged. Browsers and downloaded MP4s display upright through the native matrix; the UI does not add CSS rotation. A missing/incorrect matrix, timing drift or orientation disagreement blocks publication. This requires an FFmpeg build supporting `-display_rotation`; installed FFmpeg 9.0.2 supports it. Modern FFprobe's frame `duration` field is also accepted for exact FFV1/NUT final-frame duration.

Film plan review and dispatch now enforce the descriptor's output-pixel, raw-byte, duration, source-pixel and actual VDA model-grid caps in addition to edges/frames/model-input bounds. The model-grid computation follows the pinned upstream lower-bound resize, aspect correction and NumPy ties-to-even multiple-of-14 rounding. A valid input-size number alone is insufficient: e.g. model input 518 at 160×96 is refused because its actual model grid exceeds 300,000 pixels. The workbench exposes model detail and defaults new inputs to 256; existing stored input values stay unchanged and detail edits require saving and reviewing a new revision. Full original 4K output remains refused. A lower-resolution derivative must be an independently reviewed source VideoAsset with its own hash and timestamps; no implicit proxy substitution occurs.

Historical v2 CPU worker launcher SHA256: `4856335b3d25cd27f016c1ceb4f7c4c0fb8454acdd9041377cc6efe314bfc938`; worker implementation SHA256: `c512d7a93d534281b7535016e1fed1c7e0dc60b12c05d6048825d539ea7631a5`. Film refreshes its cached descriptor when the configured launcher changes so old backend fingerprints cannot be reviewed as current.

The opt-in synthetic real-worker test accepts `FILM_DEPTH_SMOKE_ROTATION` (0/90/180/−90), and optionally `FILM_DEPTH_SMOKE_DELIVERABLES` to retain only synthetic source/raw/preview/manifest artifacts in an explicitly chosen directory for browser inspection. The disposable database still gets deleted. Gridlight's separately reported 39 tests, 135-frame exact upstream parity and real-footage measurements are worker-team evidence; Film verification is reported separately. CPU-only depth is not 4K full-output support, a hair alpha matte, a GPU path or production quality approval. Live activation is separate from the tests recorded here.

Local Small results are explicitly `quality_status: experimental_preview` in published metadata, and the workbench labels them experimental with quality review pending. Full-range roles describe coverage and coordinate/timing authority, not production visual quality. Final depth quality requires the owner’s visual review; a successful transport run is not final-quality approval.

## Required GPU selection (v3)

The current node explicitly saves `settings.device=mps`; new nodes use input 384 by default and offer 128/256/384/518. Existing model detail remains unchanged on opening. Legacy nodes without an explicit GPU selection must save/review a new revision before running. 518 is a supported quality option, not a guaranteed improvement or a 4K depth claim.

Film describes and runs the worker with `GRIDLIGHT_DEPTH_DEVICE=mps` and `PYTORCH_ENABLE_MPS_FALLBACK=0`, and also sends the pinned request setting. Descriptors must advertise `pytorch-mps-fp32`, MPS support, `gpu_required_when_selected=true`, the 500000-pixel selected GPU model grid and current adapter/code pins. A CPU descriptor is unavailable. The worker fails when GPU access or a neural operation is unavailable; Film does not retry on CPU. GPU access may be restricted by the calling environment even on a capable host.

Every plan refreshes the descriptor; a changed executable/backend before dispatch requires a new review. Before publication, Film checks the bounded `worker-provenance.json` regular file, exact request/model/source/code/adapter pins, MPS neural device, no CPU neural fallback, and positive dispatch/module-hook evidence. Its contents are retained in the depth manifest, including measured runtime/allocation and exact timing. These records come from the separately audited worker and are not an independent Metal profiler run by Film.

The 512MiB raw, 1920-edge, 2073600-pixel/frame, 1800-frame/60-second and source limits remain. Full mode retains the selected source's actual dimensions. The full270-frame GPU validation used a separately identified upright518×924 lossless derivative. Original3840×2160 full raw is refused. Preview is limited to2seconds/120frames/640px and its reduced dimensions are shown before execution. No proxy is silently substituted.

Standard phone display matrices may include the exact translation that moves a quarter-rotated rectangle into positive display coordinates. Film accepts only that canonical translation (or FFmpeg's zero-origin form), retaining rejection of arbitrary translation, scale, mirror or changing rotations.

Successful depth output is reused only when the exact source/range/settings/node revision, worker/code/adapter pins and Film implementation match, and raw/preview/manifest bytes still verify. The reviewed plan states the cache hit. Failed, cancelled, stale, altered or missing artifacts are never cache hits; a changed cache decision invalidates the prior reviewed plan.
