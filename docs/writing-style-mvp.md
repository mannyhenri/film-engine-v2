# Personal writing style MVP

This is a text-writing assistant, not audio cloning or model-weight training.
It is project-scoped and starts empty. Existing screenplay text is never
silently enrolled as Manny's original writing.

The Writing style button opens the workbench: choose a guided exercise or paste
an existing sample, record provenance and authorship, and explicitly confirm
unaided original writing when appropriate. Unknown, edited and AI-assisted
samples can be recorded but cannot establish original voice. Samples are
immutable through the API. Profile proposals are versioned and inactive; a
human reviews and approves the latest version. A new draft proposal leaves the
previous approved profile active. Feedback is stored against a profile version.

MCP provides writing_style_read, writing_style_examples, writing_style_context
and writing_style_propose. Evidence confirmation and profile approval are not
MCP tools. Copy assistant handoff supplies the project and current version so
an attached assistant can analyze the confirmed samples and feedback without
an extra provider call. No sample was supplied or enrolled in this implementation.

Approved style context is added to the existing screenplay draft endpoints,
including streaming. Responses include profile/source provenance and remain
proposals: no script, scene, production approval or canon is overwritten.
Context includes at most three examples, treated as reference data rather than
instructions or plot facts. This does not make generated drafts ground truth.

Portable JSON follows the private writing plugin's schema_version 1.0.0:
profile_name, profile_version, owner, status, sources, approved_rules,
approved_examples, pending_proposals, feedback, history, prior_snapshots and
apply_instruction. Exports preserve labels, evidence links and approvals. Profile approval does not imply excerpt reuse approval: approved_examples stays empty, and sample prose is excluded from exports.
Imports validate ownership/schema/evidence references, retain the original
file as a prior snapshot, and quarantine unknown/external/generated sources.
Confirmed eligible original imports can support sample-based proposals; explicitly approved direct preferences can also support a proposal without any samples. Such profiles are marked explicit_preferences_only and never claimed as a learned voice.
that proposal still needs local human approval. Generated ancestors remain
ineligible even if the file claims otherwise. Imported strings are data.
The file importer never executes them. Unsupported/ambiguous records are not
activated. No cross-app synchronization or remote connection is claimed.

## Delivery and activation

Implementation is isolated at /tmp/film-engine-v2-writing-style, based on
5477cbe. It must be reviewed/applied to the current v2 checkout, preserving the
Meshy migration, backend identity, concurrency fix and other sessions' edits.
Migration 130 creates new project-scoped tables only, on a future deliberate
startup. This work did not start/restart a service or migrate the live database.
Do not activate until the user releases the server restriction.

The desktop reusable plugin is separate: export/import files manually until
an explicit integration is built. No original sample has been confirmed yet;
Manny can approve his explicit preferences before sample analysis. Original samples must be confirmed before any inferred voice is activated.

Shared v2 contracts (GRD-4660). Profiles use the shared lifecycle states (draft,
ready_for_review, approved, stale, blocked, failed). Every error carries a code
(version_conflict, STALE_APPROVAL, idempotency_conflict, forbidden, not_found,
invalid_request, storage_unavailable) and the request id, also sent as
X-Request-Id. Approval may carry the shared approval_fingerprint field; an
invented or mismatched one is refused with the current fingerprint. When an
approved profile's evidence changes, that version becomes stale and keeps its
row, hash and guidance. Drafting refuses once with STALE_APPROVAL, and other
versions are untouched. Writes accept an idempotency_key: a retry with the same
payload replays without writing, including after a restart, and a reused key
with another payload is refused. Permissions live in the store: MCP calls are
the agent actor, which may read, draft and propose but never approve.
Operational logs record only the code, operation and request id.

Samples and permitted imports (GRD-4661). Learn my style is in the Screenplay toolbar, next to AI
Chat. It offers short dialogue, action, description, comedy and suspense prompts, each answered in
the author's own words. Every sample records its owner, rights basis (own_writing, licensed or
permission_granted, confirmed), type, language, tags, inclusion, retention (active, held_out or
deleted) and the other projects allowed to use it. A sample taken from an imported script also
records the script's id and the character span it came from. Imported scripts are refused without
a confirmed rights basis. They are kept on this machine, hashed, and cut into one sample per scene
unless spans are given. A sample is never evidence if it is deleted, held out, excluded, not shared
with the project, not original, unconfirmed, or without confirmed rights. Changing a used sample to
any of these makes the approval that used it stale, so drafting stops using it at once. Coverage
shows each category's usable samples and the gaps. A profile with gaps says so in the draft context
and tells the model not to infer the author's preferences there. Deleting a sample leaves a
tombstone: id, hash and dates, with no text, no prose provenance, no sharing, and every copy scrubbed
from imported profile files. Deleting a script does the same for its text and every sample taken
from it. The workbench explains, before deletion, that saved screenplay revisions keep their own
text and that anything already sent to an external provider follows that provider's retention.
