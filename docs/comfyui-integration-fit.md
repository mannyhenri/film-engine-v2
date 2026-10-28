# Film Engine ⇄ ComfyUI PC: does it fit?

Verification of confer 609bedc0 (confer f53c0d64, 2026-10-28). Film Engine is `film-engine-v2` on branch
`feat/manual-generation-handoff`; the PC side is `GRIDLIGHT-INC/comfyui-connector` @ `d6ca197`
(`confer/comfyui-storyboard-integration`). The PC's contract files are copied, unchanged, into
`backend/tests/fixtures/comfyui/` and checked by `backend/tests/comfyui-contract.test.js`.

## Contracts, side by side

| # | Contract | PC side | Film Engine side | Fit |
|---|---|---|---|---|
| 1 | Manifest shape | `comfy-workflows/storyboard_shot_to_video.fe.json` | `backend/lib/comfyui.js` `validate()`, `listWorkflows()`, `buildPrompt()` | **Fits.** Every key Film Engine reads (`prompt`, `seed`, `images[]`, `audio[]`, `options[]` enum with `index`, `outputs.node`, `core_node`, `ref_wiring.*.core_input_prefix`, `draft`) is present and well formed (contract test). Film Engine ignores the documentation keys (`slot`, `label`, `tag`, `slot_rule`, `combo_write_rule`, `derived`, `engine`). |
| 2 | Patched `/prompt` graph | `scripts/apply_manifest.py`, `comfy-workflows/fixtures/*.expected.json` | `buildPrompt()` | **Fits.** All 3 golden cases (`draft_min`, `partial`, `full`) are identical after key sorting. |
| 3 | Where workflows live | deployed to `user/default/workflows/film-engine/` | `DIR = 'workflows/film-engine'`, `GET /userdata?dir=…`, `GET /userdata/<encoded path>` | **Fits.** The live PC lists both files, the deployed `.fe.json` is byte-identical to the repo copy, and the deployed graph is the same JSON. |
| 4 | Input files | `LoadImage` / `LoadAudio` read names from `input/` | `upload()`: `POST /upload/image`, subfolder `film-engine`, name `<sha1-12>-<file name>` | **Fits.** Nothing on the PC keys on file names (confirmed by the PC agent). |
| 5 | Output | `SaveVideo` node 92, prefix `ComfyUI Videos/shot` | `filesOf()` takes any `{filename, subfolder, type}` under `outputs["92"]`, fetched through `/view` | **Fits on paper.** Not yet proven on the real PC: see row 9. |
| 6 | Network | portproxy `0.0.0.0:8188 → 127.0.0.1:8188`, firewall allowing 192.168.4.40, Private profile | `DEFAULT_URL http://192.168.4.60:8188`, Settings `comfyui_url`, `FILM_COMFYUI_URL` | **Fits today. Fragile:** both addresses come from DHCP. If the Mac's address changes, the firewall drops it; if the PC's changes, Film Engine's default is wrong. Fix: reserve both addresses on the router. |
| 7 | Progress | ComfyUI's own `/ws?clientId=` | `listen()` (client id = the Film Engine job id) | **Fits.** It is ComfyUI's stock protocol. Tested against a fake; the real run's socket connected. |
| 8 | Draft defaults | manifest `draft`: aspect 0, duration 0 (5 s), quality 0 (turbo), colour 0 | `ComfyPanel.jsx` `defaultChoices()` | **Was a misfit, now fixed.** Film Engine picked the shortest length covering the shot (1B: 15 s, about 90 min on the Arc) and ignored `draft`. It now starts on the manifest's draft preset (5 s) and the Length hint says when that is shorter than the shot. |
| 9 | Real end to end | the Arc renders it | job → download → filed as the shot's next `video_raw` version | **Partly proven.** Shot 1B (4 pictures, a 15 s WAV) was uploaded, accepted, its models loaded and sampling ran (PC log: `1/4 [18:14<54:44]`). When this was written, the render, download and filing were still to finish. |

## Tests run

- `node --test tests/comfyui-contract.test.js tests/comfyui.test.js tests/comfyui-shot.test.js` (Node 23): 22 pass, 0 fail.
- `npx vitest run src/pages/productiongraph/studio/ComfyPanel.test.jsx`: 7 pass.
- Full backend suite, `node --test --test-concurrency=4 tests/*.test.js` (Node 23): 5,228 tests, 4,946 pass, 277 fail, 5 skipped. The failures are in 118 files.
  - None of the failures are in the ComfyUI files.
  - Three of the failing files sit near this work: `direct-shot-ui`, `director-controls` and `seedance-post`. Each fails on files this work never changed (`src/index.html`, `routes/voice.js`, `lib/providers/seedance.js`), so they were already failing.
  - `ffmpeg-stdin` flagged 4 new calls without `-nostdin` (`lib/comfyui-shot.js` and its test). They are fixed, and that test now lists only older calls.
- PC side, as reported: `validate_workflow.py` PASS (39 nodes), `test_apply_manifest.py` PASS, `test_fixtures.py` PASS 3/3.

## Blocked and never resolved

- **The PC agent's outbound messaging.** There is no `~/.neoncore/token` on the PC, so it answered through `STATUS.md` and its transcript the whole time. Its done signals used the LAN API without auth.
- **Speed.** MiniMax H3's int8/nvfp4 weights are emulated on the Intel Arc (about 18 min per step), and no bf16/fp8 build exists. This is not an integration gap, but it decides the default (row 8).
- **Row 9's end.** The first real take hasn't been filed yet.

## Verdict

**It fits.** The contract both sides implement is the same, file for file, and the golden cases prove the patched graph is identical. There was one misfit, the draft default (row 8), and it is fixed. Two things are open, and neither is a misfit:
- the real run's download and filing (row 9);
- the DHCP addresses behind the firewall rule (row 6).
