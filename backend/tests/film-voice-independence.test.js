const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'film-voice-independent-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const {createWritingStyleStore}=require('../lib/writing-style'),store=createWritingStyleStore(db);
function project(){const id=crypto.randomUUID();db.prepare('INSERT INTO film_projects(id,title) VALUES (?,?)').run(id,'Synthetic independent voice');return id;}
function preferences(id){store.propose(id,{expected_version:0,guidance:'Use plain dialogue.',sample_ids:[],preference_confirmation:true,preference_source:'Explicit synthetic user instruction'});const p=store.snapshot(id).profiles[0];store.approve(id,1,{expected_version:1,human_confirmed:true,approval_fingerprint:p.evidence_hash});return p;}
test('Film exports own their domain; business imports fail without changing Film data',()=>{
 const id=project();preferences(id);const p=store.portable(id);
 assert.equal(p.source_app,'film-engine-v2');assert.equal(p.voice_domain,'screenplay_story');assert.equal(store.context(id).provenance.learned_voice,false);
 for(const foreign of [{...p,voice_domain:'business_communication'},{...p,source_app:'marketing-engine'},{...p,approved_rules:p.approved_rules.map(r=>({...r,scope:'business'}))}])assert.throws(()=>store.importProfile(id,{profile:foreign,human_confirmed:true}),/business|another app|Business/);
 assert.equal(store.snapshot(id).imports.length,0);assert.equal(store.snapshot(id).profiles.length,1);
});
test('correction creates an inactive new version, retains explicit preference evidence and requires fresh human approval',()=>{
 const id=project(),p=preferences(id),before=store.context(id);
 store.correctProfile(id,{expected_version:1,approval_fingerprint:p.evidence_hash,correction:'Let interruptions stay unfinished.',preference_source:'Explicit correction from synthetic author'});
 const s=store.snapshot(id);assert.equal(s.active_profile.version,1);assert.equal(s.profiles[0].version,2);assert.equal(s.profiles[0].state,'draft');assert.equal(s.profiles[0].sample_ids.length,0);assert.equal(s.profiles[0].direct_rules.length,2);
 assert.deepEqual(store.context(id),before);assert.throws(()=>store.correctProfile(id,{expected_version:1,approval_fingerprint:p.evidence_hash}),/version changed/);
 store.approve(id,2,{expected_version:2,human_confirmed:true,approval_fingerprint:s.profiles[0].evidence_hash});
 const c=store.context(id);assert.match(c.text,/interruptions/);assert.equal(c.provenance.basis,'explicit_preferences_only');assert.equal(c.provenance.learned_voice,false);assert.equal(store.portable(id).approved_rules.length,2);
});
test('sample prose editing requires owner confirmation and current hash; changed evidence stales approvals without changing canon',()=>{
 const id=project();store.addSample(id,{text:'My own short scene.',source:'Unaided synthetic exercise',authorship:'original_human',confirmed_original:true});const sample=store.snapshot(id).samples[0];
 store.propose(id,{expected_version:0,guidance:'Short lines.',sample_ids:[sample.id]});const p=store.snapshot(id).profiles[0];store.approve(id,1,{expected_version:1,human_confirmed:true});
 const edit={sample_id:sample.id,text:'My revised short scene.',source:'Revised unaided exercise',expected_fingerprint:sample.fingerprint};
 assert.throws(()=>store.updateSample(id,edit),/Confirm/);assert.throws(()=>createWritingStyleStore(db,{actor:'agent'}).updateSample(id,{...edit,confirmed_original:true}),/Only the owner/);assert.throws(()=>store.updateSample(id,{...edit,expected_fingerprint:'old',confirmed_original:true}),/changed/);
 store.updateSample(id,{...edit,confirmed_original:true});const s=store.snapshot(id);assert.equal(s.profiles[0].state,'stale');assert.equal(s.active_profile,null);assert.equal(s.profiles[0].evidence_hash,p.evidence_hash);assert.equal(db.prepare('SELECT count(*) n FROM film_scripts WHERE project_id=?').get(id).n,0);
});
test('import preview exposes source kinds and prior approval conflict, and refuses a changed proposal',()=>{
 const source=project();preferences(source);const portable=store.portable(source),id=project();preferences(id);
 const body={profile:portable,human_confirmed:true},preview=store.importPreview(id,body);
 assert.equal(preview.eligible_samples,0);assert.equal(preview.rules[0].evidence[0].kind,'explicit_correction');assert.equal(preview.current_approved_version,1);
 const changed={...body,profile:{...portable,profile_version:'modified'}};
 assert.throws(()=>store.importProfile(id,{...changed,import_preview_fingerprint:preview.fingerprint}),/preview.*again/);
 store.importProfile(id,{...body,import_preview_fingerprint:preview.fingerprint});assert.equal(store.snapshot(id).active_profile.version,1);assert.equal(store.snapshot(id).profiles[0].state,'draft');
});
test('editing AI-assisted evidence never promotes it to original voice',()=>{
 const id=project();store.addSample(id,{text:'AI synthetic prose.',source:'AI-assisted fixture',authorship:'ai_assisted'});const s=store.snapshot(id).samples[0];store.updateSample(id,{sample_id:s.id,text:'Edited AI prose.',source:'Human edit of AI prose',expected_fingerprint:s.fingerprint,confirmed_original:true});const after=store.snapshot(id).samples[0];assert.equal(after.authorship,'ai_assisted');assert.equal(after.confirmed_original,0);assert.equal(after.eligibility,'not_original');
});

test('app-specific exports preserve exact Film guidance and attribute corrections to user instruction sources',()=>{
 const id=project();store.addSample(id,{text:'Unaided synthetic scene.',source:'Synthetic original',authorship:'original_human',confirmed_original:true});const sample=store.snapshot(id).samples[0];store.propose(id,{expected_version:0,guidance:'Keep sparse dialogue.',sample_ids:[sample.id]});store.approve(id,1,{expected_version:1,human_confirmed:true});const p=store.snapshot(id).profiles[0];store.correctProfile(id,{expected_version:1,approval_fingerprint:p.evidence_hash,correction:'Use complete action sentences.',preference_source:'User instruction in synthetic fixture'});store.approve(id,2,{expected_version:2,human_confirmed:true});
 const portable=store.portable(id);assert.equal(portable.film_guidance.text,store.snapshot(id).active_profile.guidance);assert.equal(portable.approved_rules[0].basis,'mixed');assert.equal(portable.approved_rules[0].evidence.length,2);
 portable.approved_examples=[{source_id:sample.id,excerpt:sample.text,locator:portable.sources[0].locator,status:'active',reuse_approval:{statement:'Synthetic owner approves test excerpt reuse'}}];const target=project();store.importProfile(target,{profile:portable,human_confirmed:true});assert.equal(store.snapshot(target).profiles[0].guidance,portable.film_guidance.text);assert.equal(store.snapshot(target).active_profile,null);assert.equal(store.snapshot(target).profiles[0].direct_rules[0].source.kind,'explicit_correction');
});

test('profile-specific review fingerprints reject changed evidence without claiming a shot approval',()=>{
 const id=project();store.propose(id,{expected_version:0,guidance:'Simple verbs.',sample_ids:[],preference_confirmation:true,preference_source:'Synthetic instruction'});const p=store.snapshot(id).profiles[0];assert.throws(()=>store.approve(id,1,{expected_version:1,human_confirmed:true,profile_approval_fingerprint:'changed'}),/does not match/);store.approve(id,1,{expected_version:1,human_confirmed:true,profile_approval_fingerprint:p.evidence_hash});assert.equal(store.snapshot(id).active_profile.version,1);
});
