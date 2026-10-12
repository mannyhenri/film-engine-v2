# Manual generation

Film Engine prepares every generation and stops just before sending it. The last screen shows
the prompt and the assets, and you generate in the vendor's own app (Runway, Higgsfield, muapi,
Seedance, Meshy, ElevenLabs, World Labs, Google, OpenAI images, Magnific, Topaz).

## What the last screen gives you

- **Prompt to copy:** the exact text the request would have carried.
- **Settings to match:** model, duration, ratio, seed and so on.
- **Assets, in order:** each one with its role and `@tag`.
  - **Download original:** the file you selected, at full resolution.
  - **Download prepared copy:** the bytes this app had encoded for the API.
- **Copy prompt, settings & asset list:** everything above as one block of text.
- **Close:** ends the request; nothing is sent. In a batch, Previous/Next go through every item
  first.

## What is closed

`backend/lib/manual-generation.js` lists the manual vendors. Four places refuse a manual request:

1. Approving its review.
2. An approval stored before this change.
3. The creative transport.
4. muapi media uploads.

These stay connected: the Gridlight gateway, LLM text (Anthropic, OpenAI text) and local tools
(ffmpeg, FluidSynth, Blender).

A registered kept provider with no review builder (the local Gridlight gateway, FluidSynth) runs
directly, with no review screen, as it did before the review requirement. The Gridlight client and
video runners are restored to the pre-`214cf4a` code that `214cf4a` had blocked.

## How each route reaches the screen

- **Planner routes:** routes with an exact planner are prepared before anything runs.
- **Other routes:** a route without a planner is posted once with no approval, and the provider
  funnel answers with its review.
- **Streamed routes:** the page streams them itself, and each review a stream event announces
  opens as it arrives.

`tools/review-path-inventory.mjs` lists the real routes, and `backend/tests/manual-route-gate.test.js`
holds each one to the screen.

## Known exceptions

- **Jobs submitted before this change:** "Collect saved result" and "Resume existing job" still
  ask that vendor for the result you already paid for. Nothing new is submitted.
- **Keys you no longer need:** keys stored for manual vendors stay in the database until you clear
  them under Settings → API keys ("Stored keys you no longer need").
- **Cross-origin access:** the backend allows every origin by default
  (`CORS_ALLOWED_ORIGINS`). The original-file download only serves media inside the app data
  folder or a project folder. Set `CORS_ALLOWED_ORIGINS` to restrict which pages may call the API
  at all.
