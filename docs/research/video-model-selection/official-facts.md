# Higgsfield official facts: video models (verified 2026-10-14)

Sources fetched live on 2026-10-14 with curl. Raw copies are in `research/dl/`.
- Root index: https://docs.higgsfield.ai/docs/llms.txt. It no longer links `models.md`. It points to the console (https://console.higgsfield.ai, which redirects to https://open.higgsfield.ai/explore) for model discovery and says to follow each model's own docs. It also says `/docs/openapi.json` is "supplementary, not the authoritative model catalog".
- Model index: https://docs.higgsfield.ai/docs/models.md, which says "The catalog documents 84 entries: 17 Image and 67 Video".
- Video category: https://docs.higgsfield.ai/docs/models/video-generation.md (22 families, 67 entries).
- Family page pattern (linked from the category page): `https://docs.higgsfield.ai/docs/models/<family>.md`. Each has a workflow table with `POST /<endpoint-id>`.
- Workflow page pattern (linked from the family pages): `https://docs.higgsfield.ai/docs/models/<family>/<workflow>.md`. Each has the Endpoint ID, usage notes, ParamFields and a "Complete JSON schema" accordion.
- **Per-model llms.txt:** none exist. All 67 workflow pages link only the global llms.txt.
- Explore pricing: https://open.higgsfield.ai/explore and https://open.higgsfield.ai/explore/video. The prices come from the SSR-embedded catalog data.

Citation shorthand: `[fam/wf]` = `https://docs.higgsfield.ai/docs/models/<fam>/<wf>.md`.

---

## 1. Catalog diff: ours vs upstream

Ours: `backend/lib/providers/higgsfield-models.json`, 82 models (67 video + 15 image), with `skipped: ["soul-id/create-character"]`.

| Check | Result |
|---|---|
| Video endpoint IDs (67 upstream vs 67 ours) | **Identical set.** Nothing new, nothing removed, nothing renamed. |
| Endpoint ID on each page vs its family-table `POST` path | All 67 match. |
| Family slug / workflow slug / page title vs our `family` / `workflow` / `title` | All 67 match. |
| **Input JSON schema** (the "Complete JSON schema" block on each page) vs our `schema` | **All 67 video schemas byte-equal** after JSON parsing. All 15 image schemas we carry are also equal. |
| Usage notes vs our `notes` | 66 of 67 equal. **1 diff, a bug on our side:** `higgsfield/cinema-studio/4.0`. Our note reads "tokens such as `\>>, \>> and \>>`". Upstream reads "`<<<image_1>>>`, `<<<video_1>>>` and `<<<audio_1>>>`". Our scraper dropped the escaped `\<\<\<image\_1>>>` tokens. |
| Image: new upstream, not in ours | **`higgsfield/ads-studio/v1.0`** (Ads Studio, "Generate ads"; brief → 1–8 ad concepts rendered with GPT Image 2.5 Flare) — https://docs.higgsfield.ai/docs/models/ads-studio/generate.md. It is also listed on explore at "from $0.084/image". |
| Image: upstream, intentionally skipped by us | `v1/custom-references` (Soul ID → Create character) — https://docs.higgsfield.ai/docs/models/soul-id/create-character.md. 82 + Ads Studio + Soul ID = 84, which matches upstream. |
| Removed / renamed upstream | None. |
| Explore page (console) | `explore/video` lists 21 video entries. They map 1:1 to the docs families. The two Kling Motion Control families have no separate tile. Kling Omni is titled **"Kling O1 (Omni)"** on explore but "Kling Omni" in docs. Explore also lists `higgsfield/ai-influencer` (image, "$0.05 per sheet") and four "workflows" (graphic-ads, marketplace-design, product-shots, genjutsu). None of these has a docs API page, so they are not REST catalog entries as far as the docs show. |
| openapi.json | Lists only Soul Standard, the Kling 2.5 Turbo ×3 and Hailuo 2.3 ×2 endpoints, plus status and cancel. It is supplementary per llms.txt, so we ignore it for catalog purposes. |
| Legacy aliases (from notes) | Genjutsu motion-transfer and object-swap still accept a misspelled legacy namespace, `higgsfiled/genjutsu/...`. It is hidden from discovery. Use `higgsfield/...`. |

