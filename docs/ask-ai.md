# Global Ask AI

The top-right Ask AI rail entry replaces the terminology Terms entry on Home and
every page. The terminology glossary remains under Guide. Legal/license files are
unchanged. The App mounts Ask AI, the existing project AIWorkspace and the existing
AI connections panel once, outside project page remounts. Escape closes the modal
and restores its opener. Application conversations persist across navigation,
closing/reopening and backend restart. Interrupted tasks are never resubmitted.

Application conversations, tasks and local uploads live in separate tables from
project/feature writing history (`153_application_ai.sql`). Project ownership and
existing writer APIs stay intact. Both domains use Film's existing provider
connection supervisor. Application dispatch carries Film UUID task/conversation
IDs and explicit application ownership, without a project ID. Opening a workspace
sends no prompt. Local transport readiness and verified inference remain separate.

## Context review

Choose current, all or selected projects. Home has no current project. Every
included project has explicit metadata/runtime/scene/summary choices; no full
screenplay is implicitly attached. Global catalog inspection is read-only. Saved
canonical summaries come from existing card snapshots; missing/stale summaries are
reported as omissions. Preview exposes source and evidence SHA-256 hashes, saved
versions, line/character ranges, exact payload, a maximum 32,000 character / 6,000
word context budget, 16,000 character history budget, and all omissions. Dispatch
reassembles this evidence and refuses changed sources, conversation history,
upload approvals or all-project membership. Runtime evidence uses saved shot
durations and ordered owned sequence shots. Unknown durations and planning
assumptions are labeled; final media runtime is not asserted.

## Local source files

The owner chooses each file in the UI. TXT, Markdown, Fountain, DOCX and FDX are
allowlisted, up to 5 MB each. Originals stay in the local database with SHA-256
provenance. Fixed worker-thread parsers use UTF-8, Film's existing DOCX extractor
and existing FDX-to-Fountain parser. Extraction retains at most 100,000 characters
and reports omitted text/formatting. Queued/extracting jobs show progress, failures
and cancellation; restart records interrupted extraction. No caller filesystem
paths, remote URLs or document code are accepted. PDF, DOC, RTF and Pages parsers
are unavailable and explained in the UI. Extracted text needs explicit approval,
then an explicit character-range selection and request preview before dispatch.
Cancelling a file removes its stored bytes/text and revokes approval.

## Adaptation

A request needs supplied source text and a reviewed new-project title/logline/genre.
The provider returns a Fountain proposal; it creates nothing automatically.
Apply requires matching reviewed request, result and source fingerprints. It creates
one new project and a version-1 screenplay through the existing save/reconcile API.
No existing project or My Voice sample is changed. Undo refuses changed project
evidence and archives an unchanged adaptation instead of deleting its screenplay,
files or history. Generated text never becomes voice ground truth automatically.

## App-code handoff

Coding requests produce durable text proposals targeting the configured canonical
V2 repository, with a recorded base commit. Approving the reviewed result can create
a detached, task-owned Git worktree under Film's local data directory. A changed
base commit blocks dispatch. Model text cannot execute commands or edit the running
checkout. Film shows checkout status/diff and an explicit host execution, test and
commit review handoff. Film has no authorized coding host and does not run generated
code, tests, commits or pushes. Those states remain `requires_authorized_host`,
`not_run` and `review_required`; they are never represented as completed work.

## Verification boundary

Focused backend tests use disposable databases, synthetic provider transports and
temporary Git repositories. UI tests operate the actual shell entrypoint, legacy
AI Chat/keyboard handlers, durable reopen/navigation/focus, exact context preview,
local file approval/cancel and proposal review gates. Actual desktop build/relaunch
and subscription inference are separate authorized release verification steps.
