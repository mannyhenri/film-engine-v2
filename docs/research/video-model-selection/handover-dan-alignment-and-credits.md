# Handover: matching Dan's selector, the full Higgsfield app list, exact credit prices (2026-10-14)

Written for whoever finishes the recommender work (a Codex session was editing the same files when this was
written, so no code here touches `model-recommender.js`, `video-model-facts.js`, the studio routes or the
Generate tab). Everything below is evidence plus the rules to implement.

## 1. Dan's logic, decoded from 63 prompts

Inputs: the 18 original scenarios, 34 single-factor probes (`selector-comparison/probes.json`; one more, 1:1,
is refused by his API with "Choose a valid duration and aspect ratio") and 12 held-back prompts
(`selector-comparison/holdout.json`). Raw answers: `selector-comparison/dan/*.json`. His server answers with
model `jev-1.13.0`, rules v20, `relative_fit_v2`.

**How his page orders the list** (from his `page.js`): cards whose length range does not fit the shot are
hidden; blocked cards are hidden; cards flagged `noAdvantage` go after all others; the rest are sorted by
`fitScore` (0–10), not by the probability share. Our earlier comparison sorted by probability, which put Gemini
and Flux in his top 5 too often. Re-read his answers this way.

**His fit scores are almost a fixed order.** Across 63 prompts:

| Model | Usual fitScore | Notes |
|---|---|---|
| Seedance 2.5 | 10 | 10 on 58 of 63; the other 5 are the three 2D anime/cartoon prompts (9) and the two 3s shots it cannot make |
| Seedance 2.0 | 9 | |
| Wan 3.0 | 8 | sometimes flagged noAdvantage, which drops it below Kling in his display |
| Kling 3.0 Omni (O3) | 7 | |
| Flux 3 | 7 | flagged noAdvantage, except with spoken lines |
| Gemini Omni Flash 1.1 | 6–7 | flagged noAdvantage |
| MiniMax H3 | 1–7 | flagged noAdvantage, except 2D anime/cartoon |
| Kling 3.0 | **0 always** | reason "No specific reason returned. Evaluate again to retry." A bug on his side, not a judgement. Because it is not flagged noAdvantage, his page still shows it 5th. |

**What changes the order (and nothing else did):**

1. **2D anime / flat 2D cartoon** (anime, cel-shaded, "2D cartoon for kids"): H3 10, Seedance 2.5 9, Seedance 2.0 7,
   then Kling 3.0, then Wan, Kling O3, Flux, Gemini (noAdvantage). Not triggered by Pixar/3D, claymation,
   watercolour, pixel art or a body transformation: those keep the default order.
2. **Spoken lines** (quoted dialogue, "argue", "talks to the camera", "explains: ..."): Flux 3 loses noAdvantage and
   moves to 3rd (6 of the 8 dialogue prompts); Kling O3 and H3 drop to 5 (noAdvantage); Wan often becomes noAdvantage.
   On-screen text in quotes ("reads \"OPEN\"", a title card) is *not* dialogue for him (`dialogue: none`).
3. **Shot length:** models whose min/max does not cover the duration are hidden (3s: Seedance, H3, Flux gone;
   20–25s: only Seedance 2.5, Wan, Flux). His limits: Seedance 2.5 4–30, Seedance 2.0 4–15, Wan 2–30,
   Kling/O3 3–15, H3 5–15, Gemini 3–10, Flux 5–20.

**What does NOT change his order:** resolution (480p → 4K: same order, Seedance 2.5 first even at 4K, which it
cannot make), aspect (9:16 same), action, physics/liquid, crowds, product, logos/text, camera moves, horror,
sports, timelapse, animals, fashion, food, music video, noir, VFX.

## 2. The rules to implement (match him, except where noted)

Base order (shared models): Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling O3 > Kling 3.0 > Flux 3 > Gemini Omni
Flash 1.1 > MiniMax H3, with gaps large enough that the other traits only break ties. A starting point that
reproduces every case above (raw points before the fit curve):

