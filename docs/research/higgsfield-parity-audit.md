# Higgsfield catalog, selector parity, and cost audit

Captured 2026-10-15 UTC (2026-10-14 Toronto).

## Scope and evidence

- All 128 website model IDs returned by Higgsfield `models_list`, with pagination exhausted: 57 video, 45 image, 18 3D, 8 audio. Exact provider names, parameters, aspect ratios, aliases and variants are preserved in `backend/lib/providers/higgsfield-web-models.json`.
- All 83 public API modes across 31 catalog entries, including all 160 published pricing configuration samples, from https://dash.higgsfield.ai/api/v2/pricing/models/?page_size=50 . Original/list prices and promotional prices are kept separately; no discount is assumed for this install.
- 83 documented endpoint schemas after fixing the Ads Studio response parser. Public modes without a documented schema are named in the full catalog and open the Playground; documented source-clip workflows are accounted separately.
- 67 deduplicated video choices: the 24 REST choices and 43 additional website entries. Every recommendation accounts for all 67, eligible or refused with a reason. The full catalog also exposes all specialized image, audio and 3D tools.
- Twelve fresh calls to Dan Kieft’s public selector at https://ai-video-model-selector.vercel.app/api/studio/evaluate . Request bodies and complete returned responses are in `backend/tests/fixtures/jev-comparisons.json`. No Generate action was used.
- 183 website cost-only preflights, 152 successful, covering 92 distinct models. No generation or media upload was submitted. Exact sample settings and returned prices/errors are in `backend/lib/providers/higgsfield-credit-quotes.json`.

## Selection results

The original rule set matched 4/12 new top-family choices; the revised rule set matches 12/12. This is observed behavior matching, not recovery of Jev’s private classifier or a claim about unseen prompts. The primary ordering defaults to Seedance 2.5, then Seedance 2.0; anime and drawn cartoons prefer MiniMax H3. Claymation stays with Seedance. Realism and heavy dialogue lower Wan’s priority. Flux is a voice-acting alternative.

| Test | Jev choice | Local choice |
|---|---|---|
| neutral | seedance | seedance-2-5 |
| anime | h3 | minimax-h3 |
| cartoon | h3 | minimax-h3 |
| clay | seedance | seedance-2-5 |
| dialogue | seedance | seedance-2-5 |
| realistic | seedance | seedance-2-5 |
| action | seedance | seedance-2-5 |
| product | seedance | seedance-2-5 |
| aerial | seedance | seedance-2-5 |
| long | seedance | seedance-2-5 |
| ugc | seedance | seedance-2-5 |
| 4k | seedance | seedance-2-5 |

Percentages use the public UI’s adaptive-exponent and largest-remainder share calculation. They are recommendation shares, not success rates. Additional catalog entries stay available without diluting the reference comparison. The budget rule compares current website credit estimates among strong candidates of comparable duration; a top pick can also be the budget pick.

Intentional differences: keep usable Kling alternatives instead of copying the reference’s repeated zero-score/missing-reason behavior; show unavailable models with reasons; show all additional catalog choices. Unsupported resolution remains visible as a tradeoff rather than silently claiming native output. The current prices replace outdated estimates on the reference site.

## Pricing findings

At 1080p, the authenticated website quotes are Seedance 2.5: 80 credits/5s and 160/10s (16/sec); Seedance 2.0: 60/5s and 120/10s (12/sec). The reference frontend still lists 12/sec and 9/sec respectively. All 18 secondary-duration checks on the primary comparison families confirmed linear rates at the sampled settings. Other durations/shapes/reference combinations remain estimates.

Website subscription credits and API USD are separate billing systems. No universal credit-to-dollar conversion is used. A quote sample is not a paid receipt and does not validate that required media is ready. Public API samples do not enumerate every possible setting: unpublished configurations are explicitly conservative sample maxima, not exact quotes or guaranteed ceilings. Request review and usage metering now price from actual endpoint/configuration fields when a published match exists. Unpriced legacy models remain named unknowns, never free.

## Deferred exact quotes

The following 36 models are fully listed but cannot be given a verified generic price with the available cost-only interfaces and inputs. Required media/style selections are not invented. Audio/3D have no exposed cost-only quote route. They show “Quote required” with their reason in the catalog.

| Model ID | Output | Reason |
|---|---|---|
| `ms_image` | image | style_id is required for DTC Ads |
| `higgsfield_preset` | video | Higgsfield Preset requires one reference media item. Allowed roles: [image]. |
| `sam_3_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `multi_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `3d_rigging` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_multi_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_rigging` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `seed_audio` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `qwen_audio_tts` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `elevenlabs_v4` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `elevenlabs_v4_turbo` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `sonilo_music` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `mirelo_text_to_audio` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `inworld_text_to_speech` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `text2speech_v2` | audio | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `ad_multiplier_v2` | video | ad_multiplier_v2 requires source media or an unsupported cost-estimation backend |
| `topaz_image` | image | topaz_image requires source media or an unsupported cost-estimation backend |
| `topaz_image_generative` | image | topaz_image_generative requires source media or an unsupported cost-estimation backend |
| `topaz_hyperion_2_5` | video | topaz_hyperion_2_5 requires source media or an unsupported cost-estimation backend |
| `topaz_video` | video | topaz_video requires source media or an unsupported cost-estimation backend |
| `clipify` | video | clipify requires source media or an unsupported cost-estimation backend |
| `hf_mult_motion_control` | video | hf_mult_motion_control requires source media or an unsupported cost-estimation backend |
| `hf_mult_replace_object` | video | hf_mult_replace_object requires source media or an unsupported cost-estimation backend |
| `sam_3_3d_body` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `tripo_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `tripo_h3_1_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `tripo_h3_1_multiview_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `tripo_p2_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `hunyuan3d_v3_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_v6_text_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `hunyuan3d_v3_1_text_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_v5_remesh` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_v5_retexture` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |
| `meshy_v7_image_to_3d` | 3d | No cost-only quote route for this model; quote on Higgsfield with the required inputs |

## Verification

The test-first check was `node --test backend/tests/higgsfield-parity.test.js`: first 0 passed / 6 failed, including the observed top-family mismatches, missing full-catalog support and stale rates. Later tests caught configuration pricing and website duration derivation before their fixes.

Verification commands:

- `node --test backend/tests/higgsfield-parity.test.js`
- `node tools/backend-tests.js higgsfield-parity.test.js higgsfield.test.js production-studio.test.js generator-costs.test.js final-request-review.test.js ai-spend.test.js dry-run.test.js manual-generation.test.js`
- `npx vitest run src/pages/productiongraph/studio/ProductionStudio.test.jsx src/components/FinalRequestReview/ManualGeneration.test.jsx`
- `npx vite build`

Browser QA used the actual GenerateTab/catalog components with an isolated fixture, preserving production project data. Checked catalog search, exact model IDs, external-model handoffs, desktop width 1905 and mobile width 375; no horizontal overflow. The existing Electron backend caches modules; restart the app to load the revised backend catalog. Manual generation policy is preserved.
