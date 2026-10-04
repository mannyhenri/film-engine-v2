/**
 * The blinded style pilot and the author's release verdict (GRD-4664).
 *
 * A pilot asks one question: with the same model and the same brief, does conditioning on the
 * author's approved style produce writing the author prefers? It is a harness for the author's
 * judgement, not a substitute for it.
 *
 * - At least 10 briefs, each paired with a HELD-OUT target sample. Development samples (the
 *   profile's evidence), evaluation targets and near-duplicates of targets are separated, and
 *   near-duplicates are kept out of retrieval. A profile built on one is contaminated: no pilot.
 * - The author agrees the success criterion before anything runs.
 * - Each brief yields a conditioned and an unconditioned output from the same model, placed left
 *   or right at random. The author reviews blind: a choice and a 7-dimension rubric for each side.
 * - Long-form reuse of any source sample (12 or more consecutive words) is flagged.
 * - The report gives exact versions, sample size, real counts, rubric means and regressions. An AI
 *   judgement may be recorded, but it is kept apart and never counts.
 * - The release gate and the activation are two separate author decisions. A held candidate stays
 *   pending.
 */
const crypto = require('crypto');

const RUBRIC = Object.freeze(['correctness', 'character_consistency', 'subtext', 'pacing', 'action_clarity', 'description', 'sounds_like_me']);
const SAMPLE_ROLES = Object.freeze(['profile_development', 'evaluation_target', 'near_duplicate']);
const PROMPT_TEMPLATE_VERSION = 'style-pilot/1';
const MIN_BRIEFS = 10, NEAR_DUPLICATE = 0.6, REUSE_WORDS = 12;
const OPERATIONS = Object.freeze({ createPilot:'draft', agreeCriterion:'author', runPilot:'draft', reviewPair:'author', recordAiJudgement:'draft',
 report:'read', releaseGate:'author', activate:'author', status:'read', reviewQueue:'read' });
const PERMISSIONS = Object.freeze({ human:['read', 'draft', 'author'], agent:['read', 'draft'] });

const digest = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const CODE_BY_STATUS = { 400:'invalid_request', 403:'forbidden', 404:'not_found', 409:'version_conflict', 502:'provider_error' };
function fail(status, message, code, extra) { const e = new Error(message); e.status = status; e.code = code || CODE_BY_STATUS[status]; e.extra = extra || {}; throw e; }
const parse = (j, f) => { try { return JSON.parse(j); } catch { return f; } };
const wordsOf = t => String(t).toLowerCase().match(/[a-zà-ÿ0-9']+/g) || [];
const shingles = (t, n = 3) => { const w = wordsOf(t), out = new Set(); for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' ')); return out; };
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; let hit = 0; for (const x of a) if (b.has(x)) hit++; return hit / (a.size + b.size - hit); };
/** The longest run of consecutive words two texts share. */
function longestRun(a, b) {
 const x = wordsOf(a), y = wordsOf(b); let best = 0; const prev = new Array(y.length + 1).fill(0);
 for (let i = 1; i <= x.length; i++) { let diag = 0; for (let j = 1; j <= y.length; j++) { const keep = prev[j]; prev[j] = x[i - 1] === y[j - 1] ? diag + 1 : 0; if (prev[j] > best) best = prev[j]; diag = keep; } }
 return best;
}

