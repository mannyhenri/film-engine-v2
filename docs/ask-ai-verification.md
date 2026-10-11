# Ask AI implementation handoff

Authoring checkout: `film-writing-release`, branch `feat/film-global-ai`, starting
HEAD `88137259bea8b459820605301a9d6b281b15aba7`. No staging, commit, push, provider
prompt, software install, canonical source edit, shared database/service restart or
production-review edit occurred. Dependency symlink folders were not modified.

## Behavior changed

- App-mounted global Ask AI replaces only the top-right terminology Terms entry.
  Guide retains a terminology glossary button; legal/license files remain intact.
  Home needs no pseudo-project. Application conversations survive navigation,
  close/reopen and restart. Escape/focus restoration and legacy project AI Chat /
  Ctrl+Shift+A entrypoints are covered.
- Separate constrained application conversation/task/upload tables in migration
  153 preserve existing project foreign keys and writer contracts. Dispatch shares
  the existing app-owned connection lifecycle with UUIDs and explicit Film global
  ownership. Local readiness and inference verification are distinct. Claude
  omits `--bare` to retain existing subscription authentication; auth failures
  remain unavailable/unverified until explicit reconnect/sign-in.
- Explicit current/all/selected scope with selected metadata, saved scene text,
  canonical summaries, runtime/sequence evidence and labeled assumptions. Preview
  exposes source/evidence hashes, versions/ranges, character/word budgets and
  omissions. Changed context/history/source/approval blocks dispatch. Catalog
  summary inspection is read-only for every project.
- Bounded local TXT/MD/Fountain/DOCX/FDX jobs use existing parsers in worker threads,
  store original SHA/provenance, show progress/text, require approval then selected
  range inclusion, and revoke it on cancel. Missing PDF/DOC/RTF/Pages capability is
  explicit. No caller paths, remote fetching, document execution or automatic send.
- Novel adaptation remains a Fountain new-project proposal until matching reviewed
  request/result/source fingerprints are applied. It saves version 1 through the
  existing script API. No My Voice training or other project writes. Undo detects
  later project work and archives an unchanged proposal project, retaining history.
- Coding proposals target canonical V2 and record a base commit. Explicit result
  review can create a task-owned detached checkout; tracked diff/status are visible.
  Repo hooks are disabled for Git control operations. Actual implementation/tests/
  commits require a separately authorized host; Film honestly retains pending
  execution/test/commit states and never executes model text or edits the live tree.
- Desktop reuse requires V2 identity and both writing capabilities; selective
  lease startup/shutdown and backend/UI hooks exclude unrelated final-review,
  production, media and image-handoff hooks.

## Exact paths authored or changed by this unit

New:

- `backend/db/migrations/153_application_ai.sql`
- `backend/lib/ask-ai.js`
- `backend/lib/ai-uploads.js`
- `backend/lib/ai-upload-worker.cjs`
- `backend/lib/ai-coding-handoff.js`
- `backend/tests/ask-ai.test.js`
- `backend/tests/writing-backend-identity.test.js`
- `src/components/AIWorkspace/AskAI.jsx`
- `src/components/AIWorkspace/AskAI.css`
- `src/components/AIWorkspace/AskAI.test.jsx`
- `src/components/AIWorkspace/AskAIRail.test.jsx`
- `src/components/AIWorkspace/ProjectAIEntry.test.jsx`
- `docs/ask-ai.md`
- `docs/ask-ai-verification.md`

Changed from the supplied snapshot/clean shared hooks:

- `backend/lib/ai-connections.js`
- `backend/lib/ai-cli-runner.js`
- `backend/lib/backend-identity.js`
- `backend/routes/ai-workspace.js`
- `backend/server.js`
- `backend/tests/ai-connections.test.js`
- `electron/main.cjs`
- `public/legacy/shell.js`
- `src/App.jsx`
- `src/components/AIWorkspace/AIWorkspace.jsx`
- `src/components/AIWorkspace/AIConnections.jsx`
- `src/pages/screenplay/engine.js` (only one conditional delegation in `toggleAIChat`)
- `tools/tests/engine-verbatim.test.js` (named intentional bridge change)
- `docs/ai-connections.md`

The other approved copied writing dependencies, including `ai-workspace.js`,
`screenplay-cards.js`, migrations 129/148/150, existing writer/CLI/card tests,
desktop lease and `electron/backend-runner.cjs`, match their snapshot hashes.
Their pre-existing untracked/modified Git status is not new work by this unit.
`src/index.html` was generated locally by the required test-only assembler and
remains ignored; it is never served or committed.