**What I could and could not verify**
- Verified: every doc page listed above, every schema, and every note.
- Not verified:
  - Account-level availability. Docs say "check the API Console for your account". I did not sign in.
  - Per-request credit cost. That needs the authenticated `POST /estimate/<endpoint>`.
  - Full explore catalog contents beyond the SSR payload. The page is client-rendered, and I could not reach a public catalog JSON API.
  - Runtime behaviour beyond what the notes state.
- No "checked" date is published per page, so drift can only be detected by re-diffing.

---

## 2. Per-family facts

Conventions below:
- "AR" means aspect_ratio.
- "—" means no such field in the schema.
- Duration is in seconds. When the schema uses an enum, the allowed values are listed.
- Prompt length limits come from schema `maxLength` or from notes, as cited.
- Native audio: Kling uses `sound` on/off, others use `generate_audio`.
- No video workflow page documents price or credits. Prices in the last section come from the explore listing.

### Seedance 2.0 (ByteDance)

Endpoints: `bytedance/seedance-2.0/{text-to-video, image-to-video, reference-to-video}`

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | int 4–15, default 5 | same | same |
| Resolution | 480p, 720p, 1080p, **4k** (default 720p) | same | same |
| AR | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 (default 16:9) | — (framing follows image_url) | same 6 values |
| Start/end frame | — | `image_url` required, `end_image_url` optional | must not be mixed with image_url / end_image_url / video_url |
| Refs | — | — | image_urls 1–9, video_urls 1–3, audio_urls 1–3. Needs at least one image or video; audio alone is not enough. |
| Native audio | generate_audio, default true | same | same |
| Seed / negative prompt / camera / multi-shot | none | none | none |
| Prompt | minLength 1, required | optional | optional |

Notes:
- Reference videos are trimmed to 15 s each.
- Reference audio is normalized to 2–15 s per file and at most 15 s total.
- Media must be public URLs; `asset://` is rejected.

Source: [seedance-2/text-to-video], [seedance-2/image-to-video], [seedance-2/reference-to-video]

### Seedance 2.5 (ByteDance)

Endpoints: `bytedance/seedance-2.5/{text-to-video, image-to-video, reference-to-video, video-edit, video-extend}`

| Fact | t2v | i2v | r2v | video-edit | video-extend |
|---|---|---|---|---|---|
| Duration | int 4–30, default 5 | same | same | — (derived from source; source normalized to ≥4 s) | int 4–30, default 5 |
| Resolution | 480p / 720p / 1080p (default 720p); **no 4k** | same | same | same | same |
| AR | 6 values (as 2.0) | — | 6 values | — (follows source) | — (follows source) |
| Start/end frame | — | image_url + optional end_image_url | — | — | — |
| Refs | — | — | images ≤30, videos ≤10, audio ≤10, ≤50 total. At least one array; audio-only is allowed. | `video_url` (required) + image_urls ≤30, video_urls ≤10 (the source counts toward the 10, so ≤9 extra), audio ≤10, ≤50 total | same as edit |
| Native audio | generate_audio, default true | same | same | same | same |
| Other | `bitrate_mode` standard/high (default high); **`output_format` mp4/mov (t2v only)** | bitrate_mode | bitrate_mode | bitrate_mode | bitrate_mode |
| Seed / negative prompt / camera / multi-shot | none | none | none | none | none |

Notes:
- The prompt is required for t2v, video-edit and video-extend.
- Video and audio each have a 30 s total budget per media type.

Source: [seedance-2-5/text-to-video], [seedance-2-5/image-to-video], [seedance-2-5/reference-to-video], [seedance-2-5/video-edit], [seedance-2-5/video-extend]

