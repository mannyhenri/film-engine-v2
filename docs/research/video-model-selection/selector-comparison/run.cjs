// node run.cjs — every scenario through Dan's selector (public API) and our recommender. Saves both raw.
const fs = require('fs'), path = require('path');
const REPO = '/Users/mannyhenri/code/film-engine-v2';
const rec = require(path.join(REPO, 'backend/lib/model-recommender.js'));
const DIR = __dirname;
const SETS = (process.env.SETS || 'scenarios').split(',');
const scenarios = SETS.flatMap(s => JSON.parse(fs.readFileSync(path.join(DIR, s + '.json'), 'utf8')));
fs.mkdirSync(path.join(DIR, 'dan'), { recursive: true });
fs.mkdirSync(path.join(DIR, 'ours'), { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (const s of scenarios) {
    const danFile = path.join(DIR, 'dan', s.id + '.json');
    if (!fs.existsSync(danFile)) {
      const body = { prompt: s.prompt, startFrameId: null, imageIds: [], videoIds: [], videoDurations: [], duration: s.duration, aspect: s.aspect, resolution: s.resolution };
      const r = await fetch('https://ai-video-model-selector.vercel.app/api/studio/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const text = await r.text();
      if (!r.ok) { console.error(s.id, 'Dan HTTP', r.status, text.slice(0, 200)); process.exitCode = 1; }
      else fs.writeFileSync(danFile, text);
      await sleep(2500);
    }
    const brief = { prompt: s.prompt, duration_s: s.duration, aspect: s.aspect, resolution: s.resolution, shot_count: 1,
      reference_count: 0, has_start_frame: false, dialogue: /"[^"]{3,}"/.test(s.prompt) };
    fs.writeFileSync(path.join(DIR, 'ours', s.id + '.json'), JSON.stringify(rec.recommend(brief), null, 1));
    console.log('ran', s.id);
  }
  // The check: every scenario has a ranking from both.
  const missing = scenarios.filter(s => !fs.existsSync(path.join(DIR, 'dan', s.id + '.json')) || !fs.existsSync(path.join(DIR, 'ours', s.id + '.json')));
  if (missing.length) { console.error('MISSING', missing.map(s => s.id).join(', ')); process.exit(1); }
  console.log(`all ${scenarios.length} scenarios have both rankings`);
})();
