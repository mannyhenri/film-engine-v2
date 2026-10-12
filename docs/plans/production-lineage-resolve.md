# Approved Production implementation

All implementation occurs in this independent checkout. Baseline 4bd8c531aed261126d62469c9f5c8bb2a45287ac includes the canonical source's existing tracked and untracked work. Canonical integration belongs to the parent task. No application/server/Blender/Resolve launches, actual provider calls, live DB imports or migrations. Tests use disposable data before any backend import and mocked transport. No image activation fix. No dependency installations. Browser inspection of the local prototype was rejected for the file URL protocol; no alternate browser/serving workaround is authorized.

## Settled product contracts

Scene groups are freely movable/resizable with vertical narrative rows. Canvas geometry never changes running_order. Each shot may participate in multiple sequences without being falsely removed from another sequence. Immutable origins connect ordered reference bytes and exact prompt/settings to each image/video result. Current-source edits are draft recipes, requiring the existing human final request review before paid dispatch. Legacy missing origins remain unknown. Approved representation and actually sent transport are separate facts.

Sound conditioning and timeline audio are distinct. Conditioning validates provider/model/workflow support and exact role/bytes/order. Timeline tracks preserve the full original file and explicitly store offset/source trim/duration/gain/mute. Selected video plays; an available image otherwise holds exactly 5000 ms. Resolve handoff makes a package, never claims successful import. Export includes selected footage/shot sounds/narrative rough cut, offline warnings, and explicit timebase.

## Ownership before edits

Phase A, graph/data worker exclusively owns:
- backend/db/migrations/148_production_scene_recipes_audio.sql
- backend/lib/production-graph.js
- backend/routes/production-graph.js
- backend/routes/sequences.js (shared membership creation/edit; extension declared before edits)
- backend/lib/production-recipes.js (new)
- backend/tests/production-scene-recipes-audio.test.js (new)
- backend/tests/production-graph.test.js (align superseded expectations; server run remains prohibited)
- backend/tests/production-graph-nodes.test.js (align superseded expectations; server run remains prohibited)

Phase A, immutable-origin worker exclusively owns:
- backend/db/migrations/149_generation_transport_receipts.sql
- backend/lib/generation-transport.js (new)
- backend/lib/production-lineage.js (new)
- backend/lib/final-provider-request.js
- backend/lib/final-request-review.js
- backend/lib/asset-recipe.js
- backend/lib/providers/openai-image.js
- backend/lib/providers/google-image.js
- backend/lib/providers/muapi-image.js
- backend/lib/providers/seedance.js
- backend/lib/providers/runway.js
- backend/lib/providers/higgsfield.js
- backend/lib/providers/meshy.js
- backend/lib/providers/worldlabs.js
- backend/lib/providers/magnific.js
- backend/lib/providers/elevenlabs.js
- backend/lib/providers/muapi-topaz-upscale.js
- backend/tests/generation-transport-lineage.test.js (new)
- backend/tests/final-provider-transport.test.js

Phase B, request integration worker exclusively owns:
- backend/lib/production-draft-request.js (new)
- backend/lib/final-request-plans.js
- backend/lib/final-request-review.js (ownership transfers after Phase A commit)
- backend/routes/storyboard.js
- backend/routes/video-gen.js
- backend/routes/sequences.js (ownership transferred after Phase A commit: saved sequence drafts)
- backend/lib/providers/index.js (explicit validated recipes retain detached references and reject unsupported inputs)
- backend/lib/sequence-delivery.js (extension: immutable versioned legacy leg files/rows and exact retry identity)
- backend/lib/providers/runway.js (extension: native multi-shot promptImage uses existing media URI normalization)
- backend/tests/production-draft-request.test.js (new)

Phase B, UI worker exclusively owns:
- src/pages/productiongraph/ProductionGraphPage.jsx
- src/pages/productiongraph/engine.js
- src/pages/productiongraph/production-lineage.css (new)
- src/pages/productiongraph/lineage-model.js (new)
- src/pages/productiongraph/lineage.test.jsx (new)
- src/components/FinalRequestReview/FinalRequestReview.jsx
- src/components/FinalRequestReview/FinalRequestReview.native.test.jsx

Phase B, timeline/export worker exclusively owns:
- backend/lib/timeline.js
- backend/routes/timeline.js
- backend/lib/resolve-export.js
- backend/routes/nle-export.js
- backend/tests/timeline.test.js
- backend/tests/resolve-export.test.js
- backend/tests/production-audio-timeline.test.js (new)
- src/pages/exportpage/ExportPage.jsx
- src/pages/exportpage/export-contract.test.jsx
- src/pages/exportpage/ExportPage.test.jsx (package wording and confirmation alignment)

Root owns this plan, integration, backend/lib/generation-jobs.js accepted-result filing hook and backend/tests/production-draft-recovery.test.js focused recovery tests, generated legacy/split/assembled artifacts if required, verification/handoff documents, and authoritative tests. Workers request ownership extension before writing other paths; no Git writes, installs, generators, format sweeps or broad tests.