### Kling 2.5 Turbo

Endpoints:
- `kling-video/v2.5-turbo/pro/text-to-video`
- `kling-video/v2.5-turbo/pro/image-to-video`
- `kling-video/v2.5-turbo/standard/image-to-video`

There is no Standard t2v.

| Fact | All 3 |
|---|---|
| Duration | enum 5, 10 (default 5) |
| Resolution / AR | none. Notes: "does not expose a sound or aspect_ratio field". |
| Start frame | i2v: `image_url` required. No end frame. |
| Audio | none |
| cfg_scale | 0–1, default 0.5 |
| Negative prompt | `negative_prompt` string, default "" |
| Seed / multi-shot / camera | none |
| Prompt | required |

Source: [kling-2-5-turbo/pro-text-to-video], [kling-2-5-turbo/pro-image-to-video], [kling-2-5-turbo/standard-image-to-video]

### Kling 2.6

Endpoints: `kling-video/v2.6/pro/{text-to-video, image-to-video}`

| Fact | Value |
|---|---|
| Duration | enum 5, 10 (default 5) |
| AR | 16:9, 9:16, 1:1. t2v default 16:9; i2v has no default. |
| Resolution | — |
| Audio | `sound` on/off, default **on** |
| cfg_scale | 0–1 |
| Start frame | i2v image_url required. No end frame. |
| Seed / negative prompt / multi-shot / camera | none |

Source: [kling-2-6/pro-text-to-video], [kling-2-6/pro-image-to-video]

### Kling 2.6 Motion Control and Kling 3.0 Motion Control

Endpoints: `kling-video/motion-control/{pro, std}` (2.6) and `kling-video/v3/motion-control/{pro, std}` (3.0). The four schemas and notes are identical.

| Fact | Value |
|---|---|
| Inputs | `image_url` (character; ≤10 MB; each side 300–65,536 px; ratio outside 0.4–2.5 is adjusted) + `video_url` (motion reference, 3–30 s; >100 MB is compressed). Both required. |
| Duration | follows the source video. Do not send it. |
| Options | `character_orientation` image/video (default video); `keep_original_sound` yes/no (default yes); prompt optional, default "" |
| Resolution / AR / seed | none |

Source: [kling-2-6-motion-control/pro], [kling-2-6-motion-control/std], [kling-3-motion-control/pro], [kling-3-motion-control/std]

### Kling 3.0

Endpoints:
- `kling-video/v3.0/{std, pro, 4k}/{text-to-video, image-to-video}`
- `kling-video/v3.0-turbo/{text-to-video, image-to-video}`

| Fact | std / pro / 4k (t2v and i2v) | turbo t2v | turbo i2v |
|---|---|---|---|
| Duration | int 3–15, default 5 | int 3–15 | int 3–15 |
| Resolution | — (the tier is the endpoint: std / pro / 4k) | 720p / 1080p (default 720p) | 720p / 1080p |
| AR | t2v: 16:9, 9:16, 1:1 (default 16:9). i2v: none. | 16:9, 9:16, 1:1 | — |
| Audio | `sound` on/off, default **on** | — | — |
| Start/end frame | i2v: `image_url` (required) + `last_image_url` (optional) | — | image_url only, no last frame |
| Multi-shot | `multi_shots` bool + `multi_prompt` (up to 6 shots, each prompt ≤512 chars and duration 1–15). Shot durations are summed for generation and billing. | — | — |
| Elements | `elements` (Kling element IDs owned by the account) | — | — |
| cfg_scale | 0–1 | — | — |
| Prompt limit | Top-level prompt is always required, ≤2,500 chars (truncated beyond) | ≤3,072 chars | ≤2,500 |
| Seed / negative prompt / camera | none | none | none |

Schema quirk: `multi_prompt.minItems` is 1 on std but 0 on pro and 4k. The notes say 1–6 for all three.