## Proof and characterization

Inspected existing `ai-workspace.test.js`, `ai-connections.test.js`,
`ai-cli-runner.test.js`, `screenplay-cards.test.js`, DOCX parser tests and existing
AIWorkspace/AIConnections UI tests. Baseline: 21 provider/writer backend tests and
7 UI tests passed before edits. The focused screenplay engine contract passed.

Proof-first red observations:

- New application ownership/history/context tests failed with missing `ask-ai`
  module before implementation (`/tmp/film-ask-ai-red.log`).
- Global Home/navigation/review UI tests failed with missing AskAI component
  (`/tmp/film-ask-ai-ui-red.log`).
- Read-only catalog regression failed: opening catalog created one card and one
  snapshot. Pure saved-card inspection fixed it (`/tmp/film-ask-ai-catalog-red.log`).
- Actual legacy AI Chat entry test failed to open the persisted writer, establishing
  the missing delegation. The one-line engine bridge fixed it
  (`/tmp/film-project-ai-entry-red.log`).
- A 5 MB boundary test exposed recursive base64-regex stack overflow. Flat byte
  validation/canonical re-encoding fixed the issue.

Final commands used Node 23.11.0 with its bin first in PATH:

```sh
node --test backend/tests/ask-ai.test.js backend/tests/ai-workspace.test.js backend/tests/ai-connections.test.js backend/tests/ai-cli-runner.test.js backend/tests/docx-text.test.js backend/tests/writing-backend-identity.test.js
# 55 passed, 0 failed. /tmp/film-writing-backend-owned-final.log

node node_modules/vitest/vitest.mjs run src/components/AIWorkspace/AIWorkspace.test.jsx src/components/AIWorkspace/AIConnections.test.jsx src/components/AIWorkspace/AskAI.test.jsx src/components/AIWorkspace/AskAIRail.test.jsx src/components/AIWorkspace/ProjectAIEntry.test.jsx --no-cache
# 5 files, 13 passed. /tmp/film-writing-ui-final.log

node --test --test-name-pattern='src/pages/screenplay/engine.js:' tools/tests/engine-verbatim.test.js
# 1 passed. /tmp/film-writing-engine-final.log

node tools/assemble-page.js
# Required ignored test-only HTML fixture generated; no app build or restart.

node --test backend/tests/screenplay-cards.test.js
# 6 backend domain tests passed; 2 copied canonical UI dependencies failed below.
# /tmp/film-writing-cards-final.log

node --test --test-name-pattern='all screenplay spans|stale script and concurrent|reordering repeated|ambiguous changed|renumbering|other project' backend/tests/screenplay-cards.test.js
# The 6 card-domain tests pass. /tmp/film-writing-cards-domain.log

node --check electron/main.cjs
node --check backend/server.js
git diff --check
# All pass.
```

New tests exercise actual isolated SQLite restart/reopen state, explicit domains,
UUID relay transport, foreign/stale ownership, omissions/ranges, read-only catalog,
real local UTF-8/DOCX/FDX extraction workers, bounded source approval/cancel,
matching adaptation review/apply/undo and later-edit conflicts, no generated voice
training, real temporary Git worktree dispatch/diff with the target unchanged,
honest authentication state, desktop identity and actual shell/legacy UI entrypoints.

## Remaining integration gap and deliberate test boundaries

The supplied canonical `screenplay-cards.test.js` has two UI tests whose card UI
hooks were not in the approved clean release dependency set. Assertions are
unchanged; the full file still reports these exact failures:

1. `UI cancel/reopen and repeated saves use metadata only, retain multiline notes, and reload persisted values`
   — `indexCardsData` is undefined in the clean release card UI.
2. `print HTML escapes script-closing text and uses four slots with readable continuation`
   — `reviewCardsPrintHTML` is absent from that UI.

The screenplay engine is otherwise byte-identical to its starting HEAD except
the single AI Chat delegation. The parent owns selective integration of these
pre-existing canonical card UI hooks while preserving unrelated engine work.
The global assistant's own summary behavior and source/omission tests pass.

No new tests for reversible documentation or CSS-only formatting. No full suite,
desktop build, visual desktop QA, server restart, real provider prompt or actual
canonical worktree dispatch was performed here. Parent owns those release stages.
No in-app coding execution/commit implementation, new software/parser installation,
account grants, paid generation, Resolve integration or voice auto-training was
added. Unsupported parser and controlled host-handoff states remain visible.
