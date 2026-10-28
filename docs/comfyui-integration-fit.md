# Film Engine ⇄ ComfyUI PC: does it fit?

Verification of confer 609bedc0 (confer f53c0d64, 2026-10-28). Film Engine is `film-engine-v2` on branch
`feat/manual-generation-handoff`; the PC side is `GRIDLIGHT-INC/comfyui-connector` @ `d6ca197`
(`confer/comfyui-storyboard-integration`). The PC's contract files are copied, unchanged, into
`backend/tests/fixtures/comfyui/` and checked by `backend/tests/comfyui-contract.test.js`.

**When the contract changes, copy the PC's files in again.** That is the workflow, the manifest and the golden cases. The copy is frozen: a changed workflow deployed to the PC would pass this test and still break the app. The app does guard against it: `listWorkflows()` runs `validate()` against the live files, and any mismatch shows the workflow as not ready, with the reason.

## Contracts, side by side

| # | Contract | PC side | Film Engine side | Fit |
|---|---|---|---|---|
| 1 | Manifest shape | `comfy-workflows/storyboard_shot_to_video.fe.json` | `backend/lib/comfyui.js` `validate()`, `listWorkflows()`, `buildPrompt()` | **Fits.** Every key Film Engine reads (`prompt`, `seed`, `images[]`, `audio[]`, `options[]` enum with `index`, `outputs.node`, `core_node`, `ref_wiring.*.core_input_prefix`, `draft`) is present and well formed (contract test). Film Engine ignores the documentation keys (`slot`, `label`, `tag`, `slot_rule`, `combo_write_rule`, `derived`, `engine`). |
| 2 | Patched `/prompt` graph | `scripts/apply_manifest.py`, `comfy-workflows/fixtures/*.expected.json` | `buildPrompt()` | **Fits.** All 3 golden cases (`draft_min`, `partial`, `full`) are identical after key sorting. |
| 3 | Where workflows live | deployed to `user/default/workflows/film-engine/` | `DIR = 'workflows/film-engine'`, `GET /userdata?dir=…`, `GET /userdata/<encoded path>` | **Fits.** The live PC lists both files, the deployed `.fe.json` is byte-identical to the repo copy, and the deployed graph is the same JSON. |
| 4 | Input files | `LoadImage` / `LoadAudio` read names from `input/` | `upload()`: `POST /upload/image`, subfolder `film-engine`, name `<sha1-12>-<file name>` | **Fits.** Nothing on the PC keys on file names (confirmed by the PC agent), and the 1B run's files are in `input/film-engine/`, where ComfyUI renders from them. If the PC loses a file sent earlier in the session (its input folder cleaned), Film Engine sends it again and queues once more (tested). Uploads are never cleaned on the PC; pruning old files there is safe because every name is content-addressed. |
| 5 | Output | `SaveVideo` node 92, prefix `ComfyUI Videos/shot` | `filesOf()` takes any `{filename, subfolder, type}` under `outputs["92"]`, fetched through `/view` | **Fits.** The PC agent checked ComfyUI 0.43.1's source: `SaveVideo` reports `{images: [{filename, subfolder, type}], animated: [true]}` (`comfy_api/latest/_ui.py`, `PreviewVideo.as_dict`). `filesOf()` reads that `images` array and skips `animated`. The real file hasn't been fetched yet (row 9). |
| 6 | Network | portproxy `0.0.0.0:8188 → 127.0.0.1:8188`, firewall allowing 192.168.4.40, Private profile | `DEFAULT_URL http://192.168.4.60:8188`, Settings `comfyui_url`, `FILM_COMFYUI_URL` | **Fits today. Fragile:** both addresses come from DHCP. If the Mac's address changes, the firewall drops it; if the PC's changes, Film Engine's default is wrong. Fix: reserve both addresses on the router, and set the PC's address in Settings › `comfyui_url` instead of relying on the default written in the code. |
| 7 | Progress | ComfyUI's own `/ws?clientId=` | `listen()` (client id = the Film Engine job id) | **Fits.** It is ComfyUI's stock protocol. Tested against a fake; the real run's socket connected. |
| 8 | Draft defaults | manifest `draft`: aspect 0, duration 0 (5 s), quality 0 (turbo), colour 0 | `ComfyPanel.jsx` `defaultChoices()` | **Was a misfit, now fixed.** Film Engine picked the shortest length covering the shot (1B: 15 s, about 90 min on the Arc) and ignored `draft`. It now starts on the manifest's draft preset (5 s) and the Length hint says when that is shorter than the shot. |
| 9 | Real end to end | the Arc renders it | job → download → filed as the shot's next `video_raw` version | **Fits, proven on the real PC.** Shot 1B of The Glass Harbour went from Film Engine to the PC and back:
- the 4 full-size pictures and the 15 s dialogue WAV were uploaded;
- the job was queued (`d1f33564`), generated in 5,443 s on the Arc and downloaded;
- the take was filed as the shot's version 1 (`video_raw`, provider `comfyui`, with the seed and options recorded).

