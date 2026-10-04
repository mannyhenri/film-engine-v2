# Style drafting: hosts, transports and tool contracts (GRD-4663)

Film Engine supplies **context and tools** to the model that writes. MCP gives the host model the
author's approved style context, examples and tools; no model weights are trained, and nothing here
is fine-tuning.

## The contracts

The tool names use underscores because the Claude API and the OpenAI API both refuse "." in a tool
name (`^[a-zA-Z0-9_-]{1,64}$`). Each contract is one tool, and every tool is strict: unknown fields
are refused (`unknown_field`), and so are stale versions (`version_conflict`).

| Contract | MCP tool | Who may call it |
|---|---|---|
| `style.get_profile` | `style_get_profile` | read: assistant or author |
| `style.search_examples` | `style_search_examples` | read: assistant or author |
| `style.propose_update` | `style_propose_update` | propose: assistant or author, pending until accepted |
| `style.record_feedback` | `style_record_feedback` | author only, in the workbench; an assistant call is refused |
| `style.apply_update` | `style_apply_update` | author only, with the exact approval fingerprint; an assistant call is refused |
| `script.create_draft` | `script_create_draft` | draft: assistant or author; never changes the screenplay |
| `script.compare_drafts` | `script_compare_drafts` | read: assistant or author |

All of them go through `POST /film/projects/:id/style-drafting/<contract>`, the same service the
workbench uses. Approving a preview, sending it to a provider, and accepting text into a new
revision are workbench steps (`drafts.approve_preview`, `drafts.generate`, `drafts.accept`). They
are not offered to a host.

## Transports enabled in v2, and how each is verified

| Transport | Status | Verified by |
|---|---|---|
| stdio MCP (`backend/mcp-server.js`, newline-delimited JSON-RPC) | Supported | `backend/tests/style-drafting.test.js` spawns the server and runs initialize, tools/list and tools/call: drafting works, and refusals arrive as `isError` results |
| In-process MCP (`lib/mcp-tools.js` callTool) | Supported | Same test file: read, draft and propose succeed; apply and feedback are refused |
| REST (`/film/projects/:id/style-drafting/...`) | Supported | Same test file: the author's apply and feedback succeed |

## Hosts

| Host | Transport | Status |
|---|---|---|
| Claude Desktop | stdio MCP, local | Supported: `claude_desktop_config.json` runs `backend/mcp-server.js`. Use provider `host`: Claude writes the draft and returns it with `script_create_draft` (request_id and text). |
| Claude Code | stdio MCP, local | Supported, the same server. |
| Claude (Anthropic API), from Film Engine | provider `claude` through the project's LLM adapter | Supported when the project's provider is Anthropic. Any other configured provider fails visibly instead of being substituted. |
| ChatGPT (OpenAI API), from Film Engine | provider `chatgpt` through the project's LLM adapter | Supported when the project's provider is OpenAI. Any other configured provider fails visibly. |
| ChatGPT app (connectors / developer mode) | remote MCP over HTTPS only | **Unsupported**: ChatGPT connects to remote MCP servers, not to a local stdio process, and this server is local stdio only. Use the Film Engine-initiated `chatgpt` provider, or run a remote MCP bridge (not part of v2). |
| Any host, with tool names containing "." | n/a | **Unsupported**: the APIs refuse them; use the underscore tool names above. |

No live session in Claude Desktop, Claude Code or the ChatGPT app, and no paid provider call, ran as
part of this change. The stdio protocol is exercised in tests; live host use is still to be checked.

## What leaves the machine

- **A Film Engine-initiated provider call (`claude`, `chatgpt`).** It sends exactly the payload the
  author approved in the preview: provider, purpose, sample categories, the chosen excerpts and this
  one scene, never the whole script corpus. The payload is rebuilt before approval and again before
  sending. If anything moved (a sample deleted, the profile stale, the scene edited), nothing is sent.
- **An MCP host.** The host reads tool results under the user's own connection to it, and the
  host's permission prompts. Film Engine returns only eligible excerpts.

Retrieval never returns deleted, held-out, excluded, unshared, revoked, unpermitted or unconfirmed
samples, however similar they are. Owner (by default, the owners of the approved profile's
evidence), language and sample type filter the rest. Ranking is lexical overlap with the brief:
v2 has no embedding index. At most two excerpts come from one source and three from one category,
within the token budget.
