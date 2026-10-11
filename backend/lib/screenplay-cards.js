/** Independent review cards. Never writes film_scripts or film_scenes. */
const crypto = require('crypto');
const { sceneSpans } = require('./scene-splice');
const hash = text => crypto.createHash('sha256').update(String(text)).digest('hex');
const headingText = text => text.replace(/^\./, '').replace(/\s*#[^#]+#\s*$/, '').trim();
function scenesOf(fountain) {
 const lines = String(fountain).split('\n');
 return sceneSpans(fountain).map((s, index) => {
  const text = lines.slice(s.start, s.end + 1).join('\n');
  // Scene number and separator whitespace are furniture, not story content.
  const content = [headingText(s.heading), ...lines.slice(s.start + 1, s.end + 1)].join('\n').trim();
  const number = s.heading.match(/#([^#]+)#\s*$/);
  return { index, number: number ? number[1] : String(index + 1), heading: headingText(s.heading), text, text_hash: hash(content) };
 });
}
// One-to-one matches only. Repeated headings are never joined by occurrence.
function reconcile(previous, scenes) {
 const matches = new Map(); const used = new Set();
 const unique = (key, eligible = () => true) => {
  const left = new Map(), right = new Map();
  previous.forEach((p,i) => { if (!used.has(i) && eligible(p,i,'old')) { const k=key(p,i,previous); if(k) left.set(k,[...(left.get(k)||[]),i]); } });
  scenes.forEach((s,i) => { if (!matches.has(i) && eligible(s,i,'new')) { const k=key(s,i,scenes); if(k) right.set(k,[...(right.get(k)||[]),i]); } });
  for (const [k, a] of left) { const b=right.get(k); if(a.length===1 && b && b.length===1) { matches.set(b[0],previous[a[0]].id); used.add(a[0]); } }
 };
 unique(s => s.text_hash);
 unique(s => s.heading.toUpperCase(), s => previous.filter(p=>p.heading.toUpperCase()===s.heading.toUpperCase()).length===1 && scenes.filter(p=>p.heading.toUpperCase()===s.heading.toUpperCase()).length===1);
 // If both neighboring scenes are unchanged, an edited repeated heading can
 // retain identity. Duplicate contexts remain ambiguous and get a new card.
 unique((s,i,list) => i>0 && i<list.length-1 ? [s.heading.toUpperCase(),list[i-1].text_hash,list[i+1].text_hash].join('|') : null);
 return scenes.map((s,i) => ({ ...s, id: matches.get(i) || crypto.randomUUID() }));
}
function scriptFor(db, projectId, version) {
 return version === undefined || version === null || version === ''
  ? db.prepare('SELECT * FROM film_scripts WHERE project_id=? ORDER BY version DESC LIMIT 1').get(projectId)
  : db.prepare('SELECT * FROM film_scripts WHERE project_id=? AND version=?').get(projectId, Number(version));
}
function readCards(db, projectId, version) {
 const script = scriptFor(db, projectId, version);
 if (!script || !script.fountain_content) throw Object.assign(new Error('No saved Fountain screenplay for this version'),{status:404});
 const scriptHash=hash(script.fountain_content), scenes=scenesOf(script.fountain_content);
 return db.transaction(() => {
  let snapshot=db.prepare('SELECT mapping FROM film_screenplay_card_snapshots WHERE project_id=? AND script_id=? AND script_hash=?').get(projectId,script.id,scriptHash);
  let mapping;
  if(snapshot) mapping=JSON.parse(snapshot.mapping);
  else {
   const last=db.prepare('SELECT mapping FROM film_screenplay_card_snapshots WHERE project_id=? ORDER BY rowid DESC LIMIT 1').get(projectId);
   const previous=last ? JSON.parse(last.mapping) : [];
   mapping=reconcile(previous,scenes).map(({id,heading,text_hash})=>({id,heading,text_hash}));
   const insert=db.prepare('INSERT OR IGNORE INTO film_screenplay_cards(id,project_id,heading,text_hash) VALUES(?,?,?,?)');
   for(const m of mapping) insert.run(m.id,projectId,m.heading,m.text_hash);
   db.prepare('INSERT INTO film_screenplay_card_snapshots(project_id,script_id,script_hash,mapping) VALUES(?,?,?,?)').run(projectId,script.id,scriptHash,JSON.stringify(mapping));
  }
  const get=db.prepare('SELECT * FROM film_screenplay_cards WHERE id=? AND project_id=?');
  const cards=scenes.map((s,i)=>{const row=get.get(mapping[i].id,projectId);return {...s,id:row.id,summary:row.summary,notes:row.notes,revision:row.revision,summary_hash:row.summary_hash,stale:!!row.summary && row.summary_hash!==s.text_hash};});
  const ids=new Set(cards.map(c=>c.id));
  const archived=db.prepare('SELECT id,heading,summary,notes FROM film_screenplay_cards WHERE project_id=?').all(projectId).filter(c=>!ids.has(c.id) && (c.summary || c.notes));
  return {script_id:script.id,version:script.version,script_hash:scriptHash,cards,archived,coverage:{total:cards.length,summarized:cards.filter(c=>c.summary.trim()).length,stale:cards.filter(c=>c.stale).length}};
 })();
}
function writeCard(db, projectId, body) {
 return db.transaction(()=>{
  const data=readCards(db,projectId,body.version);
  if(data.script_hash!==body.script_hash) throw Object.assign(new Error('Screenplay changed. Reload cards before saving.'),{status:409});
  const card=data.cards.find(c=>c.id===body.id);
  if(!card) throw Object.assign(new Error('Card does not belong to this screenplay'),{status:404});
  if(body.revision!==card.revision) throw Object.assign(new Error('Card was edited elsewhere. Reload before saving.'),{status:409});
  const sets=[],vals=[];
  for(const key of ['summary','notes']) if(body[key]!==undefined) {
   if(typeof body[key]!=='string' || body[key].length>20000) throw Object.assign(new Error(key+' must be text of at most 20,000 characters'),{status:400});
   sets.push(key+'=?'); vals.push(body[key]);
  }
  if(!sets.length) throw Object.assign(new Error('Supply summary or notes'),{status:400});
  if(body.summary!==undefined) {sets.push('summary_hash=?');vals.push(card.text_hash);}
  sets.push('revision=revision+1',"updated_at=datetime('now')");
  db.prepare('UPDATE film_screenplay_cards SET '+sets.join(',')+' WHERE id=? AND project_id=?').run(...vals,card.id,projectId);
  return readCards(db,projectId,body.version);
 })();
}
module.exports={hash,scenesOf,reconcile,readCards,writeCard};
