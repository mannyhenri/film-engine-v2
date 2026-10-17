# Our model suggestions vs Dan Kieft's AI Video Model Selector (2026-10-14)

18 prompts run through both: Dan's public endpoint (`POST https://ai-video-model-selector.vercel.app/api/studio/evaluate`,
his model `jev-1.13.0`, rules v20) and our recommender (`backend/lib/model-recommender.js`). Raw answers:
`selector-comparison/report.json`; prompts and settings: `selector-comparison/scenarios.json`.

Dan ranks 8 models; 6 are on both sides (Seedance 2.5, Seedance 2.0, Wan 3.0, Kling 3.0, Kling O3/Omni, MiniMax H3).
Gemini Omni Flash and Flux 3 are his only, so his top 5 usually holds one we cannot match: overlap is out of 5 but
4 is the usual ceiling. Our list below is our ranking mapped onto those 6 (Wan 3.0 Prime counts as Wan 3.0).

## Summary

- Top pick agrees (on shared models): **8 of 18**.
- Top-5 overlap: **3.2 on average** (of a usual 4 possible).
- Rank agreement (Spearman over shared models): **0.48** on average; 0.7–0.8 on dialogue, drama, anime, documentary; near 0 on action and vertical.
- Dan picks Seedance 2.5 first in **16 of 18** (Wan for the 3s insert, MiniMax H3 for anime). His Kling 3.0 is always 0% ("No specific reason returned"), so his Kling order is not informative.

## Per prompt

| Prompt | Settings | Dan top 5 | Ours (shared models) | Same #1 | Overlap |
|---|---|---|---|---|---|
| Simple, one action | 5s 16:9 720p | Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling O3/Omni > Gemini Omni Flash | Wan 3.0 > Seedance 2.5 > MiniMax H3 > Seedance 2.0 > Kling 3.0 | no | 3/5 |
| Simple close-up, 480p draft | 4s 16:9 480p | Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling O3/Omni > Gemini Omni Flash | Seedance 2.5 > Wan 3.0 > MiniMax H3 > Seedance 2.0 > Kling 3.0 | yes | 3/5 |
| Action: car chase | 8s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Gemini Omni Flash | MiniMax H3 > Seedance 2.5 > Kling 3.0 > Wan 3.0 > Seedance 2.0 | no | 3/5 |
| Action: martial-arts fight | 10s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Flux 3 > Gemini Omni Flash | MiniMax H3 > Wan 3.0 > Seedance 2.0 > Seedance 2.5 > Kling 3.0 | no | 3/5 |
| Drama: two-person dialogue | 10s 16:9 1080p | Seedance 2.5 > Seedance 2.0 > Flux 3 > Wan 3.0 > Kling O3/Omni | Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling 3.0 > Kling O3/Omni | yes | 4/5 |
| Drama: emotional monologue | 8s 16:9 1080p | Seedance 2.5 > Flux 3 > Seedance 2.0 > Wan 3.0 > Kling O3/Omni | Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling 3.0 > Kling O3/Omni | yes | 4/5 |
| Complex multi-shot sequence | 15s 16:9 1080p | Seedance 2.5 > Kling O3/Omni > Wan 3.0 > Seedance 2.0 > Flux 3 | Seedance 2.5 > Kling 3.0 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni | yes | 4/5 |
| Long continuous take, 25s | 25s 16:9 1080p | Seedance 2.5 > Wan 3.0 | Seedance 2.5 > Wan 3.0 | yes | 2/2 |
| Animation: anime | 6s 16:9 1080p | MiniMax H3 > Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling O3/Omni | MiniMax H3 > Wan 3.0 > Seedance 2.5 > Seedance 2.0 > Kling 3.0 | yes | 4/5 |
| Animation: 3D cartoon | 6s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Flux 3 | MiniMax H3 > Wan 3.0 > Seedance 2.5 > Seedance 2.0 > Kling 3.0 | no | 3/5 |
| Realistic documentary | 8s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Flux 3 | Seedance 2.5 > Wan 3.0 > MiniMax H3 > Seedance 2.0 > Kling 3.0 | yes | 3/5 |
| Realistic physics: liquid | 5s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Gemini Omni Flash | Wan 3.0 > MiniMax H3 > Seedance 2.0 > Seedance 2.5 > Kling 3.0 | no | 3/5 |
| Product with on-screen text | 6s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Gemini Omni Flash | Wan 3.0 > Seedance 2.0 > Seedance 2.5 > Kling 3.0 > Kling O3/Omni | no | 4/5 |
| Vertical social, 9:16 | 8s 9:16 1080p | Seedance 2.5 > Seedance 2.0 > Wan 3.0 > Kling O3/Omni > Gemini Omni Flash | MiniMax H3 > Wan 3.0 > Seedance 2.0 > Seedance 2.5 > Kling 3.0 | no | 3/5 |
| Horror atmosphere | 8s 16:9 720p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Flux 3 | Wan 3.0 > Seedance 2.5 > MiniMax H3 > Seedance 2.0 > Kling 3.0 | no | 3/5 |
| Sports: fast body motion | 6s 16:9 1080p | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Gemini Omni Flash | Wan 3.0 > Seedance 2.5 > MiniMax H3 > Seedance 2.0 > Kling 3.0 | no | 3/5 |
| High resolution, 4K landscape | 8s 16:9 4K | Seedance 2.5 > Wan 3.0 > Seedance 2.0 > Kling O3/Omni > Flux 3 | Seedance 2.0 > Wan 3.0 > MiniMax H3 > Seedance 2.5 > Kling 3.0 | no | 3/5 |
| Very short insert, 3s | 3s 16:9 720p | Wan 3.0 > Kling O3/Omni > Gemini Omni Flash > Kling 3.0 | Wan 3.0 > Seedance 2.5 > MiniMax H3 > Kling 3.0 > Seedance 2.0 | yes | 2/4 |

