# What creators report about AI video models, by shot type (research as of 2026-10-14)

Goal: inputs for a recommender that picks a video model from a shot's prompt.

## 0. Read this first: how good is the evidence?

- **Reddit, X and Discord could not be read directly.** reddit.com and old.reddit.com are blocked for this crawler, and X posts return HTTP 402. Reddit sentiment therefore only arrives second-hand, through blogs that quote it (several of them vendors). X content comes only from search-result snippets.
- **Dan Kieft's video** ("Stop Wasting Credits on AI Video Generators Like Seedance 2.5", https://www.youtube.com/watch?v=KKfaBVM3Jdg). No transcript was available. Its companion notes page was read in full: https://how-to-save-credits.vercel.app/
- **The strongest independent signals:**
  1. **Artificial Analysis (AA) Video Arena.** Blind pairwise human votes, read live around Oct 2026. Measures overall preference only, not scenarios.
  2. **Voyager standardized test grid** (https://voyager.so/resources/models/prompts/...). Nine scenario prompts were run on 19 models, one unedited try each, between 9 and 18 Sep 2026.
     - This is the only same-prompt, scenario-level comparison found that covers nearly the whole roster.
     - Caveats: Voyager resells access, every result is n=1, and its grid verdicts sometimes contradict its own model pages (noted below).
- **Most other sources are vendor or reseller blogs**: Atlas Cloud, fal, Higgsfield, PixVerse, seedance.tv, Segmind, Dreamina. Each one is weak alone, so it is counted only where several agree.
- **"N independent"** below means separate publishers. Voyager and AA each count as 1.
- **Sora 2 is no longer relevant.** The app shut down 2026-04-26 and the API ended 2026-09-24 (Higgsfield blog, Krea blog). Drop it from the recommender.

## 1. Overall standing: Artificial Analysis Arena (read ~Oct 2026)

Elo is relative to Kling 3.0 Pro, which is fixed at 1000.

### Text-to-video, with audio
https://artificialanalysis.ai/video/leaderboard/text-to-video

| Model | Elo | $/min at 1080p |
|---|---|---|
| Wan 3.0 | 1173 | $12 |
| Utopai X | 1166 | — |
| Seedance 2.5 | 1159 | $34 |
| MiniMax H3 (768p, open weights) | 1158 | $4.80 |
| MiniMax H3 Max | 1156 | — |
| FLUX 3 | 1145 | — |
| Seedance 2.0 | 1138 | $22 |
| Gemini Omni Flash 1.1 | 1132 | $9 |
| Grok Imagine 1.5 | 1059 | $15 |
| HappyHorse 1.1 | 1054 | $10.80 |
| Wan 2.7 | 1040 | — |
| HappyHorse 1.0 | 1034 | — |
| Kling 3.0 Omni | 1020 | $8.40 |
| Kling 3.0 Pro | 1000 | $10 |
| Grok 1.5 Lite | 998 | — |
| PixVerse V6 | 989 | $6.90 |
| Veo 3.1 | 968 | $24 |
| Veo 3.1 Fast | 964 | — |
| LTX-2.5 Fast | 951 | — |
| LTX-2.5 Pro | 948 | — |

### Image-to-video, with audio
https://artificialanalysis.ai/video/leaderboard/image-to-video

| Model | Elo |
|---|---|
| MiniMax H3 | 1141 |
| Seedance 2.5 | 1139 |
| Gemini Omni Flash 1.1 | 1134 |
| Wan 3.0 | 1127 |
| H3 Max | 1124 |
| Seedance 2.0 | 1121 |
| Grok 1.5 | 1068 |
| HappyHorse 1.1 | 1061 |
| Wan 2.7 | 1033 |
| Veo 3.1 | 1031 |
| PixVerse V6 | 1025 |
| Kling O3 | 1004 |
| Kling 3.0 | 1000 |
| LTX-2.5 Fast | 985 |
| LTX-2.5 Pro | 957 |

On the silent I2V board, Gemini Omni Flash is #1 (1368).

### What this means for the recommender
- The top tier is a statistical tie: Wan 3.0, Seedance 2.5, MiniMax H3 and Gemini Omni Flash. Seedance 2.0 sits just under it.
- Kling 3.0, Veo 3.1, PixVerse V6 and LTX-2.5 are clearly lower on raw blind preference.
- Kling and Veo still win specific scenarios (below).
- MiniMax H3 is the standout value: top-tier Elo at about $5/min.

## 2. Scenario findings

Format per scenario: who wins, who loses, why, and the evidence count.

### 2.1 Dialogue and lip sync (single speaker)

**Winners**
- **Seedance 2.0.** Ranked #1 on Voyager's talking-head test: most natural face and delivery. Blogs and X posts agree.
  - Vera (X): Seedance 2.5 was the only result in a micro-expression test that "felt human". https://x.com/VeraVCreates/status/2087387543566491802
  - Chubby (X): Seedance is "the most human". https://x.com/kimmonismus/status/2021176568563785908
  - Evidence: 4 or more independent sources.
- **Veo 3.1 / Veo 3.1 Fast.** The traditional dialogue pick in roundups (buildfastwithai, 3daistudio, Krea, Yangsweb, and Reddit second-hand via veo3gen). Veo 3.1 Fast was #2 on Voyager.
  - Evidence: 5 or more sources, but mostly older and from blogs.
- **Wan 3.0** (Voyager #3) and **MiniMax H3** (Voyager #4, "line delivered on the beat", cheapest).

**Losers**
- **Hailuo 2.3.** No audio at all.
- **Grok Imagine 1.5.** Burns the quoted line in as an unrequested caption (Voyager).
- **Gemini Omni Flash.** Lip sync drifts after about 6-7 s (multiple blog reviews). Medium evidence.
- **Wan 3.0.** Dialogue sounds "slightly processed" (video-generator.ai, ourcodeworld). There is a small lip-sync delay near the end of clips.
- **Veo 3.1 full and Seedance 2.5.** Both had framing misses in Voyager's single run (selfie framing; wide shot).

**Contradiction:** Voyager's Seedance 2.5 model page praises its talking-head lighting and lip sync, but the grid lists it as a fail for framing. Treat it as inconsistent framing with good lip sync.

### 2.2 Multi-character dialogue

**Winner: Kling 3.0 / O3.** It has the most explicit speaker-tagging syntax: `[Character, tone]: line`.
- Claims of phoneme-level multi-speaker lip sync come from buildfastwithai and pixo, and are echoed by fal's guide.
- Evidence: 3 sources, all blogs. Medium-weak.

**Alternative: Seedance 2.0.** Clearly ahead of Wan 3.0 on multi-subject interaction (Atlas, 49 same-seed tests).

**Losers**
- PixVerse V6: multi-character audio is its "least reliable" area (Atlas review).
- Gemini Omni Flash: multi-speaker is a known weakness.

### 2.3 Native audio and SFX quality

**Leaders**
- **Seedance 2.0/2.5** and **Veo 3.1.** Veo's audio is the "single most praised feature" in Reddit threads (second-hand via veo3gen, vendor).
- **MiniMax H3.** Stereo audio, cheapest.
- **HappyHorse 1.1.** Joint audio including room tone, SFX and music. Vendor claims only.

**Middle**
- **Wan 3.0.** Ambience is fine for a rough cut. Dialogue and singing are not release-grade.

**No or weak audio**
- **Hailuo 2.3:** no native audio.
- **Kling 3.0:** voice supports Chinese and English only; other languages are translated to English (Voyager, fal default).

**Universal tip (5 or more sources: Gemini review, Seedance guides, Wan reviews, Segmind)**
- State the audio intent explicitly, including "no music", or the model adds a score you did not choose.
- For Seedance 2.5, "no music" plus a description of the diegetic sound also reduces audio-copyright refusals (Segmind).

### 2.4 Fast action, whip pans and camera motion

**Steady named moves (push-in, orbit, follow)**
- **Veo 3.1 Fast.** Best drone push-in on Voyager.
- **Wan 3.0.** Voyager #2. video-generator.ai says it treats camera direction "like a setting".
- **Gemini Omni Flash.**
- **Kling 3.0.** Clean but gentle. It also has explicit camera APIs and its own camera-control guide.

**Cinematic or energetic moves (whip pan, dolly, crane, parallax)**
- Blogs credit **Seedance** (kapwing, atlascloud, Higgsfield: "action/VFX" winner for Seedance 2.0).

**Fast, heavy human motion**
- **MiniMax H3** and **Hailuo 2.3.** Praised for body fluidity (ThePlanetTools; Atlas "physics and human motion").

**Losers and failure modes**
- **Seedance 2.5.** Weakest in Voyager's push-in test ("camera hardly moves"; one 26-minute wait). Its art-style clip also barely moved.
- **Seedance 2.0.** Moves short or subtle unless directed. Failed a full orbit (Atlas).
- **Wan 3.0.** Adds uncommanded cuts and angle changes, around 3.5 s in an 8 s clip (Atlas). Lateral tracking wobbles mid-clip (youart).
- **PixVerse V6.** Foot sliding on fast ground movement.
- **All models.** Avoid "fast"/"rapid". Write tempo instead ("slow push-in over 5 seconds"), or quality degrades (Picsart, atlabs).

**Evidence:** Medium for "steady moves". Weak for whip pans specifically: no direct whip-pan benchmark exists.

### 2.5 Physics: water, cloth, collisions

**Winners**
- Voyager spill test (18 Sep): **Veo 3.1** best ("droplets... puddle that spreads"), then **Veo 3.1 Lite**, **Seedance 2.0** and **Wan 3.0** (ice stays cube-sized). **Veo 3.1 Fast** and **MiniMax H3** also produced believable spills.
- MiniMax H3 is "much better at physics" (Atlas, Medium tester).
- Wan 3.0 showed believable cloth, water and lantern swing (video-generator.ai), and is ahead of Seedance 2.0 on physics (Atlas, 49 tests).

**Losers (Voyager spill test)**
- **Seedance 2.5:** water turned into a haze.
- **Kling 3.0 Pro:** the glass rights itself.
- **Hailuo 2.3:** the glass never tips.
- **Wan 2.7:** ice cubes grew.
- **PixVerse V6:** weaker; the glass vanishes in a late frame.

**Other**
- Gemini Omni Flash: one ball is fine; two colliding balls drift about 15° (jxp). A breakdancing robot's head detached.
- Collisions and destruction are the most-reported failure category for all models.

**Evidence:** Medium. Voyager plus 3 blogs agree that Wan 3.0 / H3 / Veo are good and Seedance 2.5 / Kling are weak on liquids.

### 2.6 Character identity from reference images

**Winners**
- **Kling 3.0 Omni (O3).** Built for "preserve these assets". 26 of 28 generations held the reference face (ThePlanetTools, 11-day test). Elements/Voice Binding workflow. Higgsfield names it the budget winner for character consistency.
- **Seedance 2.0/2.5.** Up to 9 (2.0) or 50 (2.5) references. Held identity in the shot-4 test, Kieft's 20 s space short, and a Contra 30 s one-shot.
- **MiniMax H3.** Held identity across 4 shots from a turnaround sheet (Atlas). Strongest on "human identity" in the 10-test comparison.
- **Wan 3.0.** Holds identity through motion better than Seedance 2.0 (Atlas, 49 tests). Good face consistency (ourcodeworld).

**Major caveat for Seedance 2.0/2.5**
- It rejects real human faces in references unless they go through a liveness/asset-ID path (apiyi docs, mindstudio, heyuan110).
- Seedance 2.5 even refused a vendor's own product photo as a copyright risk (Voyager).
- Use illustrated or generated character sheets.

**Losers**
- Kling 2.6: single reference only; fails on head rotation.
- Grok 1.5 and Kling 3.0 follow the reference image's aspect ratio rather than the requested 16:9 (Vera on X; Voyager).

**Evidence:** Medium. 4 or more sources each for Kling O3 and Seedance.

### 2.7 Multi-shot or cuts within one generation

**Winners**
- **Kling 3.0 / O3.** Most often cited (5 or more blogs, plus fal, Higgsfield, Atlas):
  - `multi_prompt` allows up to 6 shots and 15 s.
  - Use explicit "Shot N (Duration: Xs)" labels.
- **Seedance 2.0.** Higgsfield's winner for "multi-shot film with synced audio". Kieft runs 6-7 shot lists through Seedance 2.5 and MiniMax.
- **LTX-2.5.** Native multi-shot, open weights. Launch claims only.

**Losers**
- **Wan 3.0.** Shots "feel stitched", and it adds cuts you did not ask for.
- **MiniMax H3.** Multi-scene prompts are split or re-edited (Voyager: the self-portrait became a drummer and a cellist). Keep each prompt to one scene.
- **Gemini Omni Flash.** Unrequested cuts (Voyager turntable). 10 s cap.

**Evidence:** Medium for Kling; weak-medium for the others.

### 2.8 Long takes (over 10 s)

**Native length**
- Seedance 2.5: up to 30 s.
- Wan 3.0 / Wan 3.0 Prime: up to 30 s.
- Kling 3.0: 15 s. MiniMax H3: 15 s. PixVerse V6: 15 s. Seedance 2.0: 15 s.
- Gemini Omni Flash: 10 s. Veo 3.1: 8 s (extend-chaining is possible but drifts at seams). Grok 1.5: 5-8 s (plus extend).

**Winners**
- **Seedance 2.5.** Voyager's 20 s and 30 s workshop tests held the subject and props. Atlas credits it with long-shot consistency. Contra's 30 s test held character and camera.
- **Wan 3.0.** Holds the "longest, most over-specified briefs", but framing shifted in the 30 s test and it inserts cuts or dissolves at about 4-5 s and 15-17 s.

**Shared failure mode (Contra, atlas shot-4, Kieft)**
- Too many beats get compressed: "more story inside one generation is not better".
- One drift ruins all 30 s.
- Tip: cut the shot into re-rollable segments of 8-15 s unless a true oner is needed.

**Evidence:** Medium.

### 2.9 Start and end frame adherence (image-to-video fidelity)

No direct first/last-frame benchmark was found. As a proxy, Voyager's "keep the product unchanged" I2V test gives:

**Pass**
- Wan 3.0, Seedance 2.0, Kling 3.0 Pro and Kling 3.0 Standard.
- Kling's own guidance: "treat the input image as an anchor" (fal).
- Wan 3.0 sides with the image when the prompt conflicts with it (Atlas). Good for fidelity, bad for transformations.

**Fail**
- Gemini Omni Flash and Luma (added a handle).
- Grok (motion faded).
- Veo 3.1 Lite (barely poured).
- Seedance 2.5 (refused for copyright).

**Feature availability**
- First-and-last-frame mode exists on Veo 3.1, MiniMax H3, Wan 3.0, Kling 3.0, and Gemini Omni 1.1 (added 2026-08-27).
- Wan 3.0 reviewers say first-and-last-frame mode gives the most controlled results for simple scenes.

**Evidence:** Weak-medium.

### 2.10 Text and logos on screen

**Voyager title card test**
- **Pass:** Veo 3.1, Seedance 2.0, Veo 3.1 Fast, MiniMax H3, Hailuo 2.3, Gemini Omni Flash (after a bokeh intro).
  - Higgsfield also credits Hailuo 2.3 with sharp on-screen text.
  - Atlas credits Seedance 2.5 with in-frame text and product surfaces; Voyager's model page also says Seedance 2.5's text is "crisp".
- **Fail:**
  - Kling 3.0 Standard rendered "MDDA SUMMER SESSIIONS"; Kling 3.0 Pro rendered "MODA SUMER SOSSSIONS".
  - Sora 2 lost letters.
  - Veo 3.1 Lite overlapped the two lines.
  - Grok showed a stray "MME" first.
- **Refused:** Wan 3.0 and Wan 2.7 (fal policy error) on a harmless festival title.

**Conflict:** The Kling 3.0 vendor blog (aireiter) claims Kling handles signage legibly. Voyager's direct test contradicts it. Trust the test.

**Other text findings**
- Wan 3.0 gets UI labels mostly right, with one typo (ourcodeworld).
- Gemini Omni Flash: Latin text is fine. Japanese and complex Chinese fail (11 of 46 hiragana correct) (jxp).

**Tips**
- Put exact text in quotes.
- State when, where and how the text enters.
- Use one language only. Mixing languages raises the garble rate (heyuan110).

**Evidence:** Medium for "Kling is bad at text" (Voyager plus its model page). Weak-medium for the others.

### 2.11 Stylized and anime

**Most-named anime and stylized picks**
- **MiniMax (Hailuo 2.3 / H3).**
  - Dan Kieft: "anime works better on Minimax than Seedance". He used Minimax for OVA-style and Rick-and-Morty-style shots.
  - Higgsfield: MiniMax wins for "anime/stylised".
  - Hedra and Artlist (vendors) agree.
  - Evidence: 4 sources.
- **PixVerse.** A legacy anime specialist. V6 claims clean line art in fast anime action, but this comes from PixVerse's own posts. No independent test.
- **Seedance 2.0.** "Clearly ahead" of Wan 3.0 on stylized content (Atlas).

**Voyager ukiyo-e woodblock test**
- Pass: Veo 3.1, MiniMax H3 ("liveliest waves"), Veo 3.1 Lite, Wan 3.0, Wan 2.7.
- Kling Pro produced a bold "screen print" reading.
- Seedance 2.5 kept the style but barely moved (one run errored).
- Hailuo 2.3 washed out.
- Gemini Omni Flash added a stray lightning bolt.

**Evidence:** Medium for MiniMax. Weak for PixVerse.

### 2.12 Photoreal humans and skin

**Winners**
- **Seedance 2.0/2.5.** Most natural faces and micro-expressions (Voyager, Vera, Chubby, Curious Refuge, and Derya's X tests all place Seedance 2.0 first, with Kling second and Veo last).
- **Kling 3.0.** Named for human photorealism. Higgsfield says Kling beats Veo on close-up faces. One Reddit user (via aireiter) found Seedance close-ups "artificial" compared with Kling. This is a single anecdote.
- **Wan 3.0.** Live-action people beat Seedance 2.0 in static holds (Atlas).

**Loser:** Veo 3.1 on close-up faces. Faces go soft from wide to close (Higgsfield). It is better on wide, atmospheric and weather shots.

**Evidence:** Medium for Seedance. Mixed for Kling.

### 2.13 Crowds and busy scenes

**Voyager farmers-market test**
- **Pass:** Veo 3.1 Fast (densest, most legible), Wan 3.0 ("faces stay faces"), Seedance 2.0, MiniMax H3.
- **Qualified:** Gemini Omni Flash and Grok.
- **Weak:** Seedance 2.5 and Wan 2.7 (sparser).
- **Fail-leaning:** Kling 3.0 Standard and Pro (painted, plastic look).

**Other reports**
- Wan 3.0: dense crowds soften toward the frame edges (video-generator.ai).
- Kling: hands and faces suffer in multi-character scenes (eesel).
- Gemini Omni Flash: tracking becomes unreliable with 4 or more objects.

**Evidence:** Weak-medium (mostly one test).

### 2.14 Prompt adherence on complex prompts

**Winners**
- **Wan 3.0.** Takes 5,000-character briefs, has a "thinking" pass (`enable_thinking`), and handles over-specified briefs (Atlas, ourcodeworld).
- **Seedance 2.0.** Far ahead when the image and prompt conflict (Atlas). Strong prompt understanding (36Kr interview). Curious Refuge: Veo Lite trailed on prompt consistency.
- **MiniMax H3.** More dependable than LTX-2.5 on complex prompts (seedance.tv, vendor). But it reinterprets props and splits scenes (Voyager).
- **Veo 3.1.** Reddit praise for multi-element scenes (second-hand).

**Losers**
- **Kling 3.0.** Strong brand or subject cues override the scene (Voyager self-portrait became a giant chrome "K"). Weak with "a single loose prompt" (Higgsfield).
- **Grok 1.5.** Reinterprets props.
- **Seedance 2.0.** Instruction overflow: honours only some items beyond about 100 words (heyuan110).

**Evidence:** Weak-medium.

### 2.15 Vertical UGC talking heads

**Picks**
- **Seedance 2.0.** "Practical top pick for scalable, realistic UGC" (Krea). The default for UGC and product ads (oakgen). Watch the real-face block.
- **Veo 3.1 / Veo 3.1 Fast.** Talking-head polish, but the 8 s cap hurts.
- **MiniMax H3.** Returned 9:16 from prompt text alone. Cheap. Good for "vertical short drama" and 4-15 s hooks (Atlas, seedance.tv).
- **Hailuo 2.3.** Fast UGC drafts, but no audio.
- **HappyHorse 1.1.** Talking heads at 11-15 s (Scenario guide, vendor).

**Watch out**
- Grok burns captions in.
- Seedance 2.0 defaulted to 16:9 when the aspect ratio was not set.

**Evidence:** Weak-medium.

### 2.16 Cost efficiency and failure rate (credits wasted)

**Dan Kieft's core thesis**
- A cheaper model gets you "80-90% of the result".
- His example shot: Kling 3.0 cost 12 Higgsfield credits; Seedance 2.5 cost 72 (6x).
- Seedance 2.5 "draft mode": iterate at 480p (45 credits), then upscale only the final. One scene cost 420 credits instead of 720.
- He built an "AI Video Model Selector" that does exactly what this recommender aims to do.

**Higgsfield: "draft cheap, finish expensive"**
- Iterate in Kling or MiniMax, then finish in Seedance or Veo.
- Kling about 6 credits; Seedance 2.0 about 90 credits per 15 s at 720p.

**Price per 5 s clip on fal (Voyager)**
- Cheapest: H3 Max Turbo $0.10, H3 Max $0.20, Hailuo 2.3 $0.28, MiniMax H3, PixVerse V6 and Veo 3.1 Lite $0.30 each.
- Middle: Wan 3.0 $0.50, Kling 3.0 Standard $0.63, Gemini Omni Flash $0.65, Grok $0.70, Kling 3.0 Pro $0.84, Veo 3.1 Fast $0.90.
- Most expensive: Seedance 2.0 $1.51, Seedance 2.5 $2.31, Veo 3.1 $2.40.

**Failure and waste signals**
- **Seedance 2.5**
  - Output-stage refusals: 3 of 30 requests in Segmind's test, one only after a 608 s wait.
  - Copyright refusal on an owned product photo.
  - Queue times of 170 s to 26 min.
  - Most expensive per second.
- **Kling (app)**
  - The "99% freeze" fails late and still costs credits.
  - Failed generations still charge; refunds are slow (eesel, Adobe forum, Sikayetvar).
  - API waits of 500-690 s per 5 s clip on fal.
- **Grok 1.5:** refused requests are still charged on fal.
- **Wan 3.0 / Wan 2.7:** fal's safety checker refuses benign prompts.
- **Veo 3.1:** expensive. Reddit complaint: "$6 per 8 seconds". Rate-limited API.
- **Gemini Omni Flash:** unpredictable policy blocks (real brands, aging a generic adult). Drift after 4 edit turns.
- **Runway (Gen-4.5 / Aleph 2.0)**
  - Reviewers flag high credit burn per usable 10 s.
  - Aleph 2.0 is an editing tool (30 s, 1080p, edit-a-keyframe propagation), not a generator.
  - No independent creator tests were found.

## 3. Common failure modes per model (summary)

**Seedance 2.5**
- Water and liquid turn to haze.
- Under-moves the camera and the subject.
- Unpredictable framing (it framed a requested close-up wide).
- Copyright and real-face refusals.
- Long queues; most expensive.
- Packs too many beats into a 30 s take.
- May default to Mandarin speech (one review).
- Voice drift across shots (seedance.tv guide).

**Seedance 2.0**
- Real-face block.
- Subtle or flat camera unless directed.
- Instruction overflow beyond about 100 words.
- "Naked" references bleed lighting and framing into the output.
- Unrequested subtitles, logos and watermarks unless excluded.
- Strict moderation; plan-gated on Higgsfield.

**Kling 3.0 / O3**
- Misspelled on-screen text.
- Painted or plastic crowds.
- Liquid physics resets.
- Brand or subject cues hijack the scene.
- Follows the reference image's aspect ratio.
- Slow API.
- Voice limited to Chinese and English.
- About 2 in 28 face drifts (hair, jaw).
- Credits lost on failed generations.

**Kling 2.6**
- Single reference only.
- Breaks on head turns.
- No lip sync; 10 s max.
- Only for cheap, frontal, short shots.

**MiniMax H3**
- Reinterprets props.
- Splits or edits multi-scene prompts.
- 15 s cap.
- 2K output and the prompt preprocessor are API-only; local output is 768p.

**Hailuo 2.3**
- No audio.
- 6 s at 1080p.
- Painted look on realism.
- Washes out some styles.

**Wan 3.0 / Prime**
- Uncommanded cuts and dissolves.
- Mid-clip wobble on lateral tracking.
- Framing shifts in 30 s takes.
- Processed dialogue.
- fal safety refusals.
- Slow: about 800 s for a 30 s clip. Prime is about 40% more expensive for speed.
- Hands in complex interactions; edges of crowds.

**Wan 2.7**
- Scale drift (the ice grew).
- Adds unrequested props.
- Needs a clean reference clip.

**HappyHorse 1.0/1.1**
- Less cinematic and weaker on prompt understanding than Seedance 2.0 (36Kr).
- Little independent data. AA Elo is mid-pack.

**Gemini Omni Flash**
- 10 s at 720p.
- Lip-sync drift after 6-7 s.
- Changes the product in I2V.
- Unrequested cuts and effects.
- Physics prompts land about 50/50.
- Drift after 4 edit turns.
- Non-Latin text fails.

**Veo 3.1**
- 8 s cap.
- Soft close-up faces.
- Invents framing.
- Captions or subtitles appear unless negated.
- Price and rate limits.
- Veo 3.1 Lite overlaps text.

**Grok Imagine 1.5**
- Burns dialogue in as captions.
- Stray letters.
- Reinterprets props; motion fades in I2V.
- 5-8 s.
- Charged on refusal.

**PixVerse V6**
- Foot sliding.
- Weak multi-speaker audio.
- Physics weaker than the field.
- Drifts close on product shots.

**LTX-2.5**
- Soft faces and fine detail.
- Wardrobe continuity breaks across shots.
- Local quality depends on quantization.
- Community split: one user reported "400% faster"; another got 0 of 15 usable (LTX-2.3 LoRAs).

## 4. Prompting tips per model (how each wants direction written)

**Seedance 2.0 / 2.5**
- Prompt structure:
  - 5 slots: subject, action, scene, camera, style/audio.
  - 60-100 words, non-negotiables first.
  - Above 8 s, use a per-second timeline.
- Camera:
  - One primary camera move per clip, with an end state ("slow push-in ending in MCU").
  - Use "cut to" for a second move.
  - Without a camera line, it defaults to subtle motion.
  - Avoid the words "fast" and "rapid".
- References:
  - Give each one a job ("@video1 = camera movement only"). Strength 70-80%.
  - Combine turnaround views into one composite.
  - Write the identity block once and reuse it verbatim.
- Exclusions: always state "no subtitles/logos/watermark" and "no music".
- Seedance 2.5 specifically:
  - Structure long takes by thirds or timestamps.
  - Restate props at each timestamp.
  - Restate "one continuous take, no cut" in each segment.
  - Draft at 480p first.
- Sources: heyuan110, Picsart, Runway guide, Atlas, Voyager, Kieft.

**Kling 3.0 / O3**
- Write it as direction, not as a list of objects.
- Multi-shot: "Shot 1 ... (Duration: 5 seconds)", up to 6 shots, via `multi_prompt`.
- Camera behaviour over time ("tracking, then freezes"). Adverbs ("gently", "barely perceptibly").
- Dialogue:
  - Format: `[Unique Label, tone]: "line"`.
  - Put the action before the line.
  - No pronouns.
  - Use temporal links ("Immediately").
- Image-to-video: prompt only the changes.
- Never rely on it for text.
- Use Elements built from a short clean video of the character.
- Sources: fal guide, Kling camera guide, Flick, Voyager.

**MiniMax H3 / Hailuo**
- One scene per prompt.
- Name the subject, lighting and camera.
- Exact text in quotes.
- Put aspect ratio in the prompt text (it obeys 9:16).
- Prompt-expansion setting: fast / balanced / quality.

**Wan 3.0**
- Write a camera brief, not keywords; up to 5,000 characters.
- Reference inputs by position ("image 1", "clip 2").
- Turn on `enable_thinking` for documents and complex briefs.
- Use the negative prompt ("reduced rerolls more than positive tricks").
- Name camera moves explicitly.
- Smart duration.
- Repeat key details across segments.
- Expect, and trim, inserted cuts.

**Veo 3.1**
- Use film terms (dolly zoom, rack focus) and one movement per prompt.
- Describe voice and character per speaker.
- Add "no subtitles, no text, no captions".
- Use active verbs if the shot comes out static.

**Gemini Omni Flash**
- Describe the sound explicitly; there is no audio switch.
- Use explicit triggers ("when X touches Y").
- Make one change per edit turn, and re-anchor at turn 3.
- Use specific style references, not adjectives.

**Grok Imagine 1.5**
- Add "no on-screen text" when quoting dialogue.

**HappyHorse 1.1**
- Lines in double quotes are spoken.
- Timestamp multi-line exchanges (0-5 s, 5-10 s).
- Reference subjects by index (up to 9).
- One speaker per shot if language accuracy matters.

**LTX-2.5**
- Write chronologically (open, action, cut, next framing).
- Iterate on Fast at short duration, then move to Pro.
- Simplify wardrobe and setting for continuity.

**Universal**
- Use explicit negative constraints ("does not change", "never duplicates") rather than longer descriptions. This came from Atlas's 10 tests and was echoed by the Wan reviewer.

## 5. Proposed scenario-to-model ranking for the recommender

Confidence levels:
- **H**: AA and/or Voyager plus 3 or more agreeing sources.
- **M**: 2-3 sources or one solid test.
- **L**: vendor claims or a single anecdote.

| Scenario | 1st | 2nd | 3rd | Budget pick | Avoid | Confidence |
|---|---|---|---|---|---|---|
| Single-speaker dialogue / lip sync | Seedance 2.0 | Veo 3.1 Fast (≤8 s) | Wan 3.0 | MiniMax H3 | Hailuo 2.3 (silent), Grok (burned captions) | M-H |
| Multi-character dialogue | Kling 3.0 / O3 (speaker tags) | Seedance 2.0 | Veo 3.1 | Kling 3.0 Standard | PixVerse V6, Gemini Omni Flash | M-L |
| Native audio / SFX | Seedance 2.0/2.5 | Veo 3.1 | MiniMax H3 | MiniMax H3 | Hailuo 2.3; Kling for non-EN/ZH voice | M |
| Steady camera moves (push, orbit, drone) | Veo 3.1 Fast | Wan 3.0 | Gemini Omni Flash / Kling 3.0 | Wan 3.0 at 720p | Seedance 2.5 (under-moves) | M |
| Fast action / whip pans / energetic camera | Seedance 2.0 | Kling 3.0 | MiniMax H3 | Kling 3.0 Standard | PixVerse V6 (foot slide), Wan 3.0 (wobble/cuts) | L-M |
| Physics: liquids, cloth | Veo 3.1 | Wan 3.0 | Seedance 2.0 / MiniMax H3 | MiniMax H3 or Veo 3.1 Lite | Seedance 2.5, Kling 3.0, Hailuo 2.3, Wan 2.7 | M |
| Collisions / destruction | Seedance 2.0 | Wan 3.0 | Veo 3.1 | MiniMax H3 | Gemini Omni Flash | L |
| Identity from reference images | Kling 3.0 Omni | Seedance 2.0/2.5 (non-real faces) | MiniMax H3 / Wan 3.0 | Kling O3 | Kling 2.6 (head turns); Seedance with real faces (blocked) | M |
| Multi-shot in one generation | Kling 3.0 / O3 | Seedance 2.0/2.5 | LTX-2.5 (open weights) | Kling 3.0 Standard | MiniMax H3 (splits scenes), Wan 3.0 (stitched/random cuts), Gemini Omni Flash | M |
| Long single take (over 15 s) | Seedance 2.5 (≤30 s) | Wan 3.0 (≤30 s, trim cuts) | — | Wan 3.0 at 720p ($3 per 30 s) | Veo 3.1 / Gemini Omni Flash / Grok (short caps) | M |
| 10-15 s takes | Seedance 2.0 | Kling 3.0 | MiniMax H3 | MiniMax H3 | Veo 3.1 (8 s) | M |
| Start/end frame / I2V fidelity | Wan 3.0 | Kling 3.0 (Std/Pro) | Seedance 2.0 | Kling 3.0 Standard | Gemini Omni Flash, Grok, Veo 3.1 Lite; Seedance 2.5 (refusals) | M-L |
| On-screen text / logos | Veo 3.1 | Seedance 2.0 (2.5 also crisp) | MiniMax H3 / Hailuo 2.3 | Hailuo 2.3 or MiniMax H3 | Kling 3.0 (misspells), Wan (refuses/typos), Veo 3.1 Lite | M |
| Stylized / anime | MiniMax H3 (or Hailuo 2.3) | Seedance 2.0 | Veo 3.1 / Wan 3.0 (painterly) | MiniMax H3 | Hailuo for some styles (washes out); Seedance 2.5 (static) | M (anime: L-M) |
| Photoreal human close-ups | Seedance 2.0 / 2.5 | Kling 3.0 Pro | Wan 3.0 | Kling 3.0 Standard | Veo 3.1 for close-ups (fine for wides) | M |
| Wide / atmospheric / weather | Veo 3.1 | Wan 3.0 | Seedance 2.0 | Veo 3.1 Lite | — | L-M |
| Crowds / busy scenes | Veo 3.1 Fast | Wan 3.0 | Seedance 2.0 / MiniMax H3 | MiniMax H3 | Kling 3.0 (plastic), Seedance 2.5 / Wan 2.7 (sparse) | L-M |
| Complex prompt adherence | Wan 3.0 (thinking on) | Seedance 2.0 | Veo 3.1 | Wan 3.0 at 720p | Kling 3.0 (cue hijack), Grok | L-M |
| Vertical UGC talking head | Seedance 2.0 | MiniMax H3 (obeys 9:16, cheap) | Veo 3.1 Fast | MiniMax H3 | Grok (captions), Hailuo 2.3 (silent) | L-M |
| Drafts / iteration / lowest waste | MiniMax H3 (H3 Max Turbo) | Kling 3.0 Standard | Wan 3.0 at 480-720p, or Seedance 2.5 at 480p draft | — | Seedance 2.5 / Veo 3.1 full for drafting | M-H |
| Editing existing footage | Runway Aleph 2.0 | Wan 2.7 (restyle/reshoot) | Gemini Omni Flash (≤4 turns) | — | — | L |

### Recommender-level heuristics

1. **Draft cheap, finish expensive.** Default to MiniMax H3, Kling 3.0 Standard or Wan 3.0 at 720p. Escalate to Seedance or Veo only when a scenario tag demands it.
   - Kieft, Higgsfield and Atlas's "cost per usable clip" all say this, along with several others. Confidence: H.
2. **Hard-route on text.**
   - On-screen text present: never Kling.
   - Liquid physics present: never Seedance 2.5 or Kling.
   - Real-person photo reference: never Seedance (block).
   - Duration over 15 s: only Seedance 2.5 or Wan 3.0.
   - Duration over 10 s: never Veo, Gemini Omni Flash or Grok.
3. **Prefer Seedance 2.0 over 2.5 for shots of 15 s or less.** Seedance 2.5 costs more, is slower, refuses more, and is not better on short shots (Voyager editor recommendation, neurohive, seedance.tv). Confidence: M.
4. **Add a negative-constraint block per model.**
   - Veo, Grok and Seedance: "no subtitles/captions/text".
   - All audio models: "no music" unless music is wanted.
   - Wan: "single continuous take, no cuts".
5. **Watch the newest models.**
   - Utopai X, FLUX 3 and MAGI-2 rank highly on AA but had no community reports. Not evaluated.
   - Gemini Omni Flash 1.1 (Aug 27) added first-and-last-frame mode; that feature has not been tested.

## Key sources

- AA Arena T2V: https://artificialanalysis.ai/video/leaderboard/text-to-video
- AA Arena I2V: https://artificialanalysis.ai/video/leaderboard/image-to-video
- Voyager test grid (Sep 2026):
  - https://voyager.so/resources/models/prompts/physics
  - .../talking-person
  - .../text-card
  - .../camera-move
  - .../busy-scene-video
  - .../art-style-video
  - .../hands-action
  - .../image-to-video
- Voyager model pages: https://voyager.so/resources/models/seedance-2-5 , /minimax-h3 , /kling-3-pro , /gemini-omni-flash , /wan-3-0 , /grok-imagine-video-1-5 , /pixverse-v6
- Dan Kieft:
  - Video: https://www.youtube.com/watch?v=KKfaBVM3Jdg
  - Notes: https://how-to-save-credits.vercel.app/
- Higgsfield tested comparison (Jun 2026): https://higgsfield.ai/blog/5-Best-AI-Video-Models-2026-Tested-Compared
- Atlas Cloud:
  - Wan 3.0 vs Seedance 2.0, 49 tests (Aug 25): https://www.atlascloud.ai/blog/guides/wan-3-0-review
  - Wan 3.0 vs Seedance 2.5 vs MiniMax H3, 10 tests (Aug 21): https://www.atlascloud.ai/blog/tips/wan-3.0-vs-seedance-2.5-vs-minimax-h3
  - Seedance vs H3 shot-4 test (Aug 20): https://www.atlascloud.ai/blog/ai-updates/seedance-2.5-vs-minimax-h3
- Wan 3.0 hands-on reviews:
  - https://ourcodeworld.com/articles/read/4473/wan-3-0-hands-on-with-alibaba-s-ai-video-model-generating-30-second-clips (Aug 19)
  - https://video-generator.ai/wan-3-0-review/ (Aug 8)
- Gemini Omni review, 22 tests (May 21): https://www.jxp.com/gemini-omni/blog/gemini-omni-review
- Seedance 2.5 official-evidence review (Jul 22): https://www.seedance.tv/blog/seedance-2-5-review
- Seedance 2.5 30 s one-shot creator test (Aug 12): https://contra.com/p/Zg3lrQOq-seedance-25-or-30-second-one-shot
- Seedance 2.0 prompt guide and failure modes (Jul 11): https://www.heyuan110.com/posts/ai/2026-07-11-seedance-2-prompt-guide/
- Kling 3.0 prompting guide (Feb 5): https://blog.fal.ai/kling-3-0-prompting-guide/
- Kling AI camera-control guide: https://kling.ai/blog/kling-ai-camera-control-video-guide
- Kling 2.6 vs 3.0 motion control: https://www.atlascloud.ai/blog/guides/kling-ai-motion-control
- Kling complaints:
  - https://www.eesel.ai/en/blog/kling-ai-reviews
  - https://community.adobe.com/bug-reports-403/kling-3-0-video-generation-fails-1645244
- Veo 3.1 Reddit reactions, second-hand via vendor: https://www.veo3gen.app/blog/veo-3-1-reddit-community-reactions
- X posts, snippet-level only:
  - https://x.com/VeraVCreates/status/2087387543566491802
  - https://x.com/DeryaTR_/status/2021369768004161783
  - https://x.com/CuriousRefuge/status/2042724434268819721
  - https://x.com/kimmonismus/status/2021176568563785908
- Seedance 2.5 refusals and audio copyright: https://blog.segmind.com/seedance-2-5-uncensored-why-segmind-is-still-the-only-place-to-run-it-without-a-moderation-filter/
- Seedance real-face block: https://docs.apiyi.com/en/faq/seedance2-asset-face-reference
- LTX-2.5:
  - https://www.seedance.tv/blog/ltx-2-5-review
  - https://comfyui-wiki.com/en/news/2026-08-11-ltx-2-5-open-weights-release
- HappyHorse:
  - https://eu.36kr.com/en/p/3789098887077123
  - https://fal.ai/learn/tools/how-to-use-happy-horse-1-1
- UGC: https://www.krea.ai/blog/the-5-best-ai-video-models-for-ugc-shorts-in-2026
- Runway Aleph 2.0: https://runway.com/news/introducing-aleph-2-and-edit-studio