The file is H.264 864×480 at 24 fps, 15.08 s, with stereo AAC sound at a mean of -19.6 dB. The opening frames follow the storyboard: Ray on the left, June on the right, the harbour behind them. After that the model cuts to close-ups of June on its own, where the direction asked for a slow push-in; that is a prompt/model issue, not an integration one. The run used a copy of the database and a scratch project folder. |

## Tests run

- `node --test tests/comfyui-contract.test.js tests/comfyui.test.js tests/comfyui-shot.test.js` (Node 23): 23 pass, 0 fail.
- `npx vitest run src/pages/productiongraph/studio/ComfyPanel.test.jsx`: 7 pass.
- Full backend suite, `node --test --test-concurrency=4 tests/*.test.js` (Node 23), measured before the `-nostdin` fix: 5,228 tests, 4,946 pass, 277 fail, 5 skipped. The failures are in 118 files.
  - None of the failures are in the ComfyUI files.
  - Three of the failing files sit near this work: `direct-shot-ui`, `director-controls` and `seedance-post`. Each fails on files this work never changed (`src/index.html`, `routes/voice.js`, `lib/providers/seedance.js`), so they were already failing.
  - `ffmpeg-stdin` flagged 4 new calls without `-nostdin` (`lib/comfyui-shot.js` and its test). They are fixed, and that test now lists only older calls.
- PC side, as reported: `validate_workflow.py` PASS (39 nodes), `test_apply_manifest.py` PASS, `test_fixtures.py` PASS 3/3.

## Re-verified (confer dbfde0d2, 19:10)

Run on Film Engine `ee5d00f` and the PC's `a0bc52f`:
- **Contract files:** all 9 PC files at `a0bc52f` (the workflow, the manifest, `CONTRACT.md` and the 6 golden-case files) are byte-identical to `backend/tests/fixtures/comfyui/`, so the contract hasn't moved since `d6ca197`. The deployed `.fe.json` on the PC is byte-identical too.
- **Live PC:** `listWorkflows()` shows `storyboard_shot_to_video` as ready with no problems; draft `{aspect 0, duration 0, quality 0, color 0}`.
- **Film Engine's ComfyUI tests:** `node --test tests/comfyui-contract.test.js tests/comfyui.test.js tests/comfyui-shot.test.js`: 23 pass, 0 fail.
- **Studio screen tests:** `npx vitest run src/pages/productiongraph/studio/`: 5 files, 71 tests pass.
- **`ffmpeg-stdin`:** lists no ComfyUI calls.
- **Row 9:** the real 1B take landed at 19:14 and was filed as version 1. It is proven; see the table.
- **Deployed graph:** the workflow graph on the PC is the same JSON as the test copy (re-compared).
- **New test:** every job field the My PC panel reads (worked out from `ComfyPanel.jsx`) is one `publicJob()` sends, for a running take and a finished one. This is the seam between the panel's hand-made test jobs and the server. Film Engine's ComfyUI tests now pass 24 of 24.
- **To try it in the app:** restart the dev app. The backend that was running then started at 18:04, before the progress and review fixes; the screen code reloads by itself, but the backend doesn't.

## Blocked and never resolved

- **The PC agent's outbound messaging.** There is no `~/.neoncore/token` on the PC, so it answered through `STATUS.md` and its transcript the whole time. Its done signals used the LAN API without auth.
- **Speed.** MiniMax H3's int8/nvfp4 weights are emulated on the Intel Arc (about 18 min per step), and no bf16/fp8 build exists. This is not an integration gap, but it decides the default (row 8).
- ~~Row 9's last step~~ closed: the 1B take was filed at 19:14.

## Verdict

**It fits, end to end on the real machines.** Both sides implement the same contract, file for file, and the golden cases prove the patched graph is identical. A real storyboard shot went from Film Engine to the PC and back, and was filed as the shot's version. There was one misfit, the draft default (row 8), and it is fixed. One thing is open, and it isn't a misfit: the DHCP addresses behind the firewall rule (row 6).
