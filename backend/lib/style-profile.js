/**
 * Evidence-backed style traits (GRD-4662).
 *
 * A TRAIT is one plain-language rule or anti-pattern. It resolves to evidence (excerpts with their
 * location in eligible samples), or it is labelled an explicit user rule with where the user said it.
 * Its source says whether it is the author's recurring style or a genre, scene or character
 * requirement; only author style may enter the global profile.
 *
 * Two layers of immutable versions hold the active traits: the author's global StyleProfileVersion,
 * and each project's ProjectStyleOverride (traits added for the project, global traits disabled for
 * it). A change, removal or rollback writes a new version whose parent is the one it replaces. The
 * database refuses updates to old versions.
 *
 * LEARNING ONLY PROPOSES. Corrections and pairwise choices create pending proposals; a proposal
 * becomes active only when the author accepts it with its exact fingerprint. A correction defaults
 * to the scene it was made in and reaches the global profile only when scoped global and approved.
 *
 * PRECEDENCE: scene instructions and screenplay facts, then the project layer, then the global
 * layer. A lower trait that conflicts is suppressed and reported, never resolved silently, and a
 * dialogue trait never overrides a character's declared voice.
 */
const crypto = require('crypto');

const TRAIT_KINDS = Object.freeze(['rule', 'anti_pattern']);
const TRAIT_SOURCES = Object.freeze(['author_style', 'genre', 'scene', 'character']);
const RUBRIC_DIMENSIONS = Object.freeze(['rhythm', 'dialogue_voice', 'description_density', 'humor', 'tension']);
const CORRECTION_SCOPES = Object.freeze(['scene', 'project', 'global']);
const LAYERS = Object.freeze(['scene', 'project', 'global']);
const TARGETS = Object.freeze(['global', 'project']);
const DIMENSION_CATEGORY = Object.freeze({ rhythm:'general', dialogue_voice:'dialogue', description_density:'description', humor:'comedy', tension:'suspense' });
// Proposing is open to an agent; deciding what becomes active is the author's.
const STYLE_OPERATIONS = Object.freeze({ snapshot:'read', resolve:'read', proposeTrait:'propose', recordCorrection:'propose', createPairwise:'propose',
 choosePairwise:'propose', modifyProposal:'propose', acceptProposal:'apply', rejectProposal:'apply', removeTrait:'apply', restore:'apply' });

const digest = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const CODE_BY_STATUS = { 400:'invalid_request', 403:'forbidden', 404:'not_found', 409:'version_conflict' };
function fail(status, message, code, extra) { const e = new Error(message); e.status = status; e.code = code || CODE_BY_STATUS[status]; e.extra = extra || {}; throw e; }
const text = (v, name, min, max) => { if (typeof v !== 'string' || v.trim().length < min || v.length > max) fail(400, `${name} must be ${min}–${max} characters`); return v.trim(); };
const label = kind => (kind === 'anti_pattern' ? 'anti-pattern' : 'rule');
const parse = (j, f) => { try { return JSON.parse(j); } catch { return f; } };

/** Plain-language lines for what changed between two trait lists. */
function diffTraits(prev, next) {
 const lines = [], before = new Map(prev.map(t => [t.id, t])), after = new Map(next.map(t => [t.id, t]));
 for (const t of next) if (!before.has(t.id)) lines.push(`Added ${label(t.kind)}: ${t.statement}`);
 for (const t of prev) if (!after.has(t.id)) lines.push(`Removed ${label(t.kind)}: ${t.statement}`);
 for (const b of next) {
  const a = before.get(b.id); if (!a) continue;
  if (a.statement !== b.statement) lines.push(`Changed ${label(b.kind)} wording: "${a.statement}" → "${b.statement}"`);
  if (a.kind !== b.kind) lines.push(`"${b.statement}" changed from ${label(a.kind)} to ${label(b.kind)}`);
  if (a.category !== b.category || a.source !== b.source) lines.push(`"${b.statement}" now applies to ${b.category} (${b.source.replace('_', ' ')})`);
  if (a.evidence.length !== b.evidence.length) lines.push(`Evidence for "${b.statement}": ${a.evidence.length} → ${b.evidence.length} excerpts`);
  if (a.counterexamples.length !== b.counterexamples.length) lines.push(`Counterexamples for "${b.statement}": ${a.counterexamples.length} → ${b.counterexamples.length}`);
  if (a.confidence !== b.confidence) lines.push(`Confidence for "${b.statement}": ${a.confidence ?? 'explicit'} → ${b.confidence ?? 'explicit'}`);
  if (JSON.stringify(a.exclusions) !== JSON.stringify(b.exclusions)) lines.push(`Exclusions for "${b.statement}": ${a.exclusions.join(', ') || 'none'} → ${b.exclusions.join(', ') || 'none'}`);
 }
 return lines.length ? lines : ['No trait changes'];
}

