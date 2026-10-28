# Golden vectors — the manifest→/prompt contract

Each case is a pair:
- `<case>.inputs.json` — what Film Engine passes (prompt, seed, images[], audio[], options{})
- `<case>.expected.json` — the patched ComfyUI `/prompt` graph BOTH implementations must produce

Both sides must agree byte-for-byte (after JSON normalisation):
- **PC side:** `python scripts/test_fixtures.py` runs `apply_manifest` and asserts equality.
- **Film Engine side:** point `buildPrompt` at the same `*.inputs.json` and assert it equals
  `*.expected.json`.

Regenerate (only when the contract intentionally changes) with `python scripts/gen_fixtures.py`,
which re-asserts the invariants before freezing.

## Invariants the vectors pin (the contract)
1. `prompt` → node 138 `value`; `seed` → node 129 `noise_seed`.
2. Each option (aspect/duration/quality/color) sets BOTH `choice` (label) AND `index` on its
   CustomCombo. Index is mandatory — the math nodes read it; a label-only write is silently ignored.
3. Images/audio are PACKED (storyboard first, no gaps). The k provided files map onto the first k
   slot loaders in order; unused loaders are removed; `ref_images.ref_image_0..k-1` /
   `ref_audios.ref_audio_0..k-1` are contiguous.
4. Tags are POSITIONAL: `<Picture N>` == `ref_image_(N-1)`, `<Audio N>` == `ref_audio_(N-1)`,
   numbered by provided order — NOT by the slot's role/label.

## Cases
- `draft_min` — storyboard only, no dialogue, default options (the shipped 480p 5 s draft): 31 nodes.
- `partial` — storyboard + 2 refs + 1 dialogue, duration=8 s: 34 nodes.
- `full` — all 6 images + 3 dialogue, all options non-default: 39 nodes.