| Family | Base | 2D anime | Spoken lines |
|---|---|---|---|
| seedance-2-5 | 92 | 0 | +2 |
| seedance-2 | 89 | −1 | +2 |
| wan-3 / wan-3-prime | 85 / 86 | −6 | 0 |
| kling-o3 | 82 | −4 | −4 |
| kling-3 | 81 | 0 | +5 |
| flux-3 | 80 | −3 | +7 |
| gemini-omni (1.1) | 79 | −10 | no generated sound: −18 |
| minimax-h3 | 75 | **+20** | no generated sound: −18 |

Apply the anime and spoken-line points unscaled (the current code divides trait points by √n, which let a
second trait cancel the dialogue shift). Keep every other trait as a small tie-breaker: about a quarter of
today's weights, which also keeps the card reasons.

Models Dan does not rank (we place them from our research; none should outrank Seedance 2.0 without a trait
that favours it): Cinema Studio 4.0 84 (Seedance 2.5 engine; +camera moves), Veo 3.1 83 (+spoken lines),
Cinema Studio 3.5 77, Cinema Studio 3.0 76, Seedance 2.0 Mini 76, Veo 3 76, Gemini Omni Flash (1.0) 74,
Kling 3.0 Turbo 74, Happy Horse 72, Seedance 1.5 Pro 72, Veo 3.1 Lite 71, Wan 2.7 71, MiniMax H3 Max 70
(+anime), Kling 2.6 70, Grok Video 1.5 70, Hailuo 68, Cinema Studio v2 68, Wan 2.6 66, Grok 1.5 Lite 62,
Cinema Studio v1 62, Grok Video 58.

**Where to differ from Dan, deliberately:**
- **4K:** keep the penalty for a model that cannot reach the asked resolution (Seedance 2.5 tops out at 1080p),
  so a 4K shot goes to Seedance 2.0. Dan ignores resolution.
- **Kling 3.0:** do not copy his 0. Place it just under Kling O3.

**Prompt-reading fixes (our bugs, all confirmed by his answers):**
- Quoted words are dialogue only after a speech verb or a speaker ("says", "whispers", "answers", "NAME:"),
  not after "reads", "reading", "text", "words", "title", "sign".
- Legible text: add "on screen", "reads", "reading", "title card", "the words", "neon sign".
- Faces up close: drop the bare "eyes"; require a person near "close-up" (face, woman, man, child, actor, her, his).
- Split "stylized": a 2D anime trait (anime, manga, cel-shaded, 2D cartoon/animation) that triggers the H3 shift,
  and a 3D/stylized trait (Pixar, 3D animation, claymation, stop-motion, watercolour, pixel art) that does not.
- Length: hide models whose minimum is above the shot (Dan does). The "renders 4s, trim to 3s" card can stay as
  a note under the hidden list.

**Set-based test to prove it:** keep Dan's 63 saved answers as a fixture. For every one, rank with our
recommender, map to his ids (Wan Prime → wan, Kling O3 image-ref → kling-omni, Kling 3.0 → kling), order his
cards the way his page does, and assert: same #1 on every prompt except the listed deliberate differences
(4K, 3s insert where his choice is a noAdvantage tie), and the same set in the top 4. Then run the 12 held-back
prompts, which were not used to set the numbers above.

## 3. Every video model in Higgsfield's app

`models_explore {action: "list", type: "video"}` lists 57 entries (`higgsfield-app/models-explore-video.json`).
31 are shot generators; 26 are tools or ad workflows (upscalers, background removal, dubbing, lip-sync, Genjutsu,
motion transfer, video edit, reframe, Clipify, presets, Marketing Studio, Ad Multiplier, Draw-to-video), each with
its reason in `backend/tests/refresh-higgsfield-app-catalog.js`.

