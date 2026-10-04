# v2 reuse audit and the first writing slice (GRD-4659)

Epic GRD-4658. Audited the film-engine-v2 working tree (branch `react-components`) on 2026-10-04. The machine-readable
inventory is `docs/v2-reuse-inventory.json`, held by `tools/tests/reuse-inventory.test.js`. That test fails if an entry
names code or tests that do not exist, if a fixture or overlapping ticket has no decision, or if the plan drops a child.

## What exists in v2

| Area | Status | Where | Evidence (subtests passing) |
|---|---|---|---|
| Electron IPC | verified | `electron/main.cjs`, `preload.cjs` | Two channels (the prompt window); the rest is HTTP to the bundled backend |
| React panels | changed | `src/pages` | Page tests; at `origin/react-components` (d6a8a94); the writing workbench is untracked |
| Projects and scripts | verified | `routes/projects.js`, `routes/scripts.js`, `db/schema.js` | script-revision 8, screenplay-change-safety 15 |
| Approvals | changed | `lib/approval-guard.js`, `lib/approval-envelope.js` | approval-envelope 21; writing profiles are not an approval kind |
| Provider adapters | verified | `lib/providers/` | providers, providers-anthropic, generator-costs |
| Jobs | changed | `lib/generation-jobs.js` | recovery 46, handles 12, cancel 9; no leases or reconciliation |
| Assets and provenance | changed | `lib/provenance.js` | ops-compliance 10, flow-provenance 6; no portable asset storage |
| MCP | verified | `mcp-server.js`, `lib/mcp-tools.js` | mcp-tools 30, mcp-first-writing 9 |
| Writing style | missing (committed) | none committed; untracked: `lib/writing-style*.js`, `routes/writing-style.js`, migration 130 | writing-style 11 in the working tree; fails bug-hunt-fixes (un-awaited route) |
| Scene readiness | missing | none | none; GRD-4671 |
| Blender previz | changed | `blender-previz.py`, `blender-set.py`, `lib/previs-*.js`, `lib/worlds.js` | previs-to-video 17, board-lock 7 |
| Render and export | verified | `lib/nle-export.js`, `resolve-export.js`, `export-package.js`, `conform.js` | resolve-export 4, export-package 8, video-audio-handoff 12 |

Run: `node tools/backend-tests.js` over the 19 files above → 19/19 files pass, 239 subtests, 0 fail, 2 skipped (listed).

## Fixtures

- **reference**: verified (dialogue-audio-reference, previs-to-video).
- **apply-lock**: verified (board-lock: every frame-writing path honours the lock).
- **no_music**: verified (video-audio-handoff, video-editorial-ui).
- **nonzero-export-start**: **gap**. Nonzero source trims are held; no fixture exports a timeline with a nonzero
  record start. Kept for GRD-4669.

## Reuse decisions

| Ticket | Decision | Why |
|---|---|---|
| GRD-4566 cost approval | integrate | Reuse the 409 STALE_APPROVAL envelope; GRD-4660 adds writing profiles as a kind |
| GRD-4568 durable jobs | reuse | Handles and recovery as they are; leases stay in GRD-4568 and don't block writing |
| GRD-4571 provenance | reuse | Manifests for media; writing provenance already lives in the profile context |
| GRD-4453 AWS rendering | related | Not a dependency of the writing MVP |
| GRD-3598 capture/previz | lead-only | Legacy Done; a lead for GRD-4665 |
| GRD-1096 screenplay | lead-only | Legacy Done; v2 records and tests are the evidence |
| GRD-4600 model catalogue | related | Informs the stereo adapter choice (GRD-4667) |

## First slice and order

Samples → approved profile → draft → author review. Order, from the Jira "blocks" links:
GRD-4660 → GRD-4671 → GRD-4661 → GRD-4662 → GRD-4663 → GRD-4664 (writing), then GRD-4665 → GRD-4666 (Blender),
GRD-4667 → GRD-4668 → GRD-4669 (stereo), and GRD-4670 (release gates).

Before building on the writing MVP, commit it (with the awaited route): it is untracked, alongside unrelated uncommitted work in this checkout
(Meshy provider changes; a copy is on branch `wip-local-backup`). This audit commits only its own three files.

No dates, estimates or performance figures are given; they follow the decisions the epic lists.
