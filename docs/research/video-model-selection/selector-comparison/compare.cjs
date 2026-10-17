// node compare.cjs > report.json — our ranking vs Dan's, per scenario, on the models both rank.
const fs = require('fs'), path = require('path');
const DIR = __dirname;
const SETS = (process.env.SETS || 'scenarios').split(',');
const scenarios = SETS.flatMap(s => JSON.parse(fs.readFileSync(path.join(DIR, s + '.json'), 'utf8')));

// Our Higgsfield ids → Dan's ids. Dan ranks 8 models; 6 are on both sides (Gemini Omni Flash and Flux 3 are his only).
const TO_DAN = { 'seedance-2-5': 'seedance', 'seedance-2': 'seedance-2', 'wan-3': 'wan', 'wan-3-prime': 'wan',
  'kling-3-pro': 'kling', 'kling-3-standard': 'kling', 'kling-3-turbo': 'kling', 'kling-3-4k': 'kling', 'kling-o3': 'kling-omni', 'kling-omni': 'kling-omni', 'minimax-h3': 'h3', 'website:flux_3_video': 'flux', 'website:gemini_omni_flash_1_1': 'gemini-omni' };
const SHARED = ['seedance', 'seedance-2', 'wan', 'kling', 'kling-omni', 'h3', 'flux', 'gemini-omni'];
const NAME = { seedance: 'Seedance 2.5', 'seedance-2': 'Seedance 2.0', wan: 'Wan 3.0', kling: 'Kling 3.0', 'kling-omni': 'Kling O3/Omni', h3: 'MiniMax H3', 'gemini-omni': 'Gemini Omni Flash', flux: 'Flux 3' };

// Dan's page limits (min/max seconds per model, from his page.js), so his list is read the way his page shows it.
const DAN_LIMITS = { seedance: [4, 30], 'seedance-2': [4, 15], wan: [2, 30], kling: [3, 15], 'kling-omni': [3, 15], h3: [5, 15], 'gemini-omni': [3, 10], flux: [5, 20] };
function danRanking(d, s) {
  // As his page orders it: blocked and out-of-length cards hidden, "no advantage" after the rest, then by fit score.
  const fits = c => { const l = DAN_LIMITS[c.id]; return !l || (s.duration >= l[0] && s.duration <= l[1]); };
  return d.cards.map((c, i) => ({ ...c, i })).filter(c => !c.blocked && fits(c))
    .sort((a, b) => Number(!!a.noAdvantage) - Number(!!b.noAdvantage) || b.fitScore - a.fitScore || a.i - b.i)
    .map(c => ({ id: c.id, fit: c.fitScore, share: c.probability, noAdvantage: c.noAdvantage, reason: c.reason }));
}
function ourRanking(o) {
  const seen = new Set(), shared = [], all = [];
  for (const c of o.cards) {
    all.push({ id: c.id, label: c.label, fit: c.fit, top: c.top, budget: c.budget, usd: c.est_usd });
    const d = TO_DAN[c.id];
    if (d && !seen.has(d)) { seen.add(d); shared.push({ id: d, ours: c.id, fit: c.fit }); }
  }
  return { shared, all, blocked: o.blocked.map(b => ({ id: b.id, why: b.why })), traits: o.traits };
}
function spearman(a, b) {   // rank agreement on the models both rank (−1..1)
  const common = a.filter(x => b.includes(x));
  if (common.length < 3) return null;
  const ra = common.map(x => a.indexOf(x)), rb = common.map(x => b.indexOf(x));
  const rank = arr => { const s = [...arr].sort((x, y) => x - y); return arr.map(v => s.indexOf(v)); };
  const x = rank(ra), y = rank(rb), n = common.length;
  const d2 = x.reduce((t, v, i) => t + (v - y[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

const rows = scenarios.map(s => {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, 'dan', s.id + '.json'), 'utf8'));
  const o = JSON.parse(fs.readFileSync(path.join(DIR, 'ours', s.id + '.json'), 'utf8'));
  const dan = danRanking(d, s), ours = ourRanking(o);
  const danShared = dan.map(c => c.id).filter(id => SHARED.includes(id));
  const oursShared = ours.shared.map(c => c.id);
  const top5Dan = dan.slice(0, 5).map(c => c.id), top5Ours = oursShared.slice(0, 5);
  return {
    id: s.id, label: s.label, settings: `${s.duration}s ${s.aspect} ${s.resolution}`,
    dan_scene: [d.sceneType, ...(d.sceneLabels || [])].filter((v, i, a) => a.indexOf(v) === i).join(', '), dan_dialogue: d.dialogue,
    dan_top: dan[0] && dan[0].id, dan_top_shared: danShared[0], ours_top: ours.all[0] && ours.all[0].id, ours_top_shared: oursShared[0],
    top1_agree: danShared[0] === oursShared[0],
    dan_top5: top5Dan, ours_top5_shared: top5Ours, ours_top5_all: ours.all.slice(0, 5).map(c => c.id),
    overlap_top5: top5Ours.filter(id => top5Dan.includes(id)).length,
    shared_ranked_by_dan: danShared.length,
    spearman: spearman(danShared, oursShared),
    dan_blocked: d.cards.filter(c => c.blocked).map(c => c.id), ours_blocked_shared: [...new Set(ours.blocked.map(b => TO_DAN[b.id]).filter(Boolean))],
    ours_traits: ours.traits,
    dan_cards: dan, ours_cards: ours.all,
  };
});
fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(rows, null, 1));
const agree = rows.filter(r => r.top1_agree).length;
const meanOverlap = rows.reduce((t, r) => t + r.overlap_top5, 0) / rows.length;
const sp = rows.map(r => r.spearman).filter(v => v !== null);
console.log(`scenarios ${rows.length} | top pick agrees (shared models) ${agree}/${rows.length} | mean top-5 overlap ${meanOverlap.toFixed(2)} | mean rank agreement ${(sp.reduce((a, b) => a + b, 0) / sp.length).toFixed(2)} over ${sp.length}`);
for (const r of rows) console.log(`${r.id.padEnd(20)} Dan ${String(r.dan_top).padEnd(11)} | ours ${String(r.ours_top).padEnd(18)} | shared top: ${r.dan_top_shared}/${r.ours_top_shared} ${r.top1_agree ? '✓' : '✗'} | overlap ${r.overlap_top5}/5 | rho ${r.spearman === null ? '—' : r.spearman.toFixed(2)} | Dan: ${r.dan_top5.map(i => NAME[i]).join(' > ')} | ours: ${r.ours_top5_shared.map(i => NAME[i]).join(' > ')}`);
