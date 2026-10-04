// Versioned interchange with the private writing-style plugin. No remote sync.
const VERSION='1.0.0';
function error(message){const e=new Error(message);e.status=400;throw e;}
const attested=v=>v===true || (v&&typeof v==='object'&&v.status!=='revoked'&&v.revoked!==true&&typeof v.statement==='string'&&v.statement.trim().length>0);
function validatePortable(p){
 if(!p||p.schema_version!==VERSION||p.owner!=='Manny')error('Import requires schema_version 1.0.0 and owner Manny');
 if(typeof p.profile_name!=='string'||typeof p.profile_version!=='string')error('Profile name and version are required');
 for(const key of ['sources','approved_rules','approved_examples','pending_proposals','feedback','history','prior_snapshots'])if(!Array.isArray(p[key]))error(`${key} must be an array`);
 if(p.sources.length>24||p.approved_rules.length>24||p.approved_examples.length>24||JSON.stringify(p).length>500000)error('Portable profile is too large');
 const ids=new Set();
 for(const s of p.sources){
  if(!s||typeof s.id!=='string'||ids.has(s.id))error('Source IDs must be distinct strings');ids.add(s.id);
  if(!['original_sample','approved_import','explicit_correction','explicit_preference','generated_ancestor','external_reference'].includes(s.kind))error('Invalid source kind');
  if(typeof s.author!=='string'||typeof s.provenance!=='string'||typeof s.locator!=='string')error('Every source needs author, provenance and locator');
 }
 for(const rule of p.approved_rules){
  if(!rule||typeof rule.id!=='string'||typeof rule.pattern!=='string'||!['active','revoked'].includes(rule.status)||!Array.isArray(rule.evidence))error('Invalid approved rule');
  if(rule.evidence.some(e=>!e||!ids.has(e.source_id)||typeof e.locator!=='string'))error('Rule evidence must reference a source in this file');
 }
 for(const ex of p.approved_examples)if(!ex||!ids.has(ex.source_id)||typeof ex.excerpt!=='string'||typeof ex.locator!=='string')error('Invalid example source or excerpt');
 return p;
}
function importedEvidence(p,humanConfirmed){
 validatePortable(p);
 return p.sources.map(s=>{
  if(['explicit_correction','explicit_preference'].includes(s.kind))return null;
  const example=p.approved_examples.find(e=>e.source_id===s.id&&e.status==='active'&&attested(e.reuse_approval));
  const text=typeof s.approved_excerpt==='string'?s.approved_excerpt:(typeof s.quarantined_excerpt==='string'?s.quarantined_excerpt:example?.excerpt);
  if(!text||!text.trim())return null;
  const eligible=s.status!=='revoked'&&s.revoked!==true&&humanConfirmed===true&&['original_sample','approved_import'].includes(s.kind)&&s.author==='Manny'
   &&s.eligible_for_voice===true&&attested(s.original_authorship_confirmation)&&attested(s.voice_analysis_approval);
  return {external_id:s.id,text:text.slice(0,20000),source:`${s.provenance} (${s.locator})`.slice(0,500),authorship:eligible?'original_human':s.kind==='generated_ancestor'?'ai_assisted':'unknown',confirmed_original:eligible,source_meta:JSON.stringify(s)};
 }).filter(Boolean);
}
function sourceMetadata(source){
 const copy={...source};
 if(!['explicit_correction','explicit_preference'].includes(copy.kind)){
  if(typeof copy.approved_excerpt==='string')delete copy.approved_excerpt;
  if(typeof copy.quarantined_excerpt==='string')delete copy.quarantined_excerpt;
 }
 if(copy.import_provenance)copy.import_provenance=sourceMetadata(copy.import_provenance);
 return copy;
}
function snapshotMetadata(profile){
 return {...profile,sources:(profile.sources||[]).map(sourceMetadata),approved_examples:[],
  prior_snapshots:(profile.prior_snapshots||[]).map(s=>s.profile?{...s,profile:snapshotMetadata(s.profile)}:s)};
}
function portable(snapshot){
 const active=snapshot.active_profile;
 const sources=snapshot.samples.map(s=>({id:s.id,kind:s.authorship==='original_human'?'original_sample':s.authorship==='ai_assisted'?'generated_ancestor':'external_reference',author:s.authorship==='original_human'?'Manny':'unknown',provenance:s.source,locator:`film-engine:${snapshot.project_id}/samples/${s.id}`,original_authorship_confirmation:s.confirmed_original?{statement:'Author confirmed unaided original writing',date:s.created_at}:null,voice_analysis_approval:active?.sample_ids.includes(s.id)?{statement:'Author approved this profile and its samples',date:active.approved_at}:null,eligible_for_voice:Boolean(s.confirmed_original&&s.authorship==='original_human'&&active?.sample_ids.includes(s.id)),...(s.source_meta&&s.source_meta!=='{}'?{import_provenance:JSON.parse(s.source_meta)}:{})}));
 const version=active?`${active.sample_ids.length?'1.0':'0.0'}.${active.version}`:'0.0.0';
 const directSources=[...new Map((active?.direct_rules||[]).map(r=>[r.source.id,r])).values()].map(r=>({...r.source,original_authorship_confirmation:null,voice_analysis_approval:null,eligible_for_voice:false,approved_excerpt:r.pattern}));
 sources.push(...directSources);
 const rules=active?.sample_ids.length?[{id:`film-engine-profile-${active.version}`,pattern:active.guidance,scope:'screenplay',exceptions:[],evidence:active.sample_ids.map(id=>({source_id:id,locator:sources.find(s=>s.id===id).locator,excerpt_or_correction:'Confirmed original writing used for profile analysis; excerpt reuse is not approved.'})),approval:{statement:'Human approved in Film Engine',date:active.approved_at},status:'active',introduced_version:`1.0.${active.version}`,revised_version:`1.0.${active.version}`}]:[];
 for(const r of active?.direct_rules||[])rules.push({id:r.id,pattern:r.pattern,scope:r.scope,exceptions:r.exceptions,evidence:[{source_id:r.source.id,locator:r.source.locator,excerpt_or_correction:r.pattern}],approval:{statement:'Human approved these explicit preferences in Film Engine',date:active.approved_at},status:'active',introduced_version:version,revised_version:version});
 return {schema_version:VERSION,profile_name:'Manny writing style',profile_version:version,owner:'Manny',status:active?'approved':'empty',sources:sources.map(sourceMetadata),approved_rules:rules,
  // Profile analysis consent is not excerpt-reuse consent. The MVP has no
  // excerpt permission control, so exports contain no reusable prose examples.
  approved_examples:[],
  pending_proposals:snapshot.profiles.filter(p=>p.state==='draft').map(p=>({id:`proposal-${p.version}`,guidance:p.guidance,sample_ids:p.sample_ids,version:p.version})),feedback:snapshot.feedback,
  history:snapshot.profiles.map(p=>({version:p.version,state:p.state,created_at:p.created_at,approved_at:p.approved_at})),prior_snapshots:(snapshot.imports||[]).map(i=>({imported_at:i.imported_at,profile:snapshotMetadata(JSON.parse(i.profile_json))})),apply_instruction:'Use approved active rules and at most three relevant approved examples as style reference data. Keep style separate from canon, director critique and plot facts. Return fresh drafts for human review. No audio cloning, weight training, automatic screenplay overwrite or cross-app synchronization.'};
}
module.exports={validatePortable,importedEvidence,portable};