Root also owns backend/tests/clip-coverage.test.js and backend/tests/dialogue-playback.test.js to align superseded still-duration assertions with the approved exact 5000 ms contract.
Root owns backend/lib/production-lineage.js and backend/tests/generation-transport-lineage.test.js to expose the stored approved editable payload for exact recipe reruns, and backend/routes/production-graph.js for read-only current-source draft starter dispatch (Phase A ownership transferred).
Root owns backend/tests/production-draft-starter-route.test.js direct dispatch coverage and backend/server.js await of the read-only starter handler, alongside print dispatch.
Root owns backend/lib/final-provider-request.js to preserve exact mixed keyframe/Moodboard role/order mapping and validate influence instructions against the actual sent image position.
Root owns backend/tests/production-mixed-references.test.js for combined endpoint/plate reference identity and duplicate-byte role cases.
After worker completion, root owns the settled UI/data files for behavior-preserving simplification. Root owns tools/assemble-page.js for CSS-import compatibility in test-only static markup assembly; the actual app keeps Vite's normal stylesheet pipeline. Active request-unit paths remain exclusively with that worker until its final report.
Root owns backend/lib/conform.js and backend/lib/selected-frame.js to exclude late historical results from implicit fallback selection while allowing explicit version choices. This is Production result-selection protection, separate from archive/restore activation repair. Root aligns graph frame selection with the shared selector and proves the fallback behavior in backend/tests/production-draft-recovery.test.js.
All Phase B worker paths have been released to root after final reports. Root owns focused fixes from the fresh independent review, including timeline/recipe lifecycle, idempotent original-target filing and safe historical selection. Canonical Production integration remains held during the parent's separate activation/runtime/import work.

User-added print unit exclusively owns backend/lib/storyboard-print.js, backend/routes/storyboard-print.js, backend/tests/storyboard-print.test.js, src/components/StoryboardPrint/StoryboardPrint.jsx, src/components/StoryboardPrint/storyboard-print.css, src/components/StoryboardPrint/StoryboardPrint.test.jsx. Root owns backend/server.js print dispatch registration after path audit. UI worker owns mounting the Print action. Printing uses selected original images, real camera/description/dialogue in narrative order, Letter landscape default/A4, four normal panels per page with explicit overflow continuation panels. No physical print job, live project mutation, or browser security workaround.

## Data/API contract for Phase A

Extend group PUT to accept optional finite x/y/w/h and collapsed; respond with saved geometry. GET groups has key/scene_id/x/y/w/h/members/collapsed. Group moves translate member positions in one transaction; resizing keeps user width/height as minima and expands for content. Nodes may move, with vertical tidy layout independent of narrative order.

Under /projects/:id/production-graph/nodes/:encodedKey:
- GET /draft returns {draft:null|{revision,payload,source_asset_id,updated_at}, audio_tracks:[]}; PUT /draft accepts {expected_revision,payload,source_asset_id}; optimistic revision conflict is 409. A draft is editing state, never historical truth.
- GET /audio returns {tracks:[]}; PUT /audio accepts {tracks:[{id?,asset_id,offset_ms,source_in_ms,duration_ms?,gain_db,muted,order}]}; validates same-project audio, owner existence, exact source range. Relationship is timeline only. Conditioning references live in draft payload.audio_references, never silently promoted from tracks.

production-recipes exports readDraft(db,projectId,nodeKey), saveDraft(db,projectId,nodeKey,input), readAudioTracks(db,projectId,nodeKey), saveAudioTracks(db,projectId,nodeKey,tracks), and nodeOwner(db,projectId,nodeKey). Returned tracks include immutable source asset/path/duration metadata. Graph shot/sequence nodes include draft and audio_tracks; edges label timeline audio explicitly. No dependency on receipt module is needed in Phase A; root/UI integrates immutable lineage projection after commits.

## Phase B integration contract

Draft payload keeps independent `image` and `video` recipe objects. A recipe may carry `provider`, `model`, `prompt`, `negative_prompt`, `reference_images`, `audio_references`, and supported provider settings, plus source_asset_id for history. Generate sends `production_draft:{node_key,revision}` to the existing shot route. The route and free final-review planner resolve the same saved recipe, check revision, resolve same-project referenced assets to immutable bytes, and include draft revision/digest in approval provenance. Changing a draft or selected source after review invalidates consent. Never mutate historical origin rows. Every newly filed synchronous result carries result.final_request_review_id or result.meta.final_request_review_id into asset metadata; asynchronous job IDs retain original target identity.

Timeline response exposes `audio_tracks` separately from conditioning. Each projected edit includes original track fields/source snapshot, absolute_start_ms, timeline_used_duration_ms and effective_source_in_ms; negative offsets are explicit prelaps. UI schedules start/stop/seeks from these fields and reports offline media/unsupported gain, without silently dropping or clamping. Resolve manifest preserves original milliseconds as well as quantized XML frame positions, bytes/hash identity, original full file, missing/offline reasons, and `imported_into_resolve:false`.

Immutable-origin worker extends assetRecipe with lineage {status:'recorded'|'legacy_unknown',review_id,provider,model,approved:{endpoint,body,references,adapterVersion},transport:null|{endpoint,method,body,references,sent_at,state},origin:{project_id,shot_id,sequence_id,...},unknown:[]} using identity-linked review/job receipts, never nearest-time matching for exact truth. Includes semantic role, wire_role, order, sha256, byte_length and byte source where recorded. Transport headers/credentials are excluded. Actual transport is recorded before the dispatch attempt; success is not inferred from attempt. Results bind to original review/target, independent of current selections.

## Verification contract

Proof-first or characterization-first for behavior changes. Focused tests may run only with isolated temp resources and no server/application launches. Test geometry persistence/free placement/resize growth/running order; multiple sequence membership; draft concurrent revision; audio relation distinction and placement. Mock HTTP transport captures approved versus actual bodies, exact bytes/role/order, cancellation/replay/stale-origin behavior, legacy missing provenance. UI exercises click/drag/versions/reruns and A-B-A/remount/cancel/double-send without network. Export parses actual emitted XML and manifest and compares narrative/timebase/selected files/audio trim and full copied bytes. Never run the supplied Resolve import script. Independent read-only review before handoff. Root compares canonical files/status/hashes before final delivery and supplies only the delta from the private snapshot.