Higgsfield is a manual provider here (`lib/manual-generation.js`): the director generates in Higgsfield's app,
so the app list is the one to rank. It includes models the API does not carry: Veo 3, Veo 3.1, Veo 3.1 Lite,
Gemini Omni Flash and 1.1, Flux 3, Seedance 2.0 Mini, Seedance 1.5 Pro, MiniMax H3 Max, Grok 1.5 Lite, Grok Video,
Happy Horse, Cinema Studio v1/v2/3.0/3.5. For those, the send button should open
`https://higgsfield.ai/ai/video?model=<id>` with the prompt copied (Dan's page links them the same way).
Conversely, LTX 2.5, PixVerse V6, Kling 2.5 Turbo and Kling O1 are API-only and are not in the app.

Our API contract (`providers/higgsfield-models.json`) was checked against the live docs today: the same 67 video
endpoints, no schema changed.

## 4. Costs: exact Higgsfield quotes

131 cost quotes from `generate_video {..., get_cost: true}` (submits nothing, spends nothing):
`higgsfield-app/cost-quotes.jsonl`. Every model was quoted at two lengths at least once. Price is linear in length
for all of them except Hailuo and Cinema Studio v1 (priced per length). Two Hailuo settings (512p, and 1080p at
10s) return a 500 from Higgsfield's estimator.

Credits are per second unless a length is given. Default sound setting unless marked.

| Model (app name) | App id | Length | API model | Credits |
|---|---|---|---|---|
| Seedance 2.5 | `seedance_2_5` | 4–30s | seedance-2-5 | 1080p: 16/s; 1080p (no sound): 16/s; 480p: 3/s; 720p: 7/s |
| Seedance 2.0 | `seedance_2_0` | 4–15s | seedance-2 | std,480p: 3/s; std,720p: 4.5/s; std,1080p: 12/s; std,1080p (no sound): 12/s; std,4k: 22/s; fast,1080p: 2.5/s; fast,720p: 2.5/s |
| Seedance 2.0 Mini | `seedance_2_0_mini` | 4–15s | app only | 480p: 0.5/s; 720p: 1/s |
| Seedance 1.5 Pro | `seedance1_5` | 4–12s | app only | 480p: 0.6/s; 720p: 1.2/s; 1080p: 3/s; 1080p (no sound): 3/s |
| Wan 3.0 | `wan3_0` | 2–30s | wan-3 | 480p: 1/s; 720p: 1.75/s; 1080p: 3.5/s; 1080p (no sound): 3.5/s |
| Wan 3.0 Prime | `wan3_0_prime` | 2–30s | wan-3-prime | 480p: 1.5/s; 720p: 3/s; 1080p: 6/s |
| Wan 2.7 | `wan2_7` | 2–15s | wan-2-7 | 720p: 1.5/s; 1080p: 2.5/s |
| Wan 2.6 Video | `wan2_6` | 5–15s | wan-2-6 | 720p: 1.5/s; 1080p: 2/s |
| Kling v3.0 | `kling3_0` | 3–15s | kling-3-standard, kling-3-pro, kling-3-4k | std: 2/s; std (no sound): 1.5/s; pro: 2.5/s; pro (no sound): 1.75/s; 4k: 6/s; 4k (no sound): 6/s |
| Kling 3.0 Turbo | `kling3_0_turbo` | 3–15s | kling-3-turbo | 720p: 1.5/s; 1080p: 2/s |
| Kling 3.0 Omni | `kling_o3_image_reference` | 3–15s | kling-o3 | std: 1.25/s; std (no sound): 1/s; pro: 2/s; pro (no sound): 1.5/s; 4k: 6/s; 4k (no sound): 6/s |
| Kling 3.0 Omni (Frames) | `kling_o3_flf` | 3–15s | kling-o3 | pro: 1.8/s; std: 1.25/s; 4k: 6/s |
| Kling 2.6 Video | `kling2_6` | 5–10s | kling-2-6-pro | default: 2/s; default (no sound): 1/s |
| MiniMax H3 | `minimax_h3` | 4–15s | minimax-h3 | 2K: 2/s |
| MiniMax H3 Max | `minimax_h3_max` | 5–15s | app only | 480p: 1.5/s; 768p: 2.5/s |
| Minimax Hailuo | `minimax_hailuo` | 6–10s | hailuo-2-3-standard | 768,minimax-2.3: 6 for 6s, 11 for 10s; 1080,minimax-2.3: 10 for 6s; 768,minimax-2.3-fast: 4 for 6s; 768,minimax: 6 for 6s; 1080,minimax-2.3-fast: 7 for 6s |
| FLUX 3 Video | `flux_3_video` | 5–20s | app only | 720p: 5.5/s; 720p (no sound): 5.5/s; 1080p: 9/s |
| Gemini Omni Flash 1.1 | `gemini_omni_flash_1_1` | 3–10s | app only | 360p: 1/s; 720p: 3/s; 1080p: 4.5/s; 4k: 9/s |
| Gemini Omni Flash | `gemini_omni` | 4–10s | app only | 720p: 3/s |
| Google Veo 3.1 | `veo3_1` | 4–8s | app only | basic,veo-3-1-fast: 4/s; basic,veo-3-1-preview: 10/s; high,veo-3-1-fast: 4/s; ultra,veo-3-1-fast: 9/s; ultra,veo-3-1-preview: 15/s; high,veo-3-1-preview: 10/s |
| Google Veo 3.1 Lite | `veo3_1_lite` | 4–8s | app only | default (no sound): 1.5/s; default: 1.5/s |
| Google Veo 3 | `veo3` | 8–8s | app only | veo-3-fast: 22 for 8s; veo-3-preview: 58 for 8s |
| Grok Video 1.5 | `grok_video_v15` | 2–15s | grok-video-1-5 | 480p: 2.5/s; 720p: 4.5/s; 1080p: 8/s |
| Grok Imagine Video 1.5 Lite | `grok_video_v15_lite` | 1–15s | app only | 720p: 1/s; 1080p: 4/s; 480p: 1/s |
| Grok Video | `grok_video` | 1–15s | app only | default: 1.5/s |
| Happy Horse Video | `happy_horse_video` | 3–15s | app only | 720p: 2.5/s; 1080p: 4.5/s |
| Cinema Studio 4.0 | `cinematic_studio_video_4_0` | 4–30s | cinema-studio-4 | 720p: 7/s; 480p: 3/s; 1080p: 16/s |
| Cinematic Studio Video 3.5 | `cinematic_studio_video_3_5` | 4–15s | app only | 720p (no sound): 5/s; 480p (no sound): 3.5/s; 1080p: 13/s |
| Cinema Studio Video 3.0 | `cinematic_studio_3_0` | 4–15s | app only | 720p (no sound): 5/s; 720p: 5/s; 4k: 24/s; 480p (no sound): 3.5/s; 1080p (no sound): 13/s |
| Cinema Studio Video (v2) | `cinematic_studio_video_v2` | 3–12s | app only | std: 1.5/s; pro: 2/s |
| Cinema Studio Video (v1) | `cinematic_studio_video` | 5–10s | app only | default: 8 for 5s, 18 for 10s |

**In dollars:** a credit is about $0.033 on the Ultra plan ($99 for 3,000 a month) and $0.053–0.059 on top-ups.

**What changed against what we show today** (`provider-pricing.js` `higgsfield:video`, a flat $/s per model):
- **Seedance 2.5 at 1080p is 16 credits/s** (Dan's table and your 9–12 Oct charges said 12: Higgsfield has raised
  it). A 10s 1080p clip is 160 credits, $5.28 on Ultra; we show $0.74.
- **Seedance 2.0 at 1080p is 12/s** ($0.40/s on Ultra), not our $0.93/s; at 4K it is 22/s.
- **Kling 3.0 Pro is 2.5/s with sound, 1.75/s without** (Dan: 2); Standard 2 / 1.5; 4K 6.
- **Kling O3** is 1.25 / 2 / 6 per s (720p / 1080p / 4K), with sound; 1 / 1.5 / 6 without.
- **Wan 3.0** 1 / 1.75 / 3.5; **Wan 3.0 Prime** 1.5 / 3 / 6 (we priced Prime at the $0.112 stand-in).
- **MiniMax H3** 2/s at 2K: close to what we show.
- **Cinema Studio 4.0** costs exactly what Seedance 2.5 costs (3 / 7 / 16).
- **Sound is free** on Seedance, Wan, Flux and Cinema Studio 3.0; it costs extra only on Kling.

**Where the price should be computed:** credits per second for the chosen resolution and sound, times the length
the model will render, times the plan's credit price. Show credits first (they are exact), dollars second (they
depend on how you buy credits). The final request review (`final-request-review.js`, and
`describeVideoRequest` in `providers/higgsfield.js`) should price the same way, keyed by model, resolution and
sound, instead of the flat rate.

