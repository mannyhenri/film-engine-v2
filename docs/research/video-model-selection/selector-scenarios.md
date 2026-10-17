# AI Video Model Selector — scenario runs (2026-10-14)

Tool: https://ai-video-model-selector.vercel.app/ (Dan Kieft; header shows "Jev"). 8 Evaluate runs, ~1 min apart, no sign-in, no Generate clicks.
Page state: Duration slider 2–30s (default 7s), Aspect only "16:9 · Landscape" / "9:16 · Portrait" (NO 1:1), Resolution 480p/720p/1080p/4K (default 720p).
Model roster (idle cards): Seedance 2.5 (ByteDance, 1080p max, 4–30s); Kling 3.0 (Kuaishou, 1080p max, 3–15s); Kling 3.0 Omni (Kuaishou, 4K max, 3–15s); MiniMax H3 (2K max, 5–15s); Seedance 2.0 (ByteDance, 4K max, 4–15s); Gemini Omni Flash 1.1 (Google, 4K max, 3–10s); Wan 3.0 (1080p max, 2–30s); Flux 3 (Black Forest Labs, 1080p max, 5–20s).
Every result list ends with: "Recommendation share · not a success rate."
"Resolution notes" on cards = just the static "<res> max" + duration-range chips; no per-request resolution warnings were shown in any run.

## Network: POST /api/studio/evaluate (200, application/json, ~0.3–0.4 s)
Request: {"prompt":str,"startFrameId":null,"imageIds":[],"videoIds":[],"videoDurations":[],"duration":int,"aspect":"16:9"|"9:16","resolution":"720p"|"1080p"|...}
Only header: Content-Type: application/json (no auth/cookie needed).
Response:
{ id(uuid), sceneType:str, sceneLabels:[str], workflow:"generate", dialogue:"none"|"substantial"|..., unsupportedReason:null,
  selectionMode:"recommended", providerReceipt:{endpoint:"https://api.typesafe.ai/v1/systemone", status, receivedAt, requestId, platformRequestId},
  providerModel:"jev-1.13.0", rulesVersion:20, scoring:"relative_fit_v2", providerChoice:modelId, choice:modelId, confidence:0..1,
  durationSuggestion:null|{modelId, duration, requestedDuration}, noneProbability:0, elapsed:ms,
  cards:[{id, noAdvantage:bool, fitScore:0..10, probability:0..1, blocked:null|"Supports 3–10s; your shot is 12s.", reason:str}] }