function createStyleStore(db, { actor = 'human' } = {}) {
 const ws = () => require('./writing-style');
 const project = id => { if (!db.prepare('SELECT 1 FROM film_projects WHERE id=?').get(id)) fail(404, 'Project not found'); };
 const globalRow = () => db.prepare('SELECT * FROM film_style_profile_versions ORDER BY version DESC LIMIT 1').get();
 const overrideRow = pid => db.prepare('SELECT * FROM film_project_style_overrides WHERE project_id=? ORDER BY version DESC LIMIT 1').get(pid);
 const globalTraits = () => { const r = globalRow(); return r ? parse(r.traits, []) : []; };
 const override = pid => { const r = overrideRow(pid); return { version:r ? r.version : 0, disabled:r ? parse(r.disabled, []) : [], added:r ? parse(r.added, []) : [] }; };
 const layerVersion = (pid, target) => (target === 'global' ? (globalRow()?.version || 0) : override(pid).version);

 // Evidence spans resolve to their excerpt and location, in a sample eligible where the trait will apply.
 function spans(list, pid, target, name) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 12) fail(400, `${name} must list at most 12 spans`);
  return list.map(e => {
   const s = e && db.prepare('SELECT * FROM film_writing_samples WHERE id=?').get(e.sample_id);
   if (!s) fail(400, `${name}: sample not found`);
   const why = ws().sampleIneligibility(db, s, target === 'global' ? s.project_id : pid);
   if (why) fail(400, `${name}: sample is not eligible as evidence (${why.replace(/_/g, ' ')})`);
   if (!Number.isInteger(e.start) || !Number.isInteger(e.end) || e.start < 0 || e.end <= e.start || e.end > s.text.length) fail(400, `${name}: span is outside the sample`);
   return { sample_id:s.id, start:e.start, end:e.end, excerpt:s.text.slice(e.start, e.end), location:`${s.source} · characters ${e.start}–${e.end}` };
  });
 }
 function resolveTrait(pid, raw, target) {
  const t = raw || {};
  if (!TRAIT_KINDS.includes(t.kind)) fail(400, `kind must be one of ${TRAIT_KINDS.join(', ')}`);
  if (!TRAIT_SOURCES.includes(t.source)) fail(400, `source must be one of ${TRAIT_SOURCES.join(', ')}`);
  if (target === 'global' && t.source !== 'author_style') fail(400, 'Only the author\'s recurring style can enter the global profile; genre, scene and character requirements belong to a project');
  const categories = [...ws().STYLE_CATEGORIES, 'general'];
  if (!categories.includes(t.category)) fail(400, `category must be one of ${categories.join(', ')}`);
  const evidence = spans(t.evidence, pid, target, 'evidence'), counterexamples = spans(t.counterexamples, pid, target, 'counterexamples');
  const explicit = t.explicit_user_rule === true;
  if (explicit && (typeof t.preference_source !== 'string' || !t.preference_source.trim() || t.preference_source.length > 500)) fail(400, 'An explicit user rule needs preference_source: where the user said it');
  if (!explicit && !evidence.length) fail(400, 'A trait must resolve to evidence from eligible samples, or be labelled an explicit user rule');
  const list = (v, name, n, max) => { if (v === undefined) return []; if (!Array.isArray(v) || v.length > n || v.some(x => typeof x !== 'string' || !x.trim() || x.length > max)) fail(400, `${name} must list up to ${n} short strings`); return v.map(x => x.trim()); };
  const distinct = new Set(evidence.map(e => e.sample_id)).size;
  const trait = {
   id:typeof t.id === 'string' && /^[\w-]{1,64}$/.test(t.id) ? t.id : 'tr_' + crypto.randomUUID(),
   kind:t.kind, statement:text(t.statement, 'statement', 3, 300), source:t.source, category:t.category,
   evidence, counterexamples, exclusions:list(t.exclusions, 'exclusions', 10, 120), overrides:target === 'project' ? list(t.overrides, 'overrides', 10, 64) : [],
   explicit_user_rule:explicit, preference_source:explicit ? t.preference_source.trim() : null,
   // Evidence-derived: distinct supporting samples, less each counterexample. An explicit rule is the user's word, not a measurement.
   confidence:evidence.length ? Math.round(Math.max(0, Math.min(1, distinct / 3) - 0.15 * counterexamples.length) * 100) / 100 : null,
  };
  return { ...trait, fingerprint:digest(trait) };
 }

 function writeGlobal(traits, summary) {
  const cur = globalRow(), version = (cur?.version || 0) + 1;
  db.prepare('INSERT INTO film_style_profile_versions (version,parent_version,traits,approval_fingerprint,change_summary,actor) VALUES (?,?,?,?,?,?)')
   .run(version, cur ? cur.version : null, JSON.stringify(traits), digest(traits), JSON.stringify(summary || diffTraits(cur ? parse(cur.traits, []) : [], traits)), actor);
 }
 function writeOverride(pid, next, summary) {
  const cur = override(pid), version = cur.version + 1;
  const lines = summary || overrideDiff(cur, next);
  db.prepare('INSERT INTO film_project_style_overrides (project_id,version,parent_version,global_version,disabled,added,approval_fingerprint,change_summary,actor) VALUES (?,?,?,?,?,?,?,?,?)')
   .run(pid, version, cur.version || null, globalRow()?.version || null, JSON.stringify(next.disabled), JSON.stringify(next.added), digest({ disabled:next.disabled, added:next.added }), JSON.stringify(lines), actor);
 }
 function overrideDiff(cur, next) {
  const names = new Map(globalTraits().map(t => [t.id, t]));
  const lines = diffTraits(cur.added, next.added).filter(l => l !== 'No trait changes');
  for (const id of next.disabled) if (!cur.disabled.includes(id)) lines.push(`Disabled for this project: ${names.has(id) ? `${label(names.get(id).kind)}: ${names.get(id).statement}` : id}`);
  for (const id of cur.disabled) if (!next.disabled.includes(id)) lines.push(`Re-enabled for this project: ${names.has(id) ? `${label(names.get(id).kind)}: ${names.get(id).statement}` : id}`);
  return lines.length ? lines : ['No trait changes'];
 }
 const proposal = (pid, id) => {
  const p = db.prepare('SELECT * FROM film_style_trait_proposals WHERE project_id=? AND id=?').get(pid, id);
  if (!p) fail(404, 'Proposal not found in this project');
  if (p.status !== 'pending') fail(409, `This proposal was already ${p.status}`);
  return p;
 };
 const insertProposal = (pid, origin, target, trait, replaces) => {
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO film_style_trait_proposals (id,project_id,origin,target,trait,fingerprint,replaces) VALUES (?,?,?,?,?,?,?)')
   .run(id, pid, origin, target, JSON.stringify(trait), trait.fingerprint, replaces || null);
  return id;
 };
 // Exact author approval: the fingerprint of what will become active, a human's yes, and the version it was decided against.
 function approved(body, fingerprint, current) {
  if (body.approval_fingerprint !== fingerprint) fail(409, 'This approval does not match what would become active; review it again', 'STALE_APPROVAL', { current_fingerprint:fingerprint });
  if (body.human_confirmed !== true) fail(400, 'The author must confirm this change');
  if (body.expected_version !== current) fail(409, 'The profile changed since it was read; reload and review again', 'version_conflict', { current_version:current });
 }

 function proposeTrait(pid, body) {
  project(pid); const b = body || {};
  if (!TARGETS.includes(b.target)) fail(400, 'target must be global or project');
  const trait = resolveTrait(pid, b.trait, b.target);
  insertProposal(pid, b.trait && b.trait.explicit_user_rule === true ? 'explicit' : 'samples', b.target, trait);
  return snapshot(pid);
 }
 function recordCorrection(pid, body) {
  project(pid); const b = body || {};
  const before = text(b.before, 'before', 1, 2000), after = typeof b.after === 'string' && b.after.length <= 2000 ? b.after.trim() : fail(400, 'after must be text of at most 2000 characters');
  const scope = b.scope === undefined ? 'scene' : b.scope;
  if (!CORRECTION_SCOPES.includes(scope)) fail(400, `scope must be one of ${CORRECTION_SCOPES.join(', ')}`);
  const span = (v, name) => { if (v === undefined) return null; if (!v || !Number.isInteger(v.start) || !Number.isInteger(v.end) || v.start < 0 || v.end < v.start) fail(400, `${name} must be {start,end}`); return { start:v.start, end:v.end }; };
  const reason = b.reason === undefined ? null : text(b.reason, 'reason', 1, 500);
  const id = crypto.randomUUID();
  const statement = (b.statement && text(b.statement, 'statement', 3, 300)) || (`Prefer "${after}" to "${before}"`.length <= 300 ? `Prefer "${after}" to "${before}"` : 'Apply this correction to similar lines');
  // A correction stays in its scene unless the author scoped it wider; global still waits for approval.
  const trait = resolveTrait(pid, { kind:'rule', statement, source:scope === 'scene' ? 'scene' : 'author_style', category:b.category || 'general',
   explicit_user_rule:true, preference_source:`Correction ${id}${reason ? `: ${reason}` : ''}` }, scope === 'global' ? 'global' : 'project');
  const proposalId = insertProposal(pid, 'correction', scope === 'global' ? 'global' : 'project', trait);
  db.prepare('INSERT INTO film_style_corrections (id,project_id,before_text,after_text,before_span,after_span,reason,scope,proposal_id) VALUES (?,?,?,?,?,?,?,?,?)')
   .run(id, pid, before, after, JSON.stringify(span(b.before_span, 'before_span')), JSON.stringify(span(b.after_span, 'after_span')), reason, scope, proposalId);
  return snapshot(pid);
 }
 function createPairwise(pid, body) {
  project(pid); const b = body || {};
  if (!RUBRIC_DIMENSIONS.includes(b.dimension)) fail(400, `dimension must be one of ${RUBRIC_DIMENSIONS.join(', ')}`);
  const a = text(b.option_a, 'option_a', 1, 2000), c = text(b.option_b, 'option_b', 1, 2000);
  const id = crypto.randomUUID(), first = crypto.randomInt(2) ? 'a' : 'b';   // shown in random order
  db.prepare('INSERT INTO film_style_pairwise (id,project_id,dimension,option_a,option_b,first) VALUES (?,?,?,?,?,?)').run(id, pid, b.dimension, a, c, first);
  return { id, dimension:b.dimension, first:first === 'a' ? a : c, second:first === 'a' ? c : a };
 }
 function choosePairwise(pid, body) {
  project(pid); const b = body || {};
  const q = db.prepare('SELECT * FROM film_style_pairwise WHERE project_id=? AND id=?').get(pid, b.id);
  if (!q) fail(404, 'Choice not found in this project');
  if (q.choice) fail(409, 'This choice was already made');
  if (!['first', 'second', 'neither'].includes(b.choice)) fail(400, 'choice must be first, second or neither');
  const shown = q.first === 'a' ? [q.option_a, q.option_b] : [q.option_b, q.option_a];
  const letter = b.choice === 'neither' ? 'neither' : ((b.choice === 'first') === (q.first === 'a') ? 'a' : 'b');
  let proposalId = null;
  if (b.choice !== 'neither') {
   const [chosen, other] = b.choice === 'first' ? shown : [shown[1], shown[0]];
   const statement = `For ${q.dimension.replace(/_/g, ' ')}: prefer writing like "${chosen}" over "${other}"`;
   const trait = resolveTrait(pid, { kind:'rule', statement:statement.length <= 300 ? statement : `For ${q.dimension.replace(/_/g, ' ')}: prefer the chosen example (choice ${q.id})`,
    source:'author_style', category:DIMENSION_CATEGORY[q.dimension], explicit_user_rule:true, preference_source:`Pairwise choice ${q.id}` }, 'project');
   proposalId = insertProposal(pid, 'pairwise', 'project', trait);
  }
  db.prepare('UPDATE film_style_pairwise SET choice=?, proposal_id=?, chosen_at=CURRENT_TIMESTAMP WHERE id=?').run(letter, proposalId, q.id);
  return snapshot(pid);
 }
 function modifyProposal(pid, body) {
  project(pid); const p = proposal(pid, body && body.proposal_id);
  const before = parse(p.trait, {});
  const trait = resolveTrait(pid, { ...(body.trait || {}), id:before.id }, p.target);
  db.prepare(`UPDATE film_style_trait_proposals SET status='modified', decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(p.id);
  insertProposal(pid, p.origin, p.target, trait, p.id);
  return snapshot(pid);
 }
 function rejectProposal(pid, body) {
  project(pid); const p = proposal(pid, body && body.proposal_id);
  db.prepare(`UPDATE film_style_trait_proposals SET status='rejected', decision_reason=?, decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(body.reason ? String(body.reason).slice(0, 500) : null, p.id);
  return snapshot(pid);
 }
 function acceptProposal(pid, body) {
  project(pid); const p = proposal(pid, body && body.proposal_id);
  approved(body, p.fingerprint, layerVersion(pid, p.target));
  // Evidence is checked again now: what is accepted is what the proposal showed.
  const trait = resolveTrait(pid, parse(p.trait, {}), p.target);
  if (trait.fingerprint !== p.fingerprint) fail(409, 'The evidence behind this proposal changed; review it again', 'STALE_APPROVAL');
  if (p.target === 'global') writeGlobal([...globalTraits().filter(t => t.id !== trait.id), trait]);
  else { const cur = override(pid); writeOverride(pid, { disabled:cur.disabled.filter(id => id !== trait.id), added:[...cur.added.filter(t => t.id !== trait.id), trait] }); }
  db.prepare(`UPDATE film_style_trait_proposals SET status='accepted', decided_at=CURRENT_TIMESTAMP WHERE id=?`).run(p.id);
  return snapshot(pid);
 }
 function removeTrait(pid, body) {
  project(pid); const b = body || {};
  if (!TARGETS.includes(b.target)) fail(400, 'target must be global or project');
  if (b.target === 'global') {
   const t = globalTraits().find(x => x.id === b.trait_id); if (!t) fail(404, 'No such trait in the global profile');
   approved(b, t.fingerprint, layerVersion(pid, 'global'));
   writeGlobal(globalTraits().filter(x => x.id !== t.id));
  } else {
   const cur = override(pid), own = cur.added.find(x => x.id === b.trait_id), inherited = globalTraits().find(x => x.id === b.trait_id);
   const t = own || inherited; if (!t) fail(404, 'No such trait in this project\'s style');
   approved(b, t.fingerprint, cur.version);
   // A project's own trait is removed; a global one is disabled here only, so no other project changes.
   writeOverride(pid, own ? { disabled:cur.disabled, added:cur.added.filter(x => x.id !== t.id) } : { disabled:[...new Set([...cur.disabled, t.id])], added:cur.added });
  }
  return snapshot(pid);
 }
 function restore(pid, body) {
  project(pid); const b = body || {};
  if (!TARGETS.includes(b.target)) fail(400, 'target must be global or project');
  if (b.target === 'global') {
   const row = db.prepare('SELECT * FROM film_style_profile_versions WHERE version=?').get(b.version); if (!row) fail(404, 'No such global version');
   approved(b, row.approval_fingerprint, layerVersion(pid, 'global'));
   const traits = parse(row.traits, []);
   writeGlobal(traits, [`Restored version ${row.version}`, ...diffTraits(globalTraits(), traits)]);
  } else {
   const row = db.prepare('SELECT * FROM film_project_style_overrides WHERE project_id=? AND version=?').get(pid, b.version); if (!row) fail(404, 'No such version of this project\'s style');
   approved(b, row.approval_fingerprint, override(pid).version);
   const next = { disabled:parse(row.disabled, []), added:parse(row.added, []) };
   writeOverride(pid, next, [`Restored version ${row.version}`, ...overrideDiff(override(pid), next)]);
  }
  return snapshot(pid);
 }

 /** The traits in force for this project (and scene), what was suppressed by a higher layer, and why. */
 function resolve(pid, { scene } = {}) {
  project(pid);
  const cur = override(pid), sc = scene || {};
  const instructions = Array.isArray(sc.instructions) ? sc.instructions : [], characters = (Array.isArray(sc.characters) ? sc.characters : []).filter(c => c && c.name && c.voice);
  const evidenceHolds = t => t.evidence.every(e => {
   const s = db.prepare('SELECT * FROM film_writing_samples WHERE id=?').get(e.sample_id);
   return s && !ws().sampleIneligibility(db, s, s.project_id) && s.text.slice(e.start, e.end) === e.excerpt;
  });
  const applied = [], suppressed = [], conflicts = [];
  const suppress = (trait, layer, by, reason, higher) => { suppressed.push({ trait, layer, by, reason }); conflicts.push({ higher, lower:{ id:trait.id, statement:trait.statement, layer }, reason }); };
  const overridden = new Map();
  for (const t of cur.added) for (const id of t.overrides) overridden.set(id, t);
  const candidates = [...cur.added.map(t => ({ ...t, layer:'project' })), ...globalTraits().filter(t => !cur.disabled.includes(t.id)).map(t => ({ ...t, layer:'global' }))];
  for (const t of candidates) {
   if (!evidenceHolds(t)) { suppressed.push({ trait:t, layer:t.layer, by:'evidence_lost', reason:'its evidence is no longer eligible or has changed' }); continue; }
   if (t.layer === 'global' && overridden.has(t.id)) { const by = overridden.get(t.id); suppress(t, 'global', 'project_override', `the project trait "${by.statement}" replaces it`, { id:by.id, statement:by.statement, layer:'project' }); continue; }
   const ins = instructions.find(i => i && i.category === t.category);
   if (ins) { suppress(t, t.layer, 'scene_instruction', `the scene instruction "${ins.text}" governs ${t.category} here`, { layer:'scene', statement:ins.text }); continue; }
   applied.push(t.category === 'dialogue' && characters.length ? { ...t, yields_to_characters:characters.map(c => c.name) } : t);
  }
  return { applied, suppressed, conflicts, global_version:globalRow()?.version || 0, override_version:cur.version,
   scene:{ facts:Array.isArray(sc.facts) ? sc.facts.filter(f => typeof f === 'string') : [], instructions, characters } };
 }

 function snapshot(pid) {
  project(pid);
  const g = globalRow(), cur = override(pid), r = resolve(pid);
  const versions = rows => rows.map(v => ({ ...v, traits:v.traits ? parse(v.traits, []) : undefined, disabled:v.disabled ? parse(v.disabled, []) : undefined,
   added:v.added ? parse(v.added, []) : undefined, change_summary:parse(v.change_summary, []) }));
  return {
   project_id:pid, kinds:TRAIT_KINDS, sources:TRAIT_SOURCES, dimensions:RUBRIC_DIMENSIONS, scopes:CORRECTION_SCOPES, precedence:LAYERS,
   global:{ version:g ? g.version : 0, traits:g ? parse(g.traits, []) : [], versions:versions(db.prepare('SELECT * FROM film_style_profile_versions ORDER BY version').all()) },
   override:{ version:cur.version, disabled:cur.disabled, added:cur.added, versions:versions(db.prepare('SELECT * FROM film_project_style_overrides WHERE project_id=? ORDER BY version').all(pid)) },
   effective:r.applied, suppressed:r.suppressed,
   proposals:db.prepare('SELECT * FROM film_style_trait_proposals WHERE project_id=? ORDER BY created_at,rowid').all(pid).map(p => ({ ...p, trait:parse(p.trait, {}) })),
   corrections:db.prepare('SELECT * FROM film_style_corrections WHERE project_id=? ORDER BY created_at,rowid').all(pid).map(c => ({ ...c, before_span:parse(c.before_span, null), after_span:parse(c.after_span, null) })),
   pairwise:db.prepare('SELECT id,dimension,option_a,option_b,first,choice,created_at FROM film_style_pairwise WHERE project_id=? AND choice IS NULL ORDER BY created_at,rowid').all(pid)
    .map(q => ({ id:q.id, dimension:q.dimension, first:q.first === 'a' ? q.option_a : q.option_b, second:q.first === 'a' ? q.option_b : q.option_a })),
  };
 }

 const allowed = { human:['read', 'draft', 'propose', 'apply'], agent:['read', 'draft', 'propose'] }[actor] || [];
 const guarded = { snapshot, resolve, proposeTrait, recordCorrection, createPairwise, choosePairwise, modifyProposal, acceptProposal, rejectProposal, removeTrait, restore };
 const out = {};
 for (const [op, fn] of Object.entries(guarded)) {
  out[op] = (...a) => {
   if (!allowed.includes(STYLE_OPERATIONS[op])) fail(403, `This caller may not ${STYLE_OPERATIONS[op]} style changes`);
   return STYLE_OPERATIONS[op] === 'read' ? fn(...a) : db.transaction(() => fn(...a)).immediate();
  };
 }
 return out;
}

function store(opts) { return createStyleStore(require('../db/database').db, opts); }
module.exports = { TRAIT_KINDS, TRAIT_SOURCES, RUBRIC_DIMENSIONS, CORRECTION_SCOPES, LAYERS, STYLE_OPERATIONS, diffTraits, createStyleStore, store };