Source:
- [kling-3/standard-text-to-video], [kling-3/pro-text-to-video], [kling-3/4k-text-to-video]
- [kling-3/standard-image-to-video], [kling-3/pro-image-to-video], [kling-3/4k-image-to-video]
- [kling-3/turbo-text-to-video], [kling-3/turbo-image-to-video]

### Kling O3

Endpoints: `kling-video/o3/{first-last-frame, image-reference, video-edit, video-reference}`

| Fact | first-last-frame | image-reference | video-edit | video-reference |
|---|---|---|---|---|
| mode (quality tier) | std / pro / **4k**, default pro | std / pro / 4k, default **std** | std / pro / 4k, default pro | std / pro, default pro |
| Duration | int 3–15 | int 3–15 | — (from source) | int 3–10 |
| AR | 16:9, 9:16, 1:1 (no default) | same | — | same |
| Audio | `sound` on/off, default **off** | same | — | — |
| Frames | `first_frame_url` required, `last_frame_url` optional | first_frame_url / last_frame_url optional | — | — |
| Refs | — | `image_urls` (no max in schema), `elements` | exactly 1 video in `video_urls` (3–15.5 s, ≤200 MB); image_urls ≤4; elements ≤4 | exactly 1 video; image_urls ≤4; elements ≤4 |
| Multi-shot | multi_shots + multi_prompt, 1–6 shots, ≤512 chars each | same, plus `shot_type` customize/intelligent | — | — |
| Prompt | ≤2,500 chars (truncated beyond) | same | same, required | same, required |
| Seed / negative prompt / camera | none | none | none | none |

Source: [kling-o3/first-last-frame], [kling-o3/image-reference], [kling-o3/video-edit], [kling-o3/video-reference]

### Kling Omni (titled "Kling O1 (Omni)" on explore)

Endpoints: `kling-video/omni/{first-last-frame, image-reference, video-edit, video-reference}`

| Fact | first-last-frame | image-reference | video-edit | video-reference |
|---|---|---|---|---|
| mode | std / pro, default pro | std / pro | std / pro | std / pro |
| Duration | **enum 5, 10** | int 3–10 | — (source 3–10 s, ≤200 MB) | int 3–10 |
| AR | 16:9, 9:16, 1:1 (default 16:9) | same | — | same |
| Audio | none | none | none | none |
| Frames | `first_frame_url` required + `last_frame_url` optional | — | — | — |
| Refs | — | image_urls (no max in schema) + elements | 1 video + ≤4 images + ≤4 elements | 1 video + ≤4 images + ≤4 elements |
| Multi-shot | none | none | none | none |
| Prompt | required, ≤2,500 chars | same | same | same |

Source: [kling-omni/first-last-frame], [kling-omni/image-reference], [kling-omni/video-edit], [kling-omni/video-reference]

### Happy Horse 1.0 and HappyHorse 1.1 (Alibaba)

Endpoints:
- 1.0: `alibaba/happy-horse/{text-to-video, image-to-video, reference-to-video}`
- 1.1: `alibaba/happy-horse/v1.1/{text-to-video, image-to-video, reference-to-video}`

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | int **3**–15, default 5 | int **2**–15 | int 2–15 |
| Resolution | 720p / 1080p. Default **720p on 1.0, 1080p on 1.1**. | same | same |
| AR | 16:9, 9:16, 1:1, 4:3, 3:4 | — | — |
| Frames | — | image_url (first frame only; last frame not supported) | — |
| Refs | — | — | image_urls 1–9 (enforced at submission, not in the schema). Videos not supported. |
| Seed | int 1–2,147,483,646 | same | same |
| Audio / negative prompt / multi-shot / camera | none in schema | none | none |
| Prompt | required, non-empty | optional | required |

The two versions are identical except for the default resolution.

Source:
- [happy-horse-1/text-to-video], [happy-horse-1/image-to-video], [happy-horse-1/reference-to-video]
- [happy-horse-1-1/text-to-video], [happy-horse-1-1/image-to-video], [happy-horse-1-1/reference-to-video]