## Where we are close

- **Dialogue and drama** (two-person scene, monologue): both pick Seedance 2.5, then Seedance 2.0; 4 of 5 shared.
- **Anime**: both pick MiniMax H3 first.
- **Multi-shot sequence, long 25s take, documentary, 480p draft**: same #1 (Seedance 2.5). On the 25s take both keep only Seedance 2.5 and Wan 3.0 (everything else is too short).
- **3s insert**: both pick Wan 3.0.

## Where we are off, and why

1. **On-screen text read as dialogue (our bug).** "Bold text appears on screen reading \"SILENCE THE WORLD\"" set our *dialogue* trait (any quoted words count) and missed *legible text* (the pattern looks for "text on", "logo", "headline", not "on screen" / "reading"). We ranked by lip sync for a product ad.
2. **"Eyes" means a face close-up (our bug).** The Pixar robot "with big eyes" got the *faces up close* trait.
3. **3D animation is lumped with anime.** "Pixar-style 3D" sets the same *stylized* trait as anime, which sends it to MiniMax H3 (the anime specialist). Dan picks Seedance 2.5 for 3D and H3 only for 2D anime. The research behind H3 is about anime/2D; 3D should be a separate trait.
4. **MiniMax H3 for action and product.** Car chase (H3 87 vs Seedance 86), fight, vertical product ad: our H3 weights for fast motion and product shots are generous. Dan never puts H3 above 1% outside anime. Close calls on our side (1–2 points), so small weight changes flip them.
5. **Wan 3.0 Prime as #1 on plain prompts** (simple walk, horror, sports, liquid, product). With no strong trait, our base scores are a near tie (arena: Wan 3.0, Seedance 2.5, H3 statistically tied) and Wan Prime's quality bump wins by 1–2 points. Dan's default is always Seedance 2.5. For liquid we pick Wan on purpose (Seedance 2.5 failed the spill test in the evidence); that one is a real disagreement, not a bug.
6. **4K landscape**: we pick Seedance 2.0 because it renders 4K and Seedance 2.5 tops out at 1080p. Dan does not filter by resolution and picks Seedance 2.5 anyway. Ours is the one that respects the request.
7. **3s insert**: Dan hides models whose minimum is longer than the shot (Seedance 4s, H3 5s); we keep them with "renders 4s; trim to 3s". A choice, not a bug.

## Costs: are ours accurate?

No. Higgsfield bills **credits per second that depend on resolution** (and audio), and our rate book has one flat
dollar rate per model, from Higgsfield's API price table of 16 Sep 2026.

Your own Higgsfield charges (account transactions, 9–12 Oct) match Dan's per-second credit table exactly for Seedance 2.5:
12 = 4s at 480p (3/s), 15 = 5s at 480p, 28 = 4s at 720p (7/s), 48 = 4s at 1080p (12/s), 96 = 8s at 1080p, 120 = 10s at 1080p.

A credit costs about **$0.033** on your Ultra plan ($99 for 3,000 a month) and **$0.053–0.059** on top-ups.

| Model | Dan credits/s (from his page, checked 1 Oct) | In dollars/s (0.033–0.053/credit) | Ours | Ours vs real |
|---|---|---|---|---|
| Seedance 2.5 | 3 / 7 / 12 (480p / 720p / 1080p) | 0.10–0.16 / 0.23–0.37 / 0.40–0.64 | 0.074 flat | **5–9× too low at 1080p**; only 480p is near |
| Seedance 2.0 | 3 / 4.5 / 9 / 22 (480p–4K) | 0.30–0.48 at 1080p | 0.93 flat | **2–3× too high** |
| Wan 3.0 | 1 / 1.75 / 3.5 | 0.12–0.19 at 1080p | 0.20 | close (a little high) |
| Kling 3.0 Pro (with audio) | 2 at 1080p | 0.07–0.11 | 0.112 | close (high end) |
| Kling O3 | 1.25 / 2 / 6 (720p / 1080p / 4K) | 0.04–0.11 | 0.112 (stand-in) | high at 720p/1080p, **low at 4K** |
| MiniMax H3 | 2 at 2K | 0.07–0.11 | 0.13 | a little high |
| 13 other models | not in his table | — | 0.112 stand-in | unknown |

What this does to the cards: Seedance 2.5 looks far cheaper than it is (at 1080p, a 10s clip shows ≈ $0.74 and really
costs 120 credits, $4–6), so it wins Budget pick it should not, and Seedance 2.0 looks pricier than it is.

The API key path (open.higgsfield.ai) may be billed differently from these subscription credits; Higgsfield publishes no
per-request quote we can read without spending, and none of the 13 stand-in models has a verified rate.