## 5. Files from this session (untracked)

- `docs/research/video-model-selection/higgsfield-app/`: the app listing and the 131 quotes (evidence).
- `docs/research/video-model-selection/selector-comparison/`: probes, holdout and all of Dan's raw answers.
- `backend/tests/refresh-higgsfield-app-catalog.js` builds `backend/lib/providers/higgsfield-app-models.json`
  from that evidence (31 models, 26 exclusions with reasons, per-setting credit rates derived from the quotes).
- `backend/lib/higgsfield-app-catalog.js` reads that snapshot: facts per app model, `priceFor(id, {duration_s,
  resolution, audio})`, `priceApiRequest(apiId, body, seconds)`, the API model for each app model. Nothing imports
  it yet. Use it, or fold the snapshot into the Codex session's `higgsfield-credit-quotes.json`; or delete both.

## 6. Checks run on the Codex version (state at 23:19, 2026-10-14)

**Against Dan (63 saved answers):** same first pick on 60 of 63, top-5 overlap 3.95 on average, rank agreement
0.82. The three misses are two bugs:
- `short-insert` and `p-plain-3s` (3s shots): models whose **minimum** is longer than the shot are not hidden
  (only the maximum is checked), so Seedance 2.5 (4s minimum) comes first. Dan hides it.
