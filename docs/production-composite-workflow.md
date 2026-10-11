# Local production layers in Film Engine V2

Open a project → Production → **Subject Matte**, **Composite**, or **Depth Map**. These controls are React components inside the V2 Electron application. Browser development uses the same components for verification.

Subject Matte converts a registered source video to straight f32 alpha. Composite requires that exact source, an AlphaSequence with the same source hash/range/geometry, and a registered image background. Optional image foreground and depth inputs stay separately typed. Depth cannot stand in for alpha. A wire selects a pending input in the controls; save its revision, review the processing plan, then run it. Existing footage and output versions are preserved. Completed versions provide moving before/after and wipe review, downloadable media and timing/provenance.

The local compositor supports cover/contain/stretch, include/exclude polygons in encoded normalized coordinates over an explicit source-frame range, choke/feather, approximate RGB exposure/contrast/saturation/gamma/channel matching, and deterministic grain. Generated backgrounds are replacement plates, not matching clean plates. Inpainting, reconstruction of occluded anatomy/equipment, video plates and motion-vector blur are unavailable. A saved polygon does not track an object: use short ranges and inspect movement.

## MODNet adapter

`backend/workers/modnet/worker.py` adapts the official **MODNet webcam portrait** checkpoint. Code/weights/demos are Apache-2.0 according to [the upstream repository](https://github.com/ZHKKKe/MODNet). Official video checkpoint: [upstream custom-video instructions](https://github.com/ZHKKKe/MODNet/blob/28165a451e4610c9d77cfdf925a94610bb2810fb/demo/video_matting/custom/README.md). No model is downloaded by Film or by a normal test run.

- Source revision: `28165a451e4610c9d77cfdf925a94610bb2810fb`.
- Checkpoint SHA-256: `913b82b66558db39b6286c150f809017d7528c872b156eb14333c9c6cb52108b`.
- Installed source files and license are verified by `source-manifest.json`; its hash and the adapter hash enter every plan/result. The isolated launcher must pin the adapter bytes and set `FILM_MODNET_ROOT` to the installation directory.
- The prepared launcher reuses the existing PyTorch **2.2.2** environment without upgrading or installing runtime packages. It never enables CPU neural fallback. CPU decode, tensor upload, result download and file export are transport; normalization, bilinear resize, MODNet forward and alpha resize run on MPS FP32. Positive per-module hooks and dispatch tensor counts are retained as execution evidence; they are not an independent GPU profiler.
- `model_input_size` is the longest upright side, rounded down to a multiple of 32 while retaining aspect; choices must be multiples of 32 from 128 to 1024. This adapter uses GPU bilinear input resizing because PyTorch 2.2.2 MPS area pooling rejects nondivisible dimensions. This differs from upstream's OpenCV area-resize video example and needs visual review.
- It is **framewise portrait matting**. It has no temporal tracking, guaranteed hair/held-object completeness or flicker suppression. It preserves soft alpha rather than thresholding to a binary mask.
- Output limits: 1920 per edge, 2073600 pixels/frame, 1800 frames, 60 seconds, 512 MiB raw alpha and 16777216 source pixels. Long 4K output is refused; a lower output resolution is explicitly reviewed while the original source remains unchanged.

After owner-approved setup, supply `FILM_MATTE_ENABLED=1`, an absolute `FILM_MATTE_WORKER` launcher, and the checkpoint pin in `FILM_MATTE_MODEL_SHA256` to the desktop backend environment. Defaults report unavailable. The launcher describes the actual pinned installation and implements the `film-matte-worker-v1` NDJSON protocol. No uploads, paid calls or model downloads occur during processing. The Film service verifies timing/orientation, output byte count, every alpha value, code/model/source pins and the provenance file before publication. Cancellation reaps the owned worker before publishing any output.

## Timing, caches and moving review

Original coded geometry, quarter-turn display orientation, source indices, exact rational FPS, every PTS and final duration are retained. Raw arrays use encoded coordinates. MP4 and alpha MOV carry the display matrix so phone footage displays upright. The compositor checks all input hashes before and after processing. Cache reuse requires matching source, range, settings, worker and Film implementation plus current raw/preview/manifest hashes. Editing invalidates the plan; a cache decision change requires another review.

The preview is silent. Original source audio remains in the archived source for handoff. Foreground MOV uses 8-bit straight alpha; the authoritative refined alpha is separate f32 data. Colour controls work in encoded RGB and are approximate, not scene-linear relighting.

## Resolve handoff

Review and export writes a **new local directory** with original source, processed foreground MOV, fitted background video, source/refined f32 alpha, reference composite, optional foreground/depth, manifests, instructions and a guarded Python helper. The package preserves the source bytes and records all file hashes. No Resolve connection, settings change, import or project modification happens during export.

`resolve-layer-import.py` requires an already authorized Resolve object, the expected manifest SHA, exact project/timeline identities, matching FPS and upright timeline geometry. It saves and exports a verified project backup before duplicating the timeline, then appends only video to new tracks in that duplicate. It restores the original timeline selection and writes a receipt. No automatic connection is included. Synthetic packages require a separate explicit test flag.

The native two-layer helper refuses VFR and packages with optional foreground/depth integration: they require a separately reviewed conform/compositing step. The reference composite is still usable for moving review. Grain exists in the reference render, audio needs intentional placement, and lossy background encoding means the two native layers are not a pixel-identical replacement. Native Resolve import and visual reconstruction remain unverified until the owner authorizes access and it is exercised in the actual edition/runtime.

## Validation boundary

Synthetic sources/alpha verify the protocol, guards, typed graph, rendering, cancellation, downloads and export; they do not establish neural quality. Real IMG_1541 tests use an isolated V2 database and the owner-approved source and generated landing-pad plate. Review previews separately for portrait edges, carried equipment, temporal consistency and the table's lower-leg occlusion. A source table hides information the model cannot recover. A layer export or passing transport test is not a final-quality approval.