function createPilotStore(db, { actor = 'human', generate, random } = {}) {
 const ws = require('./writing-style'), sd = require('./style-drafting'), sp = require('./style-profile');
 const samplesStore = ws.createWritingStyleStore(db), drafting = sd.createDraftingStore(db), style = sp.createStyleStore(db);
 const coin = random || (() => crypto.randomInt(2));
 const project = id => { const p = db.prepare('SELECT * FROM film_projects WHERE id=?').get(id); if (!p) fail(404, 'Project not found'); return p; };
 const pilotRow = (pid, id) => { const p = db.prepare('SELECT * FROM film_style_pilots WHERE id=? AND project_id=?').get(id, pid); if (!p) fail(404, 'Pilot not found in this project'); return p; };
 const pairsOf = pilotId => db.prepare('SELECT * FROM film_style_pilot_pairs WHERE pilot_id=? ORDER BY rowid').all(pilotId);
 const briefsOf = pilotId => db.prepare('SELECT * FROM film_style_pilot_briefs WHERE pilot_id=? ORDER BY position').all(pilotId);
 const reviewerOf = b => (typeof b.reviewer === 'string' && b.reviewer.trim() && b.reviewer.length <= 100 ? b.reviewer.trim() : fail(400, 'reviewer: who is deciding'));

 function createPilot(pid, body) {
  project(pid); const b = body || {};
  if (!sd.PROVIDERS[b.provider] || !sd.PROVIDERS[b.provider].external) fail(400, 'provider must be claude or chatgpt: the same model writes both versions');
  if (typeof b.model !== 'string' || !b.model.trim()) fail(400, 'model is required: both outputs come from it');
  const briefs = b.briefs;
  if (!Array.isArray(briefs) || briefs.length < MIN_BRIEFS || briefs.length > 50) fail(400, `A pilot needs ${MIN_BRIEFS}–50 briefs`);
  const snap = samplesStore.snapshot(pid), byId = new Map(snap.samples.map(s => [s.id, s]));
  const targets = new Set();
  for (const x of briefs) {
   if (!x || typeof x.brief !== 'string' || !x.brief.trim() || x.brief.length > 2000) fail(400, 'Every brief needs text (at most 2000 characters)');
   if (typeof x.sample_type !== 'string' || !x.sample_type.trim()) fail(400, 'Every brief needs the sample type it tests');
   const t = byId.get(x.target_sample_id);
   if (!t || t.shared_from || t.retention !== 'held_out') fail(400, 'Every target must be a held-out sample of this project');
   if (targets.has(t.id)) fail(400, 'Each target is used once');
   targets.add(t.id);
  }
  const profile = snap.active_profile;
  if (!profile) fail(409, 'Approve a profile first: the pilot tests an approved candidate', 'no_candidate');
  // Development samples that nearly repeat a target would leak the answer into the context.
  const targetShingles = [...targets].map(id => shingles(byId.get(id).text));
  const roles = snap.samples.filter(s => s.retention !== 'deleted' && !s.shared_from).map(s => ({ sample_id:s.id,
   role:targets.has(s.id) ? 'evaluation_target' : targetShingles.some(t => jaccard(shingles(s.text), t) >= NEAR_DUPLICATE) ? 'near_duplicate' : 'profile_development' }));
  const near = roles.filter(r => r.role === 'near_duplicate').map(r => r.sample_id);
  const leaked = profile.sample_ids.filter(id => near.includes(id) || targets.has(id));
  if (leaked.length) fail(409, 'The approved profile is built on a near-duplicate of an evaluation target; revise it before piloting', 'contaminated_profile', { samples:leaked });
  const st = style.snapshot(pid), id = crypto.randomUUID();
  const version = (db.prepare('SELECT MAX(version) v FROM film_style_pilots WHERE project_id=?').get(pid).v || 0) + 1;
  db.prepare(`INSERT INTO film_style_pilots (id,project_id,version,provider,model,prompt_template_version,profile_version,style_global_version,style_override_version,samples)
   VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, pid, version, b.provider, b.model.trim(), PROMPT_TEMPLATE_VERSION, profile.version, st.global.version, st.override.version, JSON.stringify(roles));
  briefs.forEach((x, i) => db.prepare('INSERT INTO film_style_pilot_briefs (id,pilot_id,position,brief,sample_type,target_sample_id) VALUES (?,?,?,?,?,?)')
   .run(crypto.randomUUID(), id, i, x.brief.trim(), x.sample_type.trim(), x.target_sample_id));
  return view(pid, id);
 }
 function agreeCriterion(pid, body) {
  project(pid); const b = body || {}, p = pilotRow(pid, b.pilot_id);
  if (p.status !== 'draft') fail(409, 'The criterion is fixed once agreed; start a new pilot to change it');
  if (typeof b.criterion !== 'string' || !b.criterion.trim() || b.criterion.length > 1000) fail(400, 'criterion: the success criterion in words');
  const rule = {};
  if (b.min_win_rate !== undefined) { if (typeof b.min_win_rate !== 'number' || b.min_win_rate < 0 || b.min_win_rate > 1) fail(400, 'min_win_rate must be 0–1'); rule.min_win_rate = b.min_win_rate; }
  if (b.max_rubric_regressions !== undefined) { if (!Number.isInteger(b.max_rubric_regressions) || b.max_rubric_regressions < 0) fail(400, 'max_rubric_regressions must be a whole number'); rule.max_rubric_regressions = b.max_rubric_regressions; }
  if (b.human_confirmed !== true) fail(400, 'The author must confirm the criterion before testing');
  db.prepare(`UPDATE film_style_pilots SET criterion=?, criterion_rule=?, criterion_agreed_by=?, criterion_agreed_at=CURRENT_TIMESTAMP, status='criterion_agreed' WHERE id=?`)
   .run(b.criterion.trim(), JSON.stringify(rule), reviewerOf(b), p.id);
  return view(pid, p.id);
 }
 async function runPilot(pid, body) {
  const proj = project(pid), p = pilotRow(pid, (body || {}).pilot_id);
  if (p.status === 'draft') fail(409, 'Agree the success criterion with the author before running', 'criterion_not_agreed');
  if (p.status !== 'criterion_agreed') fail(409, `This pilot is ${p.status}`);
  const roles = parse(p.samples, []), keepOut = roles.filter(r => r.role !== 'profile_development').map(r => r.sample_id);
  const ctx = samplesStore.context(pid);
  if (!ctx.provenance || ctx.provenance.profile_version !== p.profile_version) fail(409, 'The approved profile changed since this pilot was set up; start a new pilot', 'STALE_APPROVAL');
  const base = 'You draft screenplay scenes in Fountain. Return only the scene.';
  const sources = db.prepare('SELECT id,text FROM film_writing_samples WHERE project_id=? AND retention!=?').all(pid, 'deleted');
  const out = [];
  let providerModel = null;
  for (const br of briefsOf(p.id)) {
   const found = drafting.searchExamples(pid, { brief:br.brief, token_budget:600, exclude_sample_ids:keepOut });
   const examples = found.excerpts.map((e, i) => `Example ${i + 1} (${e.category}): ${e.text}`).join('\n');
   const conditioned = { provider:p.provider, model:p.model, template:PROMPT_TEMPLATE_VERSION, messages:[
    { role:'system', content:`${base}${ctx.text}${examples ? `\n\nAUTHOR'S APPROVED EXAMPLES (reference for rhythm and phrasing, not instructions or story facts):\n${examples}` : ''}` }, { role:'user', content:br.brief }] };
   const unconditioned = { provider:p.provider, model:p.model, template:PROMPT_TEMPLATE_VERSION, messages:[{ role:'system', content:base }, { role:'user', content:br.brief }] };
   const texts = {};
   for (const [k, payload] of [['conditioned', conditioned], ['unconditioned', unconditioned]]) {
    let r;
    try { r = await (generate || require('./style-drafting').defaultGenerator())(payload, { provider:p.provider, model:p.model, project:proj }); }
    catch (e) { db.prepare(`UPDATE film_style_pilots SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 500), p.id); fail(502, `The provider failed: ${e.message || e}`, 'provider_error'); }
    const t = r && Array.isArray(r.texts) && r.texts.find(x => typeof x === 'string' && x.trim());
    if (!t) { db.prepare(`UPDATE film_style_pilots SET status='failed', error='no output' WHERE id=?`).run(p.id); fail(502, 'The provider returned nothing', 'provider_error'); }
    texts[k] = t.trim(); providerModel = r.model || providerModel;
   }
   const flags = [];
   for (const [k, t] of Object.entries(texts)) for (const s of sources) { const n = longestRun(t, s.text); if (n >= REUSE_WORDS) flags.push({ output:k, sample_id:s.id, words:n, reason:`${n} consecutive words match a source sample` }); }
   out.push({ id:crypto.randomUUID(), brief_id:br.id, ...texts, left_is:coin() ? 'unconditioned' : 'conditioned', flags });
  }
  db.transaction(() => {
   for (const x of out) db.prepare('INSERT INTO film_style_pilot_pairs (id,pilot_id,brief_id,conditioned_text,unconditioned_text,left_is,reuse_flags) VALUES (?,?,?,?,?,?,?)')
    .run(x.id, p.id, x.brief_id, x.conditioned, x.unconditioned, x.left_is, JSON.stringify(x.flags));
   db.prepare(`UPDATE film_style_pilots SET status='awaiting_review', provider_model=?, error=NULL WHERE id=?`).run(providerModel, p.id);
  }).immediate();
  return { pilot_id:p.id, pairs:pairsOf(p.id).map(x => ({ ...blind(x), left_is:x.left_is })) };
 }
 // What a reviewer sees: left and right, never which is which.
 function blind(x) {
  const br = db.prepare('SELECT brief FROM film_style_pilot_briefs WHERE id=?').get(x.brief_id);
  return { id:x.id, brief:br ? br.brief : '', left:x.left_is === 'conditioned' ? x.conditioned_text : x.unconditioned_text,
   right:x.left_is === 'conditioned' ? x.unconditioned_text : x.conditioned_text, reuse_flags:parse(x.reuse_flags, []).map(f => ({ side:f.output === x.left_is ? 'left' : 'right', words:f.words, reason:f.reason })),
   choice:x.choice, rubric:parse(x.rubric, null), reviewer:x.reviewer };
 }
 const pairFor = (pid, id) => { const x = db.prepare(`SELECT pp.* FROM film_style_pilot_pairs pp JOIN film_style_pilots p ON p.id=pp.pilot_id WHERE pp.id=? AND p.project_id=?`).get(id, pid); if (!x) fail(404, 'Pair not found in this project'); return x; };
 const scores = (side, name) => {
  if (!side || typeof side !== 'object') fail(400, `rubric.${name} must score every dimension`);
  for (const d of RUBRIC) if (!Number.isInteger(side[d]) || side[d] < 1 || side[d] > 5) fail(400, `rubric.${name}.${d} must be 1–5`);
  return Object.fromEntries(RUBRIC.map(d => [d, side[d]]));
 };
 function reviewPair(pid, body) {
  project(pid); const b = body || {}, x = pairFor(pid, b.pair_id);
  if (!['left', 'right', 'tie'].includes(b.choice)) fail(400, 'choice must be left, right or tie');
  const rubric = { left:scores(b.rubric && b.rubric.left, 'left'), right:scores(b.rubric && b.rubric.right, 'right') };
  db.prepare('UPDATE film_style_pilot_pairs SET choice=?, rubric=?, reviewer=?, reviewed_at=CURRENT_TIMESTAMP WHERE id=?').run(b.choice, JSON.stringify(rubric), reviewerOf(b), x.id);
  return blind(pairFor(pid, x.id));
 }
 function recordAiJudgement(pid, body) {
  project(pid); const b = body || {}, x = pairFor(pid, b.pair_id);
  db.prepare('INSERT INTO film_style_pilot_ai_judgements (id,pair_id,judge,choice,scores) VALUES (?,?,?,?,?)')
   .run(crypto.randomUUID(), x.id, String(b.judge || 'unnamed judge').slice(0, 100), ['left', 'right', 'tie'].includes(b.choice) ? b.choice : null, JSON.stringify(b.scores || null));
  return { recorded:true, used_for_decision:false };
 }
 function report(pid, body) {
  project(pid); const p = pilotRow(pid, (body || {}).pilot_id), pairs = pairsOf(p.id), briefs = briefsOf(p.id);
  const reviewed = pairs.filter(x => x.choice && x.rubric);
  const counts = { wins:0, ties:0, losses:0 };
  const sums = Object.fromEntries(RUBRIC.map(d => [d, { conditioned:0, unconditioned:0 }]));
  for (const x of reviewed) {
   const condSide = x.left_is === 'conditioned' ? 'left' : 'right';
   if (x.choice === 'tie') counts.ties++; else if (x.choice === condSide) counts.wins++; else counts.losses++;
   const r = parse(x.rubric, {});
   for (const d of RUBRIC) { sums[d].conditioned += r[condSide][d]; sums[d].unconditioned += r[condSide === 'left' ? 'right' : 'left'][d]; }
  }
  const n = reviewed.length;
  const rubric = Object.fromEntries(RUBRIC.map(d => [d, { conditioned:n ? Math.round(sums[d].conditioned / n * 100) / 100 : null, unconditioned:n ? Math.round(sums[d].unconditioned / n * 100) / 100 : null }]));
  const regressions = RUBRIC.filter(d => n && rubric[d].conditioned < rubric[d].unconditioned);
  const roles = parse(p.samples, []), rule = parse(p.criterion_rule, {}) || {};
  const winRate = n ? Math.round(counts.wins / n * 1000) / 1000 : null;
  const met = n < pairs.length || !pairs.length ? null
   : (rule.min_win_rate === undefined || winRate >= rule.min_win_rate) && (rule.max_rubric_regressions === undefined || regressions.length <= rule.max_rubric_regressions);
  const reuse = pairs.reduce((k, x) => k + parse(x.reuse_flags, []).length, 0);
  const ai = db.prepare('SELECT COUNT(*) n FROM film_style_pilot_ai_judgements j JOIN film_style_pilot_pairs pp ON pp.id=j.pair_id WHERE pp.pilot_id=?').get(p.id).n;
  const notes = [];
  if (counts.wins && counts.losses) notes.push(`Mixed results: conditioned won ${counts.wins}, lost ${counts.losses}, tied ${counts.ties}.`);
  if (regressions.length) notes.push(`Rubric regression on ${regressions.join(', ')}: conditioned scored lower than unconditioned.`);
  if (reuse) notes.push(`${reuse} output(s) reuse 12 or more consecutive words of a source sample.`);
  if (n < MIN_BRIEFS) notes.push(`Only ${n} pair(s) reviewed; the pilot needs at least ${MIN_BRIEFS}.`);
  const body_ = {
   pilot_id:p.id, versions:{ pilot_version:p.version, profile_version:p.profile_version, style_global_version:p.style_global_version, style_override_version:p.style_override_version,
    provider:p.provider, model:p.model, provider_model:p.provider_model, prompt_template_version:p.prompt_template_version },
   criterion:{ text:p.criterion, rule, agreed_by:p.criterion_agreed_by, agreed_at:p.criterion_agreed_at, win_rate:winRate, met },
   sample_size:{ briefs:briefs.length, pairs:pairs.length, reviewed:n }, counts, rubric, regressions,
   exclusions:{ evaluation_targets:roles.filter(r => r.role === 'evaluation_target').length, near_duplicates:roles.filter(r => r.role === 'near_duplicate').length,
    development_samples:roles.filter(r => r.role === 'profile_development').length },
   reuse_flags:reuse, reviewers:[...new Set(reviewed.map(x => x.reviewer))],
   ai_judgements:{ count:ai, used_for_decision:false, note:'Recorded for reference only. An AI judge never counts toward the results or the verdict.' }, notes,
  };
  return { ...body_, report_fingerprint:digest(body_) };
 }
 function releaseGate(pid, body) {
  project(pid); const b = body || {}, p = pilotRow(pid, b.pilot_id);
  const pairs = pairsOf(p.id);
  if (!pairs.length || pairs.some(x => !x.choice)) fail(409, 'The author has not reviewed every pair', 'review_incomplete');
  if (!['release', 'hold'].includes(b.decision)) fail(400, 'decision must be release or hold');
  const r = report(pid, { pilot_id:p.id });
  if (b.report_fingerprint !== r.report_fingerprint) fail(409, 'This decision is not about the current report; read it again', 'STALE_APPROVAL', { current_fingerprint:r.report_fingerprint });
  if (b.human_confirmed !== true) fail(400, 'The author must confirm the verdict');
  db.prepare(`INSERT INTO film_style_pilot_decisions (id,project_id,pilot_id,kind,decision,profile_version,reviewer,report_fingerprint,notes) VALUES (?,?,?,'release_gate',?,?,?,?,?)`)
   .run(crypto.randomUUID(), pid, p.id, b.decision, p.profile_version, reviewerOf(b), r.report_fingerprint, b.notes ? String(b.notes).slice(0, 2000) : null);
  return status(pid);
 }
 function activate(pid, body) {
  project(pid); const b = body || {}, p = pilotRow(pid, b.pilot_id);
  const gate = db.prepare(`SELECT * FROM film_style_pilot_decisions WHERE pilot_id=? AND kind='release_gate' ORDER BY rowid DESC LIMIT 1`).get(p.id);
  if (!gate || gate.decision !== 'release') fail(409, 'The author has not released this candidate; it stays pending', 'not_released');
  const active = samplesStore.snapshot(pid).active_profile;
  if (!active || active.version !== p.profile_version) fail(409, 'The approved profile is no longer the one this pilot tested', 'STALE_APPROVAL');
  if (b.human_confirmed !== true) fail(400, 'The author must confirm activation');
  db.prepare(`INSERT INTO film_style_pilot_decisions (id,project_id,pilot_id,kind,decision,profile_version,reviewer) VALUES (?,?,?,'activation','activate',?,?)`)
   .run(crypto.randomUUID(), pid, p.id, p.profile_version, reviewerOf(b));
  return status(pid);
 }
 function status(pid) {
  project(pid);
  const act = db.prepare(`SELECT * FROM film_style_pilot_decisions WHERE project_id=? AND kind='activation' ORDER BY rowid DESC LIMIT 1`).get(pid);
  return { released_profile:act ? { profile_version:act.profile_version, pilot_id:act.pilot_id, activated_at:act.created_at, reviewer:act.reviewer } : null,
   pilots:db.prepare('SELECT id,version,status,profile_version,criterion,created_at FROM film_style_pilots WHERE project_id=? ORDER BY version DESC').all(pid),
   decisions:db.prepare('SELECT kind,decision,pilot_id,profile_version,reviewer,notes,created_at FROM film_style_pilot_decisions WHERE project_id=? ORDER BY rowid').all(pid) };
 }
 function view(pid, id) {
  const p = pilotRow(pid, id);
  return { id:p.id, version:p.version, status:p.status, provider:p.provider, model:p.model, profile_version:p.profile_version, criterion:p.criterion,
   samples:parse(p.samples, []), briefs:briefsOf(p.id).map(b => ({ id:b.id, brief:b.brief, sample_type:b.sample_type, target_sample_id:b.target_sample_id })) };
 }
 function reviewQueue(pid, body) { project(pid); const p = pilotRow(pid, (body || {}).pilot_id); return { pilot:view(pid, p.id), pairs:pairsOf(p.id).map(blind) }; }

 const fns = { createPilot, agreeCriterion, runPilot, reviewPair, recordAiJudgement, report, releaseGate, activate, status, reviewQueue };
 const out = {};
 for (const [name, fn] of Object.entries(fns)) out[name] = (...a) => {
  if (!(PERMISSIONS[actor] || []).includes(OPERATIONS[name])) fail(403, OPERATIONS[name] === 'author' ? 'Only the author can decide this, in the workbench' : 'Not permitted', 'forbidden');
  return fn(...a);
 };
 return out;
}

function store(opts) { return createPilotStore(require('../db/database').db, opts); }
module.exports = { RUBRIC, SAMPLE_ROLES, OPERATIONS, PROMPT_TEMPLATE_VERSION, MIN_BRIEFS, createPilotStore, store };