- `p-3dcartoon` ("3D animated cartoon"): the anime test in `selectorPreference` matches "cartoon", so H3 wins.
  Exclude 3D/Pixar/claymation from it.

Not counted as misses, but note: at 4K Seedance 2.5 still comes first (as Dan), though it cannot make 4K.

**Against Higgsfield's own quotes:** `websiteCost` (lib/higgsfield-cost.js) disagrees with Higgsfield on 43 of 95
comparable quotes. Two causes:
- A sample quote at one length is reused for another when linearity is not proven *in that file*, e.g. Wan 3.0
  Prime 1080p 10s shows 30 credits, Higgsfield quotes 60; Cinema Studio 4.0 1080p 10s shows 80, quote 160.
- Kling's tier (std / pro / 4k) is not part of the lookup: Kling 3.0 at 4K 5s shows 10, quote 30; Kling O3 at
  1080p shows 6.25, quote 10.

`backend/lib/higgsfield-app-catalog.js` `priceFor(appId, {duration_s, resolution, audio})` reproduces all 131
quotes (each model's per-second rate checked at two lengths; Kling tiers keyed by resolution; Hailuo and Cinema
Studio v1 priced per length). Using it inside `websiteCost` was tried and reverted (it changes the result shape
one parity test reads), so it is left for whoever owns that file.

How to re-run the Dan check: in `selector-comparison/`, `SETS=scenarios,probes,holdout node run.cjs` (ranks every
prompt with the current recommender; it calls Dan's site only for a prompt with no saved answer) then
`SETS=scenarios,probes,holdout node compare.cjs`. The cost check: price every line of
`higgsfield-app/cost-quotes.jsonl` through the card's cost function and expect an exact match.
