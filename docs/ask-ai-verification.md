# Film writing release verification

The isolated release branch is `feat/film-global-ai`, based on canonical V2 commit
`88137259bea8b459820605301a9d6b281b15aba7`. Its owned implementation was committed
as `bc9908405852e5bdfe270158c75b68ff022762f4`; the follow-up commit contains the
review fixes and this verification record. Unrelated canonical work is excluded.
No live editor restart or shared database migration was performed during testing.

## Result

Global Ask AI opens from Home or any project, retains application conversations,
and previews explicit current/all/selected project evidence before sending. Project
AI Chat uses durable project/feature conversations. Local files require extraction
review, approved source hashes and a selected range. Adaptation requires reviewed
request/result/source fingerprints before creating a version-1 project; undo
archives only an unchanged proposal. Coding remains an honest controlled worktree
handoff: implementation, tests and commits require an authorized host.

AI control and workspace routes require a transient app capability, loopback peer
and trusted Host/Origin. Electron delivers the capability only to its trusted main
frame; provider subprocess environments exclude it. A reused backend must
authenticate this app capability; otherwise Electron starts a separate owned
loopback backend. Desktop attach failures retain a bounded heartbeat. Production
provider probes are asynchronous. Callback persistence failures settle cleanup,
release task ownership and never replay inference. Deleted project/conversation
callbacks cannot recreate tasks or write a screenplay. Sequence context preserves
saved shot order and excludes foreign shots. DOCX jobs enforce aggregate inflated
XML and intermediate-text limits before retaining at most 100,000 characters.

Scene-summary cards save only independent summary/notes metadata. They preserve
screenplay text, dialogue, scene order and user notes. Late saves cannot close or
repaint a replacement card or a newly selected project/version. Writer polling
cannot replace a newly selected conversation; applied scene writes refresh only
a clean editor and leave an explicit pending refresh when it is dirty or saving.
Nested connection dialogs retain Escape and keyboard focus correctly.

## Completed checks

All commands used the installed Node 23.11.0 and existing read-only dependency
symlinks. No software was installed.

- Final affected backend tests: **100 passed, zero failed**.
- Final focused AI UI/authentication tests: **39 passed, zero failed**.
- Full UI suite: **875 passed in 74 files**.
- Full tools suite: **233 passed, zero failed, one unavailable legacy-checkout skip**.
- Production build: passed; output `dist/assets/index-CMQBz3WQ.js`.
- Actual isolated Electron `--smoke`: **3/3 checks, zero console errors**. It
  opened the authenticated global and project writers, drew 3,009 screenplay
  blocks and 106 summary cards, and exported the actual card print window to PDF.
  It submitted zero provider inference requests and changed no card metadata.
- From the Mist current v5: **106/106 summarized, zero stale**; source hash
  `bdf80f7240ac83a10a14311e0e66ad6b0f69625bec69869e04fcd083271913b4`.
  Actual PDF has **27 landscape Letter pages**, four slots per full page,
  **12-point headings/summary text** and 10-point scene labels. Every summary and
  note is present in extracted PDF text; no card overflow. First, middle and last
  rendered PDF pages were visually checked. No physical printer was used.
- A separate Chrome measurement of the actual print HTML preserved every character
  of a five-card long-text fixture, including multiline notes and a long unbroken
  token: 19 continuation slots on five sheets, no clipping or smaller font.
- Both supported subscription CLI transports previously completed the harmless
  `FILM_ENGINE_CONNECTION_OK` response through the owned supervisor, then disposed
  their workers. This does not claim inference was run in the deployed desktop.

The broader isolated backend run passed 453/455 files and 4,916 subtests, with
four failures in unchanged Ableton/audio-format integration tests. All four were
reproduced at the original baseline: unavailable local Ableton sidecar and an
uninitialized credential-table fixture. They are not writing-release regressions.

## Review and evidence

Actual `ce-code-review` receipt: **status complete**, run
`20261011-163843-889bdf02`, artifact directory
`/tmp/compound-engineering-501/ce-code-review/20261011-163843-889bdf02`.
All eleven selected reviewers returned. The independent validator rejected the
unused-path preference; the remaining fourteen in-scope fixes were applied and
verified. The missing external review runner was not installed; the skill's local
adversarial fallback completed. No external code disclosure occurred.

Logs and receipts are retained in the task's `workflow-work/` directory:
`writing-final-backend-focused.log`, `writing-final-ui-full.log`,
`writing-final-tools-full.log`, `writing-final-build.log`,
`writing-final-electron-smoke.log`, `writing-pdf-verification.json`,
`writing-fix-*-receipt.json`, `writing-fix-decisions.json` and
`writing-backend-baseline-failures.log`. The PDF and screenshots are in `output/pdf/`.

## Unapplied review finding

- [ ] P2 — `backend/routes/scripts.js:60` — **Expose independent review cards through MCP**.
  Suggested fix: register `screenplay_cards_read` and `screenplay_card_update`
  through the shared GET/PUT handlers. Preserve source hash/revision conflicts and
  source text; require id, version, script_hash and revision for updates. Expose
  cards, archived metadata and coverage, and document their distinction from
  production cards.

Raised by the `agent-native` reviewer in the completed run above. This is outside
this scoped UI/API release and overlaps unrelated canonical `mcp-tools.js` work.
The supported local card GET/PUT APIs and explicit Ask AI summary attachments
already provide the requested review workflow. No tracker ticket or PR was created;
the concern is recorded here and returned to the caller.

## Deployment boundary

The running desktop still uses the older bundle. Deployment requires selective
integration into the canonical checkout while preserving its unrelated work,
then its already-approved restart after confirming the actual editor shows Saved.
API/SQLite evidence cannot prove unsaved renderer text. The native desktop surface
is unavailable to the enabled browser tools, so that label needs a human checkpoint.
The requested episode clone and Opening Credits project remain queued until the
safe writing release is active. Neither has been created.
