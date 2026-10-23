# Film Engine panel for DaVinci Resolve: scope

Status: scoped 2026-10-19, not scheduled. Nothing here is built.

## The ask

Put Film Engine inside Resolve as a panel (Workspace › Workflow Integrations), so the edit and Film Engine stop trading files by hand. The four jobs:

1. Browse a project's shots, boards and previz, and drop them onto the timeline.
2. Send a gap, or a board held on the timeline, to Generate.
3. Pull new takes back in, onto the right clip.
4. Push edits made in Resolve back to Film Engine.

## Where we start from

- Film Engine only sends to Resolve, one way (`backend/lib/resolve-export.js`, `resolve-launch.js`). It writes an FCP7 XML timeline and a generated `Import into Resolve.py`, launches Resolve, and runs the script with external scripting. Nothing reads back: no timeline read, no render, no round trip. The live launch-and-import path has never been run against a real Resolve; tests inject a fake runner.
- Entry points today: `POST /film/cuts/:id/send-to-resolve` (Cut tab), `/film/projects/:id/export/resolve` (Export page), and MCP `cut_send_to_resolve`, `export_resolve*`.
- Composite layer handoff exists (`resolve-layer-export.js` plus `resolve-layer-import.py`, contract `film-resolve-layers-v1`), but nothing calls the import side.

## Platform facts (Resolve 21.1.1 on this Mac)

- Workflow Integration plugins are Electron apps. Resolve 20.1 moved to Electron 36.3.2, which is sandboxed with context isolation, and added promise-based async APIs (`InitializePromise`, `GetResolvePromise`).
- Resolve is driven from `WorkflowIntegration.node` through a preload bridge. The sample to copy is `Developer/Workflow Integrations/Examples/SamplePromisePlugin`.
- Install folder: `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.<company>.<name>/` (`%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\` on Windows). Writing there needs admin rights, so we need an installer.
- **Resolve Studio only.** Plugins run on macOS and Windows, not Linux. The free version has no Workflow Integrations menu, so the panel is a Film Engine feature, not a mass-market product.
- Prior art on this machine: `com.runwayml.resolve` v0.1.11 (about 2.8k lines). It reads `GetSelectedClips` or the mark in/out range, renders that range (`SetRenderSettings`, `AddRenderJob`, `DeleteRenderJob`), sends it to the model, then calls `ImportMedia` and `AppendToTimeline`. It ships unit-tested pure modules (`timecode.js`, `source-range.js`, `render-range.js`, `guards.js`). Copy that structure.

## Architecture

```
Resolve Studio
 └─ Workflow Integrations › Film Engine   (Electron, sandboxed)
     ├─ main.js / preload.js   WorkflowIntegration.node bridge, promise API only
     ├─ UI (React, built to a static bundle)
     └─ HTTP → Film Engine backend (localhost:3100), token-authenticated
```

- The panel is a thin client. All project logic stays in the backend, and it calls existing routes where they exist.
- **Auth:** pair once with a token shown in Film Engine › Settings, stored by the panel. Don't open the backend to the LAN for this. The Cairn incident is why.
- **Identity:** every clip the panel places carries a Film Engine id. Store it in a clip property or marker custom data (`AddMarker(..., customData)`) and in the media pool clip's metadata, so reads and round trips can match clips without parsing names.

## Features, in build order

| # | Feature | Resolve APIs | Backend | Size |
|---|---|---|---|---|
| 1 | Connect: pair, choose a project, show the Resolve version and Studio check | `GetVersionString`, `GetProjectManager` | new `/film/integrations/resolve/pair` | S |
| 2 | Browse and drop: shots, boards, previz video and takes per scene, with thumbnails; drag or "Insert at playhead" | `ImportMedia`, `AppendToTimeline` (clipInfo with track and recordFrame), `AddMarker` with customData | existing asset and shot routes; needs a slim "panel list" endpoint | M |
| 3 | Send the cut: replace the XML and script with direct API calls (create the timeline from a Cut) | `CreateEmptyTimeline`, `AppendToTimeline`, `SetSetting` | reuse the `planResolve` plan as JSON, not XML | M |
| 4 | Generate from the timeline: select a gap, a board or a clip, then "Send to Generate". The range and its neighbours are rendered as context | `GetSelectedClips`, `GetMarkInOut`, `SetRenderSettings`, `AddRenderJob`, `StartRendering` | Generate hand-over (Higgsfield and Runway are manual, so this opens Direct with the shot prefilled rather than calling a model) | M |
| 5 | Pull takes: new takes for placed shots appear with a badge; "Swap in" replaces the clip in place and keeps the old one on the track above | `ImportMedia`, take-selector APIs (`AddTake`, `SelectTakeByIndex`) | takes per shot (exists); a poll or SSE endpoint | M |
| 6 | Push edits back: read the timeline (order, in/out, which shots were cut or retimed, markers and notes) and show a diff before writing to Film Engine | `GetItemListInTrack`, `GetStart/GetEnd`, `GetLeftOffset`, `GetMarkers`, clip customData | new `/film/cuts/:id/sync-from-resolve` with a diff preview | L |
| 7 | Composite layers: call the existing reviewed import (`resolve-layer-import.py` logic, ported to JS) | as in the existing helper | existing package | M |

Phase 1 is features 1–3, which replace today's launch-and-script path. Phase 2 is 4–5. Phase 3 is 6–7.

## Risks and open questions

- **Studio only:** the free version keeps the existing XML and script path, so we keep it as the fallback.
- **API gaps:** there is no event for "timeline changed", so the panel polls while it's focused. Confirm the take-selector and customData APIs in 21.1's scripting README before planning feature 5.
- **Long calls:** renders and imports block. Use the promise API throughout; the 20.1 fix for modal dialogs matters here.
- **Install and updates:** needs a signed pkg (macOS) and an installer (Windows) because the folder needs admin rights. Auto-update checks a version endpoint; never update silently mid-edit.
- **Testing:** never drive the user's real Resolve in tests (see memory). Unit-test the pure modules, Runway style. Live checks need a scratch project and the user's say-so.
- **Undo:** Resolve has no undo through scripting, so every write is additive (a new timeline version, or the clip kept on the track above) and the round trip writes only after the diff is approved.

## Acceptance for phase 1

- With Studio open, Workflow Integrations › Film Engine pairs with the running backend and lists the active project's scenes and shots.
- "Send cut" builds the same timeline the XML path builds today: same clip order, durations, markers and fps. This is checked by reading the timeline back through the API and comparing it to `planResolve`.
- With the free version, or with the panel absent, the existing send-to-Resolve path still works unchanged.
