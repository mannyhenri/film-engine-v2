# Film Engine app-owned Claude and Codex connections

Opening the desktop Film Engine V2 application attaches an application lease to its
backend's connection supervisor. The backend verifies the installed CLI account,
starts an owned worker for each signed-in provider and leaves it waiting for input.
The React web client attaches its own lease after the legacy core is ready. There
is no startup prompt, pending-job dispatch, desktop-chat scraping or shared session
selection. Film does not require Neoncore or a separately opened terminal.

The supported installed interfaces are Claude Code's print/stream-JSON CLI and
Codex's noninteractive exec CLI. Codex uses `--no-daemon`, `--ignore-user-config`,
`--ignore-rules`, an ephemeral session, read-only sandbox and disabled tools,
plugins, hooks, apps, browser and multi-agent capabilities. Claude uses
`--safe-mode`, no tools, strict empty MCP configuration, no session persistence and
an application-generated session UUID. A private temporary working directory is
created for each worker. Inherited Neoncore/session identifiers and metered API
credential environment variables are removed. No user configuration is edited.
Claude omits `--bare`: that option skips subscription OAuth/keychain authentication.
`--safe-mode` supplies the isolation while retaining the installed subscription account.

The local input transport becomes ready after the guardian confirms the owned
child is running and the CLI account-status check confirms subscription sign-in.
This is not a model or network round-trip test. The UI separately discloses whether
an approved request has completed during this application session. Missing CLI,
unsupported options, missing sign-in and connection errors are visible states.

Film's project/feature conversation tables remain the source of history and context.
Reopening a conversation resumes that app-owned history, including when changing
provider. Each approved request uses a fresh provider session with the exact bounded
preview payload. Native hidden history is not resumed, so removed attachments and
old project context cannot silently remain in a provider session. The request
requires Film project, conversation and task IDs; callers cannot provide a native
session ID or use a resume option. Provider session IDs are retained as task audit
metadata. Only approved Film story voice enters the reviewed payload. Marketing
Engine's style and conversations are independent.
Global Ask AI uses a distinct application conversation/task domain. Dispatch needs
Film UUID conversation/task IDs plus explicit `application` ownership by
`film-engine-v2`, and carries no synthetic project ID. Authentication failures
clear readiness and inference verification; heartbeat/retry cannot hide them.
The owner must explicitly reconnect or choose secure sign-in before another attempt.

The screenplay AI Chat toolbar button and Ctrl+Shift+A open the app-owned AI workspace. The AI connections panel is available without opening a project. It shows readiness,
reconnect and secure initial sign-in. A second explicit button starts official CLI
subscription sign-in: Claude `auth login --claudeai`, Codex `login --device-auth`.
Complete initial sign-in in the provider's browser. Passwords, API keys and tokens
are never accepted by Film. Public provider URLs and a temporary device code are
kept only in supervisor memory during that flow; raw sign-in output is not logged or
saved. No auth-store files are copied, and Film never logs out another app's account.
Existing supported CLI sign-in can be reused. Sign-in cancellation waits for exit.
A real new sign-in flow has not been exercised in this implementation verification
because both providers already have supported signed-in accounts on this machine.

The per-CLI guardian keeps a control pipe open after Codex's task stdin has ended.
If the backend dies, that pipe closes and the guardian terminates only its CLI,
escalating to SIGKILL if required. Task cancellation stays `cancelling` until the
owned worker has exited. Results become complete only after exit and successful
provider output. App shutdown interrupts outstanding tasks; requests are not replayed.
Connection retries use bounded backoff and create empty workers. Expired web leases
close workers within 90 seconds; normal desktop quit releases its lease immediately.
A reused Film backend is not terminated by the desktop lease; only a backend that
Electron created is stopped on exit. Smoke runs do not connect providers.

Routes: `GET /film/ai-connections`; POST `attach`, `detach`, `reconnect`, `sign-in`,
`cancel-sign-in` beneath that path. Project AI workspace routes still perform the
source/context approval, project ownership, stale-document and apply/undo checks.
Project history uses `150_ai_workspace.sql`; application history and local extraction
jobs use `153_application_ai.sql`. See [Ask AI](ask-ai.md) for context and proposal contracts.

## Activation and validation

Activation must load the updated V2 checkout and UI. `GET /api/health` advertises
the V2 backend identity plus `capabilities.ai_connections: 1` and
`capabilities.application_ai_workspace: 1`. Desktop reuse requires both capabilities.
The UI must show both provider readiness states before an approved model request.

Both installed CLI subscription accounts and owned idle workers were verified in
an isolated native readiness check with **zero control-input/prompt bytes sent**.
No creative task or paid generation was submitted. Synthetic lifecycle, conversation,
voice and depth tests validate dispatch guards, Unicode streams, honest cancellation,
parent-death cleanup, history preservation and separation. Browser verification uses
a disposable database and synthetic workers, clearly labeled on screen.

Official interfaces: [Codex CLI](https://developers.openai.com/codex/cli/reference/),
[Claude Code CLI](https://code.claude.com/docs/en/cli-reference),
[Claude programmatic use](https://code.claude.com/docs/en/headless).
The installed `--help` output is the capability check for these versions.

Legacy server-side API features (such as full-script analysis and production provider generation) retain their existing endpoints and authorization. The default screenplay chat entry uses the managed subscription workspace. This change does not convert every metered production adapter into a Claude/Codex subscription feature.