Model ids: seedance (2.5), seedance-2, wan, kling, kling-omni, h3, gemini-omni, flux.
Credits are NOT in the response — computed client-side. (Run 1 happened before I hooked fetch, so its JSON wasn't captured.)


## Run 1
RUN 1 — 5s 16:9 1080p — "Evaluation complete 0.4s"
Workflow tags: Story scene | Brief dialogue | Voice acting
1. Seedance 2.5 (ByteDance) 31% — Jev's pick — 1080p max, 4–30s — "Your top quality pick for this scene." — Generate ≈ 60 credits
2. Seedance 2.0 (ByteDance) 25% — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 45 credits
3. Wan 3.0 (Wan) 19% — Budget pick — 1080p max, 2–30s — "Fits the camera work and cinematic look of this scene." — Est. 18 credits
4. Flux 3 (Black Forest Labs) 15% — 1080p max, 5–20s — "A strong voice-acting option for the delivery and emotion you described." — Est. 45 credits
5. Kling 3.0 Omni (Kuaishou) 8% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 10 credits
6. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 10 credits
7. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "The amount of dialogue favors the Seedance models for this scene." — Est. 10 credits
8. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 23 credits
Footer: "Recommendation share · not a success rate."
Unavailable list: none shown. Duration suggestion: none.

## Run 2
RUN 2 — 8s 16:9 1080p — "Evaluation complete 0.4s"
Workflow tags: Cinematic
1. Seedance 2.5 (ByteDance) 33% — Jev's pick — 1080p max, 4–30s — "The coordinated action makes this a good fit for your premium model." — Generate ≈ 96 credits
2. Seedance 2.0 (ByteDance) 27% — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 72 credits
3. Wan 3.0 (Wan) 21% — Budget pick — 1080p max, 2–30s — "Fits the camera work and cinematic look of this scene." — Est. 28 credits
4. Kling 3.0 Omni (Kuaishou) 16% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 16 credits
5. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 16 credits
6. Flux 3 (Black Forest Labs) 1% — 1080p max, 5–20s — "No clear advantage over the stronger choices for this scene." — Est. 72 credits
7. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "The coordinated action and camera moves favor Seedance for this scene." — Est. 16 credits
8. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 36 credits
Unavailable list: none. Duration suggestion: none.
API: request {"prompt":"...","startFrameId":null,"imageIds":[],"videoIds":[],"videoDurations":[],"duration":8,"aspect":"16:9","resolution":"1080p"}
Response top-level: sceneType "Cinematic", sceneLabels ["Cinematic"], workflow "generate", dialogue "none", unsupportedReason null, selectionMode "recommended", providerModel "jev-1.13.0", rulesVersion 20, scoring "relative_fit_v2", providerChoice "seedance", choice "seedance", confidence 0.98, durationSuggestion null, noneProbability 0, elapsed 414
cards [id, fitScore, probability, noAdvantage, blocked]: seedance 10 0.98 0 null | seedance-2 9 0 0 null | wan 8 0.02 0 null | kling-omni 7 0 0 null | kling 0 0 0 null | flux 7 0 1 null | h3 6 0 1 null | gemini-omni 6 0 1 null

## Run 3
RUN 3 — 12s 16:9 1080p — "Evaluation complete 0.3s"
Workflow tags: Story scene
1. Seedance 2.5 (ByteDance) 34% — Jev's pick — 1080p max, 4–30s — "Your top quality pick for this scene." — Generate ≈ 144 credits
2. Seedance 2.0 (ByteDance) 27% — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 108 credits
3. Wan 3.0 (Wan) 21% — Budget pick — 1080p max, 2–30s — "Fits the camera work and cinematic look of this scene." — Est. 42 credits
4. Kling 3.0 Omni (Kuaishou) 16% — 4K max, 3–15s — "Supports the shot changes and reference-led continuity in this scene." — Est. 24 credits
5. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 24 credits
6. Flux 3 (Black Forest Labs) 1% — 1080p max, 5–20s — "No clear advantage over the stronger choices for this scene." — Est. 108 credits
7. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "A lower-priority alternative for this scene; Seedance is the preferred quality choice." — Est. 24 credits
(Gemini Omni Flash 1.1 card simply REMOVED from the UI. No "Unavailable for this request" section rendered anywhere on the page, even after scrolling; the reason exists only in the API: blocked "Supports 3–10s; your shot is 12s.")
Duration suggestion: none (durationSuggestion null).
API top-level: sceneType "Story scene", sceneLabels ["Story scene"], workflow "generate", dialogue "none", confidence 0.87, providerChoice/choice "seedance", elapsed 330
cards [id, fitScore, probability, noAdvantage, blocked]: seedance 10 0.89 0 null | seedance-2 9 0 0 null | wan 8 0.02 0 null | kling-omni 7 0.09 0 null | kling 0 0 0 null | flux 7 0 1 null | h3 5 0 1 null | gemini-omni 0 0 0 "Supports 3–10s; your shot is 12s."

## Run 4
RUN 4 — 25s 16:9 1080p — "Evaluation complete 0.3s"
Workflow tags: B-roll
Duration suggestion banner (above cards): "Shorter option · Kling 3.0 Omni" / "Consider 15s instead of 25s." / button "Use 15s" (not clicked)
1. Seedance 2.5 (ByteDance) 66% — Jev's pick — 1080p max, 4–30s — "A fit for the supporting shot and simple movement you described." — Generate ≈ 300 credits
2. Wan 3.0 (Wan) 34% — Budget pick — 1080p max, 2–30s — "A fit for the supporting shot and simple movement you described." — Est. 88 credits
(All other 6 models hidden; no "Unavailable" list rendered. API blocked reasons:)
  kling: "Supports 3–15s; your shot is 25s."
  kling-omni: "Supports 3–15s; your shot is 25s."
  h3: "Supports 5–15s; your shot is 25s."
  seedance-2: "Supports 4–15s; your shot is 25s."
  gemini-omni: "Supports 3–10s; your shot is 25s."
  flux: "Supports 5–20s; your shot is 25s."
API top-level: sceneType "B-roll", sceneLabels ["B-roll"], workflow "generate", dialogue "none", confidence 0.94, choice "seedance", durationSuggestion {"modelId":"kling-omni","duration":15,"requestedDuration":25}, elapsed 288
cards: seedance 10 0.96 | wan 8 0.04 | all others fitScore 0, blocked as above

## Run 5
RUN 5 — 6s, 1080p — NOTE: 1:1 NOT AVAILABLE. Aspect dropdown offers only "16:9 · Landscape" and "9:16 · Portrait". Ran at 16:9. — "Evaluation complete 0.4s"
Workflow tags: Product video
1. Seedance 2.5 (ByteDance) 33% — Jev's pick — 1080p max, 4–30s — "Your top quality pick for this scene." — Generate ≈ 72 credits
2. Seedance 2.0 (ByteDance) 27% — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 54 credits
3. Wan 3.0 (Wan) 21% — Budget pick — 1080p max, 2–30s — "A strong alternative for the product shot and movement you described." — Est. 21 credits
4. Kling 3.0 Omni (Kuaishou) 16% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 12 credits
5. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 12 credits
6. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 27 credits
7. Flux 3 (Black Forest Labs) 1% — 1080p max, 5–20s — "No clear advantage over the stronger choices for this scene." — Est. 54 credits
8. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "A lower-priority alternative for this scene; Seedance is the preferred quality choice." — Est. 12 credits
Unavailable: none. Duration suggestion: none.
API: sceneType "Product video", dialogue "none", confidence 0.95, choice "seedance"
cards: seedance 10 0.96 0 | seedance-2 9 0 0 | wan 8 0.04 0 | kling-omni 7 0 0 | kling 0 0 0 | gemini-omni 7 0 1 | flux 7 0 1 | h3 1 0 1
(Legible text "NOIR" did not surface any text-rendering-specific reason.)

## Run 6
RUN 6 — 6s 16:9 1080p — "Evaluation complete 0.4s"
Workflow tags: Anime
1. MiniMax H3 (MiniMax) 32% — Jev's pick + Budget pick (both badges) — 2K max, 5–15s — "The preferred specialist for this 2D character animation." — Generate ≈ 12 credits
2. Seedance 2.5 (ByteDance) 26% — 1080p max, 4–30s — "A strong alternative for the dialogue, character interaction and shot changes." — Est. 72 credits
3. Seedance 2.0 (ByteDance) 16% — 4K max, 4–15s — "Another option for this cartoon scene, below Seedance 2.5 in quality." — Est. 54 credits
4. Wan 3.0 (Wan) 16% — 1080p max, 2–30s — "Fits the camera work and cinematic look of this scene." — Est. 21 credits
5. Kling 3.0 Omni (Kuaishou) 8% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 12 credits
6. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 12 credits
7. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 27 credits
8. Flux 3 (Black Forest Labs) 1% — 1080p max, 5–20s — "No clear advantage over the stronger choices for this scene." — Est. 54 credits
Unavailable: none. Duration suggestion: none.
(Note: Seedance 2.5 reason mentions "dialogue" and "shot changes" though the prompt had neither — canned reason text.)
API: sceneType "Anime", dialogue "none", providerChoice/choice "h3", confidence 0.98
cards: h3 10 0.98 0 | seedance 9 0.02 0 | seedance-2 7 0 0 | wan 7 0 0 | kling-omni 5 0 0 | kling 0 0 0 | gemini-omni 6 0 1 | flux 5 0 1

## Run 7
RUN 7 — 5s 16:9 1080p — "Evaluation complete 0.4s"
Workflow tags: Cinematic | Realistic
1. Seedance 2.5 (ByteDance) 42% — Jev's pick — 1080p max, 4–30s — "Your top quality pick for this scene." — Generate ≈ 60 credits
2. Seedance 2.0 (ByteDance) 34% — Budget pick — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 45 credits
3. Kling 3.0 Omni (Kuaishou) 20% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 10 credits
4. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 10 credits
5. Wan 3.0 (Wan) 1% — 1080p max, 2–30s — "No clear advantage over the stronger choices for this scene." — Est. 18 credits
6. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 23 credits
7. Flux 3 (Black Forest Labs) 1% — 1080p max, 5–20s — "No clear advantage over the stronger choices for this scene." — Est. 45 credits
8. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "A lower-priority alternative for this scene; Seedance is the preferred quality choice." — Est. 10 credits
Unavailable: none. Duration suggestion: none.
API: sceneType "Cinematic", sceneLabels ["Cinematic","Realistic"], dialogue "none", confidence 0.99, choice "seedance"
cards: seedance 10 0.99 0 | seedance-2 9 0 0 | kling-omni 7 0 0 | kling 0 0 0 | wan 8 0.01 1(noAdvantage!) | gemini-omni 7 0 1 | flux 7 0 1 | h3 1 0 1
(Key: "Realistic" label flips Wan to noAdvantage despite fitScore 8 -> Wan drops to 1% and loses Budget pick; budget pick moves to Seedance 2.0, not to the cheaper Kling Omni (fit 7).)

## Run 8
RUN 8 — 10s 9:16 720p — "Evaluation complete 0.4s"
Workflow tags: Product video | Realistic | Dialogue-heavy | Voice acting
1. Seedance 2.5 (ByteDance) 38% — Jev's pick — 1080p max, 4–30s — "Your top quality pick for this scene." — Generate ≈ 70 credits
2. Seedance 2.0 (ByteDance) 31% — Budget pick — 4K max, 4–15s — "An alternative when you want quality close to Seedance 2.5." — Est. 45 credits
3. Flux 3 (Black Forest Labs) 19% — 1080p max, 5–20s — "A strong voice-acting option for the delivery and emotion you described." — Est. 55 credits
4. Kling 3.0 Omni (Kuaishou) 9% — 4K max, 3–15s — "A close Kling alternative, with a small quality trade-off." — Est. 13 credits
5. Kling 3.0 (Kuaishou) 0% — 1080p max, 3–15s — "No specific reason returned. Evaluate again to retry." — Est. 20 credits
6. Wan 3.0 (Wan) 1% — 1080p max, 2–30s — "The amount of dialogue favors the Seedance models for this scene." — Est. 18 credits
7. Gemini Omni Flash 1.1 (Google) 1% — 4K max, 3–10s — "No clear advantage over the stronger choices for this scene." — Est. 30 credits
8. MiniMax H3 (MiniMax) 1% — 2K max, 5–15s — "A lower-priority alternative for this scene; Seedance is the preferred quality choice." — Est. 20 credits
Unavailable: none. Duration suggestion: none.
API: request aspect "9:16", resolution "720p"; sceneType "Product video", sceneLabels ["Product video","Realistic","Dialogue-heavy","Voice acting"], dialogue "substantial", confidence 0.99, choice "seedance"
cards: seedance 10 0.99 0 | seedance-2 9 0 0 | flux 7 0.01 0 | kling-omni 5 0 0 | kling 0 0 0 | wan 8 0 1(noAdvantage) | gemini-omni 6 0 1 | h3 1 0 1

## Patterns inferred

**Display % = fitScore² share.** Visible % ≈ fitScore² / Σ fitScore² over the cards that are not noAdvantage (e.g. run 2: 10,9,8,7 → 100/81/64/49 → 34/28/22/17, shown 33/27/21/16 once ~1% is reserved for each noAdvantage card). Matches runs 2,3,5,6,7,8. Run 4 is off (10 vs 8 shown as 66/34, where squares would give 61/39), so the formula may change when only two cards are left. `probability` (the "Jev" classifier output) is separate and does NOT drive the %; the top pick is simply fitScore 10.
**noAdvantage cards** are pinned at 1% and sorted to the bottom whatever their fitScore (Wan with fit 8 still shows 1%). **Kling 3.0** came back fitScore 0 / "No specific reason returned. Evaluate again to retry." in every run, which looks like a backend gap; it still shows 0% rather than being hidden.
**Blocked models (duration out of range) are removed from the UI entirely**. No "Unavailable for this request" list ever rendered (checked full page text + scroll). Reasons exist only in the API: "Supports A–Bs; your shot is Ns." When most are blocked (25s), a banner suggests a shorter duration with a model: "Shorter option · Kling 3.0 Omni / Consider 15s instead of 25s. / Use 15s" (durationSuggestion picks the max of that model's range).

**What moves models:**
- Seedance 2.5 = default #1 (fit 10) for everything except anime. Seedance 2.0 is a fixed #2 (fit 9, "quality close to Seedance 2.5").
- Anime / 2D character animation → MiniMax H3 jumps to #1 ("preferred specialist for this 2D character animation"); in non-anime scenes H3 is fit 1–6, marked noAdvantage, "Seedance is the preferred quality choice" / "dialogue favors Seedance".
- Wan 3.0 = fit 8 for cinematic/camera-work/B-roll/product ("Fits the camera work and cinematic look"), and the usual budget pick. It gets flagged noAdvantage (1%) whenever the "Realistic" label appears (run 7 wine glass, run 8 selfie) or there is heavy dialogue.
- Dialogue/voice (runs 1, 8: tags "Brief dialogue"/"Dialogue-heavy", "Voice acting") → Flux 3 rises to #3/#4 ("A strong voice-acting option for the delivery and emotion you described"); otherwise Flux is noAdvantage at 1%.
- Multi-shot / cuts (run 3) → Kling 3.0 Omni gets a specific reason ("Supports the shot changes and reference-led continuity") and a non-zero probability (0.09), but stays fit 7, #4.
- Gemini Omni Flash 1.1 never ranked: always noAdvantage or blocked (>10s).
- Long duration (25s) → only Seedance 2.5 (4–30s) and Wan (2–30s) remain.
- Legible text ("NOIR") and slow-motion physics triggered no special handling or reasons beyond the scene labels.
- Reason texts are canned per model/role; sometimes wrong (run 6 Seedance "dialogue... shot changes" on a no-dialogue anime prompt).

**Budget pick rule (consistent across all 8):** among cards that are not noAdvantage and have fitScore ≥ 8, take the cheapest (per-second credits). It can be the same card as Jev's pick (run 6 H3 has both badges). Kling Omni (fit 7) is never chosen even though it is cheaper. When Wan is noAdvantage, the badge falls to Seedance 2.0.

**Credit estimates (client-side, credits/sec):** at 1080p: Seedance 2.5 12, Seedance 2.0 9, Flux 9, Gemini ~4.5, Wan ~3.5, Kling/Kling Omni/H3 2. At 720p (run 8, 10s): Seedance 2.5 7, Seedance 2.0 4.5, Flux 5.5, Gemini 3, Wan 1.8, Kling Omni 1.3, Kling 2, H3 2. These scale linearly with duration (e.g. Seedance 2.5 60/96/144/300 for 5/8/12/25s).

**Scenario deviations:** #5 asked for 1:1, which the tool doesn't offer, so it ran at 16:9. Everything else ran as specified.