### Wan 3.0 and Wan 3.0 Prime (Alibaba)

Endpoints: `alibaba/wan-3.0/{t2v, i2v, r2v}` and `alibaba/wan-3.0-prime/{t2v, i2v, r2v}` (full names: text-to-video, image-to-video, reference-to-video). The schemas are identical across the two.

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | int 2–**30**, default 5 | same | same |
| Resolution | 480p / 720p / 1080p, default **1080p** | same | same |
| AR | 16:9, 4:3, 1:1, 3:4, 9:16, `adaptive` (default adaptive) | same | same |
| Audio | generate_audio, default true | same | same |
| Frames | — | image_url (required) + end_image_url | — |
| Refs | — | — | image_urls ≤10, video_urls ≤5 (each clip 1–30 s, ≤30 s total), audio_urls ≤5 (WAV/MP3, ≤30 s total). Plus `file_url` or `link_url` (document or web page; enables thinking; file_url wins). All refs are optional. |
| Seed | int 0–2,147,483,647. **0 is not forwarded.** | same | same |
| Other | `enable_thinking` bool, default false | same | same |
| Negative prompt / multi-shot / camera | none | none | none |
| Prompt | required | required | required |

Source: [wan-3/text-to-video], [wan-3/image-to-video], [wan-3/reference-to-video], [wan-3-prime/*]

### Wan 2.6

Endpoints: `wan/v2.6/{text-to-video, image-to-video, reference-to-video}`

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | enum 5, 10, 15 | enum 5, 10, 15 | **enum 5, 10** |
| Resolution | 720p / 1080p | **480p** / 720p / 1080p | 720p / 1080p |
| AR | **— (no field)** | — | 16:9, 9:16, 1:1, 4:3, 3:4 |
| Audio | `audio_url` (driving audio input). No generate_audio flag. | audio_url | — |
| Multi-shot | `multi_shots` bool (forces prompt_extend) | same | — |
| Frames | — | image_url (resized to ≤1440 px). No last frame. | — |
| Refs | — | — | video_urls 1–3 (required) |
| Seed | int −1 to 10,000,000 | same | — |
| Negative prompt | — | `negative_prompt` | — |
| Other | prompt_extend | prompt_extend | — |

Source: [wan-2-6/text-to-video], [wan-2-6/image-to-video], [wan-2-6/reference-to-video]

### Wan 2.7

Endpoints: `wan/v2.7/{text-to-video, image-to-video, reference-to-video}`

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | int 2–15 | int 2–15 | int **2–10** |
| Resolution | 720p / 1080p | same | same |
| AR | 16:9, 9:16, 1:1, 4:3, 3:4 | — | **16:9, 9:16 only** |
| Audio | `audio_url` (driving audio) | audio_url | — |
| Frames | — | image_url + `end_image_url` | — |
| Refs | — | — | image_urls + video_urls, combined ≤5 and at least one (enforced at submission) |
| Seed | int 1–2,147,483,646 | same | same |
| Negative prompt | `negative_prompt` | same | same |
| Other | prompt_extend | same | same |
| Multi-shot / camera | none | none | none |

Source: [wan-2-7/text-to-video], [wan-2-7/image-to-video], [wan-2-7/reference-to-video]

### MiniMax H3

Endpoints: `minimax/h3/{text-to-video, image-to-video, reference-to-video}`

| Fact | t2v | i2v | r2v |
|---|---|---|---|
| Duration | int 5–15, default 5 | same | same |
| Resolution | fixed `"2K"` (case-sensitive) | same | same |
| AR | auto, adaptive, 21:9, 16:9, 4:3, 1:1, 3:4, 9:16. auto/adaptive resolve to 16:9 for t2v. | Same values, but output follows the keyframe | same values |
| Frames | — | image_url + end_image_url | — |
| Refs | — | — | image_urls 1–9, video_urls 1–3, audio_urls 0–3. Needs an image or video; audio cannot be used alone. Video and audio each have a 15 s budget. |
| Audio gen | no field | no field | no field |
| Other | `aigc_watermark`, default false | same | same |
| Prompt | required, non-whitespace; only the first 7,000 chars are used | same | same |
| Seed / negative prompt / multi-shot / camera | none | none | none |

Source: [minimax-h3/text-to-video], [minimax-h3/image-to-video], [minimax-h3/reference-to-video]

### Hailuo 2.3 (MiniMax)

Endpoints: `minimax/hailuo-2.3/standard/{text-to-video, image-to-video}`

| Fact | Value |
|---|---|
| Duration | enum 6, 10 (default 6) |
| Resolution | fixed 768P (not configurable) |
| AR | — |
| Frames | i2v image_url (required). No end frame. |
| Other | `prompt_optimizer`, default true |
| Audio / seed / negative prompt | none |
| Prompt | required |

Source: [hailuo-2-3/standard-text-to-video], [hailuo-2-3/standard-image-to-video]

### LTX-2.5 (Lightricks)

Endpoints: `lightricks/ltx-2.5/{text-to-video, image-to-video}/{fast, pro}`

| Fact | Fast | Pro |
|---|---|---|
| Duration | enum 6, 8, 10 (default 6) | same |
| Resolution | 720p, 1080p, **2k, 4k** | 720p, 1080p |
| FPS | 24, 25, 48, 50 | 24, 25, 50 |
| AR | 16:9, 9:16 | same |
| Audio | generate_audio, default true | same |
| Camera | `camera_movement`: dolly_in, dolly_out, dolly_left, dolly_right, jib_up, jib_down, static, focus_shift | same |
| Frames | i2v: image_url (required) + end_image_url | same |
| Prompt | 2–5,000 chars | same |
| Seed / negative prompt / refs / multi-shot | none | none |

Source: [ltx-2-5/text-to-video-fast], [ltx-2-5/text-to-video-pro], [ltx-2-5/image-to-video-fast], [ltx-2-5/image-to-video-pro]

### PixVerse V6

Endpoints: `pixverse/v6/{text-to-video, image-to-video}`

| Fact | t2v | i2v |
|---|---|---|
| Duration | number 1–15 (fractions allowed), default 5 | same |
| Resolution | 360p, 540p, 720p, 1080p | same |
| AR | 16:9, 4:3, 1:1, 3:4, 9:16 | — (from image) |
| Audio | generate_audio, default true | same |
| Frames | — | image_url + end_image_url |
| Seed | int 0–2,147,483,647 | same |
| Negative prompt | 1–2,048 chars | same |
| Prompt | 1–5,000 chars | same |
| Refs / multi-shot / camera | none | none |

Source: [pixverse-v6/text-to-video], [pixverse-v6/image-to-video]

### Grok Imagine Video 1.5 (xAI)

Endpoint: `xai/grok-imagine-video/v1.5/reference-to-video` (single endpoint; text-only, first-frame or reference mode)

| Fact | Value |
|---|---|
| Duration | int 1–15, default 5 |
| Resolution | 480p / 720p / 1080p, default **480p**. 1080p is rejected in reference mode. |
| AR | auto, 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 (default auto) |
| Modes | `image_url` (first frame) **or** references (`image_urls` 0–7 + `audio_url` single audio ref). The two cannot be combined. |
| Audio gen flag | none |
| Image formats | JPEG / PNG / WebP / GIF. No SVG. |
| Seed / negative prompt / multi-shot / camera / end frame | none |
| Prompt | required |

Source: [grok-video-1-5/reference-to-video]

### Cinema Studio 4.0 (Higgsfield)

Endpoint: `higgsfield/cinema-studio/4.0`. It switches between t2v and r2v automatically depending on whether any media array is non-empty.

| Fact | Value |
|---|---|
| Duration | int 4–30, default 5 |
| Resolution | 480p / 720p only (default 720p) |
| AR | 16:9, 4:3, 1:1, 3:4, 9:16, 21:9 |
| Audio | generate_audio, default true |
| Refs | image_urls ≤30, video_urls ≤10, audio_urls ≤10, ≤50 total. Video and audio each have a 30 s budget. Prompt tokens `<<<image_1>>>`, `<<<video_1>>>`, `<<<audio_1>>>`. |
| Camera controls | `camera_movement` (33 values, e.g. dolly-in, crane-up, drone-orbit, whip-pan, bullet-time, static-shot), `camera_model` (modern, 35mm-film, 8mm-film, dv-camcorder), `camera_lens` (5), `camera_aperture` (f14-wide-open, f4-moderate, f11-deep-focus) |
| Style controls | `genre` (6), `era` (5), `light` (6), `pacing` (chaotic, dynamic, calm, single-shot), `color_palette` (50 presets). Omit a control for auto; the literal `"auto"` is rejected. |
| Frames | none (no first/last frame fields) |
| Multi-shot | no explicit field. `pacing` has a "single-shot" value. *Unverified* whether the other pacing values produce multi-cut output. |
| Edit/extend | Not supported here. Use the Seedance 2.5 endpoints. |
| Seed / negative prompt | none |
| Prompt | required, minLength 1 |

Source: https://docs.higgsfield.ai/docs/models/cinema-studio-4/generate.md

### Genjutsu (Higgsfield, video-to-video)

Endpoints: `higgsfield/genjutsu/{motion-transfer, object-swap, restyle}/v1.0`

| Fact | motion-transfer | object-swap | restyle |
|---|---|---|---|
| Inputs | `video_url` (≥4 s; >30 s is trimmed) + `image_urls` 1–8 (required) | same; source must be ≥409,600 px per frame | `video_url` (≥4 s, ≤200 MiB, trimmed to the first 30 s) + `preset_id` (required UUID from `GET /models/higgsfield/genjutsu/restyle/v1.0/presets`) + optional image_urls ≤5 |
| Duration | follows the source | same | follows the source; FPS may differ |
| Resolution | 480p / 720p / 1080p, default 720p | same | same |
| Prompt | optional, ≤10,000 chars | same | same |
| Audio | — | — | keeps the source audio |
| AR / seed / negative prompt | none | none | none (framing derived from source) |

Source: [genjutsu/motion-transfer], [genjutsu/object-swap], [genjutsu/restyle]

---

## 3. Price (explore listing, not per endpoint)

No workflow doc page lists price. The authoritative per-request cost is the authenticated `POST https://api.higgsfield.ai/estimate/<endpoint-id>` with the same body, which returns `{"credits","usd"}` (https://docs.higgsfield.ai/docs/concepts/billing-and-retention.md).

The explore page SSR payload shows family-level **"from"/"exact" USD per second**. Many of these carry time-limited discounts. These numbers are only indicative.

| Family (explore title) | USD/s shown | Original | Discount |
|---|---|---|---|
| Seedance 2.0 | 0.0985 (from) | 0.1407 | 30% |
| Seedance 2.5 | 0.144 (from) | 0.2057 | 30% |
| Kling 2.5 | 0.021 (exact) | 0.042 | 50% |
| Kling 2.6 | 0.035 (from) | 0.07 | 50% |
| Kling 3.0 | 0.042 (exact) | 0.084 | 50% |
| Kling O3 | 0.042 (from) | 0.084 | 50% |
| Kling O1 (Omni) | 0.042 (from) | 0.084 | 50% |
| Happy Horse 1.0 / 1.1 | 0.07 (from) | 0.14 | 50% |
| Wan 2.6 / Wan 2.7 | 0.05 (from) | 0.10 | 50% |
| Wan 3.0 | 0.02 (from) | 0.05 | 60% |
| Wan 3.0 Prime | 0.0272 (from) | 0.068 | 60% |
| MiniMax H3 | 0.065 (exact) | 0.13 | 50% |
| MiniMax Hailuo 2.3 | 0.0117 (from) | 0.0467 | 75% |
| LTX 2.5 Fast | 0.09 (from) | — | — |
| LTX 2.5 Pro | 0.12 (from) | — | — |
| PixVerse 6 | 0.0978 (exact) | 0.115 | 15% |
| Grok Imagine Video 1.5 | 0.08 (from) | — | — |
| Cinema Studio 4.0 | 0.2057 (from) | — | — |
| Genjutsu | 0.159 (from) | 0.318 | 50% |

Not covered by this table:
- Kling 3.0's "exact" price shows against the 4K t2v variant tile. I could not verify per-tier pricing (std, pro, 4k, turbo).
- Kling Motion Control has no separate price entry.

---

## 4. Operational facts (shared docs)

| Topic | Fact | Source |
|---|---|---|
| States | `queued` (cancellable), `in_progress` (not cancellable), plus terminal `completed`, `failed`, `nsfw`, `canceled` | https://docs.higgsfield.ai/docs/concepts/requests.md |
| Submit response | `{status:"queued", request_id, status_url, cancel_url}`. Use the returned URLs; do not build them. | same |
| Cancel | `POST /requests/{id}/cancel` works only while **every job in the request is still queued**. Success is `202` with an empty body. Already started gives `400`; unknown or other account gives `404`. A cancelled request is refunded. | concepts/requests.md; https://docs.higgsfield.ai/docs/api-reference/requests/cancel-a-queued-request.md; concepts/billing-and-retention.md |
| Polling | Start at 2 s, back off ×1.5 to 10 s max, add jitter. Stop on completed / failed / nsfw / canceled. Set an app-level per-model timeout. On a 5xx, retry the GET with backoff; on 401 or 404, stop. For long jobs, prefer webhooks and keep polling as recovery. | https://docs.higgsfield.ai/docs/concepts/polling.md |
| Webhooks | Available. Pass a `?hf_webhook=<urlencoded https url>` query parameter on submit. The POST is sent on **completed, failed, nsfw**; **canceled is not listed**. Envelope is `{request_id, status, error, payload}`, with video at `payload.video.url`. Endpoint must answer 2xx within 10 s. 5xx and network errors are retried for up to 2 h; 4xx is permanent. Duplicates are possible, so dedupe on request_id + status. | https://docs.higgsfield.ai/docs/how-to/webhooks.md |
| Rate limits | Per account and per model. The primary limit is **concurrency** (queued + processing). When hit, the API returns **400** `"Maximum number of concurrent requests (4) has been reached"` (4 is the example value). There is no rate-limit header and no `Retry-After`. The console shows your account's limits. | https://docs.higgsfield.ai/docs/concepts/rate-limits.md |
| Errors | 400 (invalid input or concurrency), 401, 403 (insufficient credits), 404, 422 (validation or idempotency mismatch), 423 (model temporarily blocked), 500, 503 (model disabled or not ready). Each response has an `X-Correlation-ID` header. | https://docs.higgsfield.ai/docs/concepts/errors.md |
| Idempotency | Optional `Idempotency-Key` header (1–255 visible ASCII characters). Replaying returns the original request_id; a changed body returns 422. | https://docs.higgsfield.ai/docs/concepts/idempotency.md |
| Billing | failed and nsfw requests are not charged. Credits expire 1 year after purchase. Use `/estimate/<endpoint>` for cost. | concepts/billing-and-retention.md |
| Retention | Outputs are kept for at least 7 days. | concepts/requests.md; billing-and-retention.md |
| Uploads | `POST /files/generate-upload-url` returns a presigned PUT (valid 1 h) and a `public_url`. Accepted types: jpeg, png, webp, gif, wav, mp4. MP3 is not listed for upload, although Wan 3.0 refs accept MP3 by URL. | https://docs.higgsfield.ai/docs/concepts/file-uploads.md |
