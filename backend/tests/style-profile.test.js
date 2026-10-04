// GRD-4662: evidence-backed style traits, immutable global profile versions and project overrides,
// author-controlled learning (corrections, pairwise choices), precedence and semantic diffs.
// Set-based over the registries lib/style-profile.js declares.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-style-profile-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const ws=require('../lib/writing-style');
const sp=require('../lib/style-profile');
const {handleStyleProfile}=require('../routes/style-profile');
const samples=ws.createWritingStyleStore(db), style=sp.createStyleStore(db);

function project(){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Style fixture');return id;}
const MINE={source:'My notebook',authorship:'original_human',confirmed_original:true};
function sample(id,text,extra={}){samples.addSample(id,{text,...MINE,...extra});return samples.snapshot(id).samples.at(-1);}
const ev=(s,find)=>({sample_id:s.id,start:s.text.indexOf(find),end:s.text.indexOf(find)+find.length});
const layerVersion=(pid,target)=>{const snap=style.snapshot(pid);return target==='global'?snap.global.version:snap.override.version;};
function accept(pid,proposal){return style.acceptProposal(pid,{proposal_id:proposal.id,approval_fingerprint:proposal.fingerprint,human_confirmed:true,expected_version:layerVersion(pid,proposal.target)});}
const pending=pid=>style.snapshot(pid).proposals.filter(p=>p.status==='pending');
function adopt(pid,target,trait){style.proposeTrait(pid,{target,trait});accept(pid,pending(pid).at(-1));return style.snapshot(pid);}
async function route(id,method,suffix='',body={},extra={}){
 let status,raw;const res={writeHead(c){status=c;},end(s){raw=s;}};
 await handleStyleProfile({method,body,headers:{},...extra},res,['film','projects',id,'style-profile',...suffix.split('/').filter(Boolean)]);
 return {status,body:JSON.parse(raw)};
}

test('the declared vocabulary',()=>{
 assert.deepEqual([...sp.TRAIT_KINDS],['rule','anti_pattern']);
 assert.deepEqual([...sp.TRAIT_SOURCES],['author_style','genre','scene','character']);
 assert.deepEqual([...sp.RUBRIC_DIMENSIONS],['rhythm','dialogue_voice','description_density','humor','tension']);
 assert.deepEqual([...sp.CORRECTION_SCOPES],['scene','project','global']);
 assert.deepEqual([...sp.LAYERS],['scene','project','global'],'precedence, highest first');
});

test('every proposed trait resolves to evidence, with excerpts and locations, or is labelled an explicit user rule',()=>{
 const pid=project(),a=sample(pid,'She sets the cup down. Says nothing.'),b=sample(pid,'He waits. The phone stays dark.'),c=sample(pid,'A long, winding, ornate sentence that keeps going on and on.');
 style.proposeTrait(pid,{target:'global',trait:{kind:'rule',statement:'Short declarative sentences; silence does the work.',source:'author_style',category:'action',
  evidence:[ev(a,'Says nothing.'),ev(b,'He waits.')],counterexamples:[ev(c,'A long, winding, ornate sentence')],exclusions:['comedy set pieces']}});
 const p=pending(pid).at(-1);
 assert.equal(p.trait.evidence.length,2);
 for(const e of p.trait.evidence){assert.ok(e.excerpt.length>0);assert.ok(Number.isInteger(e.start)&&e.end>e.start);assert.ok(e.location);}
 assert.equal(p.trait.counterexamples[0].excerpt,'A long, winding, ornate sentence');
 assert.ok(p.trait.confidence>0&&p.trait.confidence<=1);
 assert.equal(p.trait.explicit_user_rule,false);
 assert.match(p.fingerprint,/^[0-9a-f]{64}$/);
 style.proposeTrait(pid,{target:'project',trait:{kind:'anti_pattern',statement:'Never open a scene with weather.',source:'author_style',category:'description',explicit_user_rule:true,preference_source:'Told the assistant on 4 Oct'}});
 assert.equal(pending(pid).at(-1).trait.explicit_user_rule,true);
 const held=sample(pid,'Held out for testing.',{held_out:true});
 const refused={
  noEvidenceNotExplicit:{kind:'rule',statement:'Be terse.',source:'author_style',category:'action'},
  spanOutsideSample:{kind:'rule',statement:'Be terse.',source:'author_style',category:'action',evidence:[{sample_id:a.id,start:0,end:9999}]},
  ineligibleEvidence:{kind:'rule',statement:'Be terse.',source:'author_style',category:'action',evidence:[ev(held,'Held out')]},
  unknownKind:{kind:'vibe',statement:'Be terse.',source:'author_style',category:'action',explicit_user_rule:true,preference_source:'x'},
  explicitWithoutSource:{kind:'rule',statement:'Be terse.',source:'author_style',category:'action',explicit_user_rule:true},
 };
 for(const [name,trait] of Object.entries(refused))assert.throws(()=>style.proposeTrait(pid,{target:'project',trait}),e=>e.status===400,name);
 // Genre, scene and character requirements are not the author's recurring style: never global.
 for(const source of ['genre','scene','character'])
  assert.throws(()=>style.proposeTrait(pid,{target:'global',trait:{kind:'rule',statement:'Noir narration.',source,category:'description',explicit_user_rule:true,preference_source:'brief'}}),e=>e.status===400,source);
});

test('corrections and pairwise choices produce pending proposals only; a single correction is never silently global',()=>{
 const pid=project();
 const before=style.resolve(pid).applied.length;
 for(const scope of sp.CORRECTION_SCOPES){
  style.recordCorrection(pid,{before:'He said angrily',after:'He said',before_span:{start:10,end:25},after_span:{start:10,end:17},reason:'Let the line carry it',scope});
  const p=pending(pid).at(-1);
  assert.equal(p.origin,'correction');assert.equal(p.target,scope==='global'?'global':'project',scope);
  assert.equal(p.trait.source,scope==='scene'?'scene':'author_style',scope);
  assert.equal(p.trait.explicit_user_rule,true);
  const c=style.snapshot(pid).corrections.at(-1);
  assert.deepEqual([c.before_span,c.after_span,c.reason,c.scope],[{start:10,end:25},{start:10,end:17},'Let the line carry it',scope]);
 }
 assert.equal(style.resolve(pid).applied.length,before,'nothing active until approved');
 const firsts=new Set();
 for(const dimension of sp.RUBRIC_DIMENSIONS){
  for(let i=0;i<24;i++){const q=style.createPairwise(pid,{dimension,option_a:'Option alpha',option_b:'Option beta'});firsts.add(q.first);}
  const q=style.createPairwise(pid,{dimension,option_a:'Clipped',option_b:'Lush'});
  const n=pending(pid).length;
  style.choosePairwise(pid,{id:q.id,choice:'neither'});
  assert.equal(pending(pid).length,n,`${dimension}: neither proposes nothing`);
  const q2=style.createPairwise(pid,{dimension,option_a:'Clipped',option_b:'Lush'});
  style.choosePairwise(pid,{id:q2.id,choice:'first'});
  const p=pending(pid).at(-1);
  assert.equal(p.origin,'pairwise');assert.equal(p.target,'project');assert.match(p.trait.statement,new RegExp(q2.first));
 }
 assert.deepEqual([...firsts].sort(),['Option alpha','Option beta'],'presentation order is randomized');
 assert.equal(style.resolve(pid).applied.length,before,'still nothing active');
 const p=pending(pid).at(-1);
 for(const [name,body,status] of [['wrong fingerprint',{approval_fingerprint:'0'.repeat(64),human_confirmed:true},409],['no confirmation',{approval_fingerprint:p.fingerprint},400],['stale version',{approval_fingerprint:p.fingerprint,human_confirmed:true,expected_version:7},409]]){
  assert.throws(()=>style.acceptProposal(pid,{proposal_id:p.id,expected_version:0,...body}),e=>e.status===status,name);
 }
 accept(pid,p);
 assert.equal(style.resolve(pid).applied.length,before+1);
});

test('accept, modify, reject, remove and restore; immutable versions; another project never changes',()=>{
 const a=project(),b=project(),s=sample(a,'Cut. Cut again. Keep it moving.');
 const baseTrait={kind:'rule',statement:'Keep it moving.',source:'author_style',category:'action',evidence:[ev(s,'Keep it moving.')]};
 // The global profile is shared by every project (and every test here), so versions are counted from now.
 const globalStatementsBefore=style.snapshot(a).global.traits.map(t=>t.statement);
 adopt(a,'global',baseTrait);
 const firstGlobal=layerVersion(a,'global');
 const globalTrait=style.snapshot(a).global.traits[0];
 assert.ok(style.resolve(b).applied.some(t=>t.id===globalTrait.id),'global traits reach every project');
 // modify: the original is marked, a revised pending proposal keeps the trait id with a new fingerprint
 style.proposeTrait(a,{target:'project',trait:{kind:'rule',statement:'Dialogue under ten words.',source:'author_style',category:'dialogue',explicit_user_rule:true,preference_source:'note'}});
 const orig=pending(a).at(-1);
 style.modifyProposal(a,{proposal_id:orig.id,trait:{...orig.trait,statement:'Dialogue under twelve words.'}});
 const revised=pending(a).at(-1);
 assert.equal(style.snapshot(a).proposals.find(p=>p.id===orig.id).status,'modified');
 assert.equal(revised.trait.id,orig.trait.id);assert.notEqual(revised.fingerprint,orig.fingerprint);
 accept(a,revised);
 // reject
 style.proposeTrait(a,{target:'project',trait:{kind:'rule',statement:'Rhyme everything.',source:'author_style',category:'general',explicit_user_rule:true,preference_source:'joke'}});
 const junk=pending(a).at(-1);style.rejectProposal(a,{proposal_id:junk.id,reason:'not me'});
 assert.equal(style.snapshot(a).proposals.find(p=>p.id===junk.id).status,'rejected');
 assert.ok(!style.resolve(a).applied.some(t=>t.statement==='Rhyme everything.'));
 const versionsBefore=JSON.stringify(db.prepare('SELECT * FROM film_project_style_overrides ORDER BY project_id,version').all());
 const globalBefore=JSON.stringify(db.prepare('SELECT * FROM film_style_profile_versions ORDER BY version').all());
 const bOverrides=JSON.stringify(db.prepare('SELECT * FROM film_project_style_overrides WHERE project_id=?').all(b));
 // reject an active global trait for project A only
 style.removeTrait(a,{target:'project',trait_id:globalTrait.id,approval_fingerprint:globalTrait.fingerprint,human_confirmed:true,expected_version:layerVersion(a,'project')});
 assert.ok(!style.resolve(a).applied.some(t=>t.id===globalTrait.id),'gone in A');
 assert.ok(style.resolve(b).applied.some(t=>t.id===globalTrait.id),'still in B');
 // restore A's previous override
 const prev=style.snapshot(a).override.versions.find(v=>v.version===layerVersion(a,'project')-1);
 assert.throws(()=>style.restore(a,{target:'project',version:prev.version,approval_fingerprint:'f'.repeat(64),human_confirmed:true,expected_version:layerVersion(a,'project')}),e=>e.code==='STALE_APPROVAL');
 style.restore(a,{target:'project',version:prev.version,approval_fingerprint:prev.approval_fingerprint,human_confirmed:true,expected_version:layerVersion(a,'project')});
 assert.ok(style.resolve(a).applied.some(t=>t.id===globalTrait.id),'restored');
 // Every earlier row is byte-for-byte what it was; B's records never moved.
 const now=db.prepare('SELECT * FROM film_project_style_overrides ORDER BY project_id,version').all();
 for(const row of JSON.parse(versionsBefore))assert.deepEqual(now.find(r=>r.project_id===row.project_id&&r.version===row.version),row);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM film_style_profile_versions ORDER BY version').all()),globalBefore);
 assert.equal(JSON.stringify(db.prepare('SELECT * FROM film_project_style_overrides WHERE project_id=?').all(b)),bOverrides);
 // restore a previous global version
 adopt(a,'global',{kind:'anti_pattern',statement:'No adverbs on dialogue tags.',source:'author_style',category:'dialogue',explicit_user_rule:true,preference_source:'note'});
 const g1=style.snapshot(a).global.versions.find(v=>v.version===firstGlobal);
 style.restore(a,{target:'global',version:firstGlobal,approval_fingerprint:g1.approval_fingerprint,human_confirmed:true,expected_version:layerVersion(a,'global')});
 assert.deepEqual(style.snapshot(b).global.traits.map(t=>t.statement),[...globalStatementsBefore,'Keep it moving.']);
});

test('precedence: scene instructions, screenplay facts and character voice hold when a global trait conflicts',()=>{
 const pid=project(),s=sample(pid,'"No." "Fine." "Go."');
 adopt(pid,'global',{kind:'rule',statement:'Dialogue is clipped: one to three words.',source:'author_style',category:'dialogue',evidence:[ev(s,'"No."')]});
 adopt(pid,'global',{kind:'rule',statement:'Describe rooms in a single line.',source:'author_style',category:'description',explicit_user_rule:true,preference_source:'note'});
 const gDesc=style.snapshot(pid).global.traits.find(t=>t.category==='description');
 adopt(pid,'project',{kind:'rule',statement:'This film: rooms get a full paragraph.',source:'genre',category:'description',explicit_user_rule:true,preference_source:'director',overrides:[gDesc.id]});
 const scene={facts:['ORSON is the narrator\'s father','The letter is never opened'],
  instructions:[{category:'dialogue',text:'ORSON delivers a long rambling toast'}],characters:[{name:'ORSON',voice:'florid, endless sentences'}]};
 const r=style.resolve(pid,{scene});
 const supp=id=>r.suppressed.find(x=>x.trait.id===id);
 const gDialogue=style.snapshot(pid).global.traits.find(t=>t.category==='dialogue');
 assert.equal(supp(gDialogue.id).by,'scene_instruction');
 assert.equal(supp(gDesc.id).by,'project_override');
 assert.ok(r.applied.some(t=>t.statement==='This film: rooms get a full paragraph.'&&t.layer==='project'));
 assert.ok(r.conflicts.length>=2,'conflicts are surfaced, not resolved silently');
 const ctx=ws.createWritingStyleStore(db).context(pid,{scene});
 const at=x=>ctx.text.indexOf(x);
 assert.ok(at('The letter is never opened')>=0&&at('ORSON is the narrator')>=0,'facts are carried');
 assert.ok(at('florid, endless sentences')>=0,'character voice is carried');
 assert.ok(at('The letter is never opened')<at('This film: rooms get a full paragraph.'),'facts before project style');
 // Order of precedence on the page, and a suppressed trait only ever under NOT APPLIED HERE.
 assert.ok(at('SCENE (binding)')<at('PROJECT STYLE')&&at('PROJECT STYLE')<at('AUTHOR STYLE')&&at('AUTHOR STYLE')<at('NOT APPLIED HERE'));
 assert.ok(at('Dialogue is clipped: one to three words.')>at('NOT APPLIED HERE'),'a suppressed trait is not presented as active');
 assert.ok(at('Describe rooms in a single line.')>at('NOT APPLIED HERE'));
 assert.deepEqual(ctx.provenance.style.suppressed.map(x=>x.by).sort(),['project_override','scene_instruction']);
 // Without the scene instruction, the dialogue trait applies but still yields to the character's declared voice.
 const r2=style.resolve(pid,{scene:{characters:[{name:'ORSON',voice:'florid'}]}});
 const d=r2.applied.find(t=>t.id===gDialogue.id);
 assert.ok(d,'applies');assert.deepEqual(d.yields_to_characters,['ORSON']);
});

test('every profile revision carries a readable semantic diff',()=>{
 const pid=project(),s=sample(pid,'Quick. Quiet. Done.');
 const base=layerVersion(pid,'global');
 adopt(pid,'global',{kind:'rule',statement:'Three-beat rhythm.',source:'author_style',category:'action',evidence:[ev(s,'Quick. Quiet. Done.')]});
 const t=style.snapshot(pid).global.traits.find(x=>x.statement==='Three-beat rhythm.');
 style.proposeTrait(pid,{target:'global',trait:{...t,statement:'Three-beat rhythm, sometimes four.',evidence:[ev(s,'Quick.'),ev(s,'Done.')]}});
 accept(pid,pending(pid).at(-1));
 adopt(pid,'global',{kind:'anti_pattern',statement:'No exclamation marks.',source:'author_style',category:'general',explicit_user_rule:true,preference_source:'note'});
 style.removeTrait(pid,{target:'global',trait_id:t.id,approval_fingerprint:style.snapshot(pid).global.traits.find(x=>x.id===t.id).fingerprint,human_confirmed:true,expected_version:layerVersion(pid,'global')});
 style.restore(pid,{target:'global',version:base+2,approval_fingerprint:style.snapshot(pid).global.versions.find(v=>v.version===base+2).approval_fingerprint,human_confirmed:true,expected_version:layerVersion(pid,'global')});
 const versions=style.snapshot(pid).global.versions;
 for(const v of versions){assert.ok(Array.isArray(v.change_summary)&&v.change_summary.length,`version ${v.version}`);for(const line of v.change_summary)assert.equal(typeof line,'string');}
 const text=n=>versions.find(v=>v.version===base+n).change_summary.join('\n');
 assert.match(text(1),/Added rule: Three-beat rhythm\./);
 assert.match(text(2),/Changed rule wording: "Three-beat rhythm\." → "Three-beat rhythm, sometimes four\."/);
 assert.match(text(2),/evidence/i);
 assert.match(text(3),/Added anti-pattern: No exclamation marks\./);
 assert.match(text(4),/Removed rule: Three-beat rhythm, sometimes four\./);
 assert.match(text(5),new RegExp(`Restored version ${base+2}`));
});

test('an agent proposes; only the author decides (route, structured errors)',async()=>{
 const pid=project();
 const r=await route(pid,'POST','corrections',{before:'very big',after:'huge',scope:'project'},{actor:'agent'});
 assert.equal(r.status,200,JSON.stringify(r.body));
 const p=r.body.proposals.find(x=>x.status==='pending');
 for(const [suffix,body] of [['proposals/accept',{proposal_id:p.id,approval_fingerprint:p.fingerprint,human_confirmed:true,expected_version:0}],['proposals/reject',{proposal_id:p.id}],
  ['traits/remove',{target:'project',trait_id:'x',approval_fingerprint:'x',human_confirmed:true,expected_version:0}],['restore',{target:'project',version:1,approval_fingerprint:'x',human_confirmed:true,expected_version:0}]]){
  const x=await route(pid,'POST',suffix,body,{actor:'agent'});
  assert.equal(x.status,403,suffix);assert.equal(x.body.code,'forbidden',suffix);assert.ok(x.body.request_id);
 }
 const ok=await route(pid,'POST','proposals/accept',{proposal_id:p.id,approval_fingerprint:p.fingerprint,human_confirmed:true,expected_version:0});
 assert.equal(ok.status,200);assert.equal(ok.body.override.version,1);
 assert.ok((await route(pid,'GET','')).body.effective.some(t=>t.id===p.trait.id&&t.layer==='project'));
});

test('MCP reads and proposes through the same service, and has no tool that decides',async()=>{
 const tools=require('../lib/mcp-tools');
 for(const name of ['style_profile_read','style_trait_propose','style_correction_record'])assert.ok(tools.hasTool(name),name);
 for(const name of ['style_proposal_accept','style_trait_remove','style_profile_restore'])assert.equal(tools.hasTool(name),false,name);
 const pid=project();
 const r=tools.presentResult(await tools.callTool('style_correction_record',{project_id:pid,before:'said quietly',after:'whispered'}));
 assert.equal(r.proposals.at(-1).status,'pending');assert.equal(r.proposals.at(-1).target,'project');
 const read=tools.presentResult(await tools.callTool('style_profile_read',{project_id:pid}));
 assert.equal(read.proposals.length,1);
});
