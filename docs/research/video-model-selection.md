# Choosing a Higgsfield video model for a shot

What `backend/lib/model-recommender.js` rests on, gathered on 2026-10-14. The
three source write-ups are in `video-model-selection/`:

- `official-facts.md`: every Higgsfield video model's limits, read from the live
  docs. All 67 video endpoints and their input schemas match our snapshot
  (`backend/lib/providers/higgsfield-models.json`, checked 2026-10-02). Also
  covers cancel, polling, rate limits and webhooks.
- `community.md`: what creators report, by shot type, with sources and dates.
  The anchors are the Artificial Analysis blind-vote arena (Sept 2026) and one
  same-prompt test grid (Voyager, 19 models, single runs). Reddit and X could
  only be read second-hand.
- `selector-scenarios.md`: 8 scenarios run on Dan Kieft's public AI Video Model
  Selector. It records what that tool ranks and how. Its reasons are stock
  phrases, and it ranks Seedance 2.5 first almost everywhere.

## How the recommender uses it

1. **Hard limits are derived, never typed.** Duration, aspect ratio,
   resolution, reference counts, sound and multi-shot are read off each
   model's own schemas (`video-model-facts.js`). A brief that breaks a limit is
   refused with the limit named.
2. **Base quality** follows the arena. Wan 3.0, Seedance 2.5 and MiniMax H3 are
   statistically tied at the top. Seedance 2.0 is just behind. Kling 3.0 and
   Omni score clearly lower overall, but are strong at motion, multi-shot and
   identity.
3. **Weights by scenario** (`FAMILY_PROFILES`) carry the findings that held
   across sources:
   - **On-screen text:** never Kling (it garbles letters). Seedance 2.0,
     MiniMax H3 and Hailuo 2.3 spell correctly.
   - **Liquids:** Seedance 2.5, Kling 3.0 Pro, Hailuo 2.3 and Wan 2.7 failed the
     spill test. Wan 3.0, Seedance 2.0 and MiniMax H3 passed.
   - **Takes over 15 s:** only Seedance 2.5 and Wan 3.0 (up to 30 s). Wan may
     add cuts nobody asked for.
   - **Multi-shot in one clip:** Kling 3.0 and O3 lead, with up to 6 labelled
     shots.
   - **Identity from references:** Kling O3/Omni held a face in 26 of 28 runs.
     Seedance, H3 and Wan 3.0 are also good.
   - **Anime and stylized:** MiniMax H3 is the most-cited choice.
   - **Dialogue:** Seedance 2.0 is best for one speaker. Grok burns the line in
     as captions. Hailuo 2.3 and MiniMax H3 make no sound.
4. **Cost** comes from the provider rate book, per second. The budget pick is a
   strong fit (75 or higher) that costs at least 25% less than the next strong
   option.
5. **The AI judgement** is optional and re-ranks only models that passed the
   hard limits.

## Prompting tips used by "Optimize with AI"

`PROMPT_TIPS` in `backend/routes/production-studio.js` holds each family's
house style, summarized from section 4 of `community.md` and the docs:
- Seedance: camera first, `@image` tags, "no subtitles".
- Kling: labelled shots and speaker tags, no text.
- Wan: "one continuous take, no cuts", "no music".
- MiniMax H3: no dialogue, one scene.
- Grok: no spoken lines.

## Thin evidence

The weights here rest on very little independent data: whip pans,
start/end-frame adherence, collisions, Happy Horse, LTX-2.5 and PixVerse V6.
Revisit them when better comparisons appear. Per-request credit cost needs
Higgsfield's authenticated estimate endpoint, so cost estimates use list rates.
