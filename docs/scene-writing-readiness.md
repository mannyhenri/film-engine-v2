# Scene writing readiness (GRD-4671)

Each scene has a writing status: Draft, Reviewing or Production ready. It is separate from the
production status (written, broken_down, … approved). A scene can be production-approved while its
writing is still Draft. No shot, render or production status ever sets it.

**Bound to the text.** A status holds only for the full scene text it was given to: heading, action,
dialogue, parentheticals, everything in the scene's span. That text is fingerprinted with sha256.
`lib/scene-writing.js` reads stored readiness against the scene's text in the latest Fountain. If the
text changed, the scene reads as Draft and an `auto_reset` event records both fingerprints. Writers
never have to remember to reset it, so every path is covered: scene edits (REST and MCP), script saves,
autosave, history restore, FDX import, and the character and location renames that write the Fountain
directly. Script saves also settle readiness immediately, so restoring earlier text cannot bring back a
readiness that a change already ended. Saving identical text, moving an unchanged scene, or editing
another scene leaves readiness alone.

**Identity.** Readiness belongs to the scene row the reconciler keeps. Replaced or recreated scenes are
new rows and start Draft. Two scenes with identical full text cannot be told apart, so neither holds
readiness or can be given it (`ambiguous_identity`).

**Changing it.** `GET/POST /film/scenes/:id/writing-status`, or the MCP tools
`scene_writing_status_read` and `scene_writing_status_set`. Both go through the same validation. A
change needs `project_id` and `expected_fingerprint`, the fingerprint of the text the caller reviewed.
A stale fingerprint gets 409 `version_conflict` and changes nothing. An optional `idempotency_key`
makes retries safe. Every transition records its actor, time, fingerprint and optional reason.

**Downstream.** The pre-spend approval envelope warns with `scene_writing_not_ready` (info) when a
shot's scene is not Production ready. It never blocks: camera, board and render approvals keep their
own rules. Marking a scene Production ready renders, exports and spends nothing.
