/** Projection and editing helpers. A projected edge is evidence, never a new origin. */
export const copy = value => JSON.parse(JSON.stringify(value));
export const IMAGE_HOLD_MS = 5000;
export function promptOf(body = {}) {
 return body.prompt ?? body.promptText ?? body.text ?? body.instances?.[0]?.prompt ?? body.input?.prompt ?? body.input?.promptText ?? (Array.isArray(body.input)?body.input.filter(p=>p.type==='text').map(p=>p.text).join('\n'):undefined) ?? body.world_prompt?.text_prompt ?? body.fields?.find(f=>f.name==='prompt')?.value ?? (Array.isArray(body.shots)?JSON.stringify(body.shots,null,2):undefined) ?? body.contents?.flatMap(c=>(c.parts || []).map(p=>p.text).filter(Boolean)).join('\n') ?? null;
}
export function lineageFacts(lineage) {
 if(!lineage || lineage.status !== 'recorded')return {status:'legacy_unknown',prompt:null,references:[],sent:false,representation:'Legacy origin · request, bytes and transport not recorded'};
 const transport=lineage.transport,body=transport?.body || lineage.approved?.body;
 return {status:'recorded',prompt:promptOf(body),prompt_format:Array.isArray(body?.shots)?'native_shots_json':'text',references:Array.isArray(lineage.approved?.references)?lineage.approved.references:[],references_known:lineage.approved?.references_known!==false&&Array.isArray(lineage.approved?.references),sent:!!transport,
  representation:transport?`Transport ${transport.state || 'recorded'} · ${transport.sent_at || 'time not recorded'}`:'Approved snapshot · transport not recorded'};
}
export function recipeFromLineage(lineage) {
 if(!lineage || lineage.status!=='recorded' || !lineage.approved?.payload)throw new Error('This origin has no recorded input recipe. An exact rerun is unavailable; start a new draft with explicit sources.');
 const payload=copy(lineage.approved.payload),references=lineage.approved.references || [],used=new Set();
 const recipe={provider:lineage.provider,model:lineage.model,prompt:promptOf(lineage.approved.body),settings:{}};
 if(Array.isArray(lineage.approved.body?.shots))recipe.prompt_format='native_shots_json';
 const sourceOf=ref=>typeof ref==='string'?ref:ref?.uri || ref?.data || ref?.file_path || ref?.url || ref?.image_url || ref?.src;
 const captured=(ref,kind,index)=>{
  const uri=sourceOf(ref),role=ref?.reference_role || ref?.role;
  const candidates=references.filter(r=>String(r.mime || '').startsWith(kind+'/'));
  const exact=candidates.find(r=>!used.has(r.order)&&uri&&(sourceOf(r)===uri || r.path===uri)&&(!role||r.role===role)) || candidates.find(r=>!used.has(r.order)&&uri&&(sourceOf(r)===uri || r.path===uri));
  const byId=candidates.find(r=>!used.has(r.order)&&ref?.asset_id && [r.asset_id,r.source_asset_id].includes(ref.asset_id));
  const recorded=exact || byId;
  if(!recorded || !recorded.data || !recorded.order)throw new Error(`Historical ${kind} reference ${index+1} cannot be mapped to recorded exact bytes. Attach an explicit replacement.`);
  used.add(recorded.order);
  return {...(typeof ref==='object'?copy(ref):{}),uri:undefined,data:undefined,file_path:undefined,path:undefined,url:undefined,image_url:undefined,src:undefined,
   captured_reference:{review_id:lineage.review_id,order:recorded.order},reference_role:role || recorded.role,...(kind==='image'&&ref?.position!==undefined?{position:ref.position}:{})};
 };
 const lists=new Set(['reference_images','referenceImages','refImages','references','audio_references','reference_videos','keyframes','promptImage']);
 const singles=new Set(['init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri']);
 for(const [key,value] of Object.entries(payload)){
  if(lists.has(key)){
   if(key==='promptImage'&&!Array.isArray(value)){recipe.promptImage=captured(value,'image',0);continue;}
   if(!Array.isArray(value))throw new Error('The historical reference list is not recorded in a supported form.');
   const kind=key==='audio_references'?'audio':key==='reference_videos'?'video':'image';
   const mapped=value.map((ref,i)=>captured(ref,kind,i));
   if(['keyframes','promptImage','reference_videos'].includes(key))recipe[key]=mapped;else recipe[kind==='audio'?'audio_references':'reference_images']=mapped;
  }else if(singles.has(key)&&value)recipe[key]=captured(value,/video/i.test(key)?'video':'image',0);
  else if(!['prompt','final_prompt','provider','model'].includes(key))recipe.settings[key]=value;
 }
 if(recipe.prompt==null)recipe.prompt=payload.final_prompt ?? payload.prompt ?? payload.text;
 if(typeof recipe.prompt!=='string')throw new Error('The exact historical prompt is not recorded in a supported form.');
 // No guessed ordinal matching: every copied source must identify its stored bytes.
 return recipe;
}

export function editReference(payload,kind,operation,index,reference,listName='reference_images') {
 const next=copy(payload || {});next[kind]={...(next[kind] || {})};const original=next[kind][listName];
 const single=['init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri'].includes(listName) || (listName==='promptImage'&&!Array.isArray(original));
 const list=Array.isArray(original)?[...original]:original?[original]:[];
 // Workspace identities live beside capability recipes, never in provider inputs.
 if(!next.workspace_reference_ids||typeof next.workspace_reference_ids!=='object'||Array.isArray(next.workspace_reference_ids))next.workspace_reference_ids={};if(!next.workspace_reference_ids[kind]||typeof next.workspace_reference_ids[kind]!=='object'||Array.isArray(next.workspace_reference_ids[kind]))next.workspace_reference_ids[kind]={};const kinds=next.workspace_reference_ids[kind],prior=kinds[listName] || [],counts=new Map(),used=new Set();
 const ids=list.map((ref,i)=>{const identity=referenceGeometryIdentity({...(typeof ref==='string'?{uri:ref}:ref),list:listName}),occurrence=counts.get(identity) || 0;counts.set(identity,occurrence+1);let id=prior[i];if(typeof id!=='string'||!/^(r[0-9a-f]{16}-\d+|i[0-9a-f-]{36})$/i.test(id)||used.has(id))id=`${identity}-${occurrence}`;used.add(id);return id;});
 if(operation==='attach')ids.push('i'+globalThis.crypto.randomUUID());else if(operation==='detach')ids.splice(index,1);
 else if(operation==='up'&&index>0)[ids[index-1],ids[index]]=[ids[index],ids[index-1]];else if(operation==='down'&&index<ids.length-1)[ids[index+1],ids[index]]=[ids[index],ids[index+1]];
 kinds[listName]=ids;
 if(operation==='attach')list.push(copy(reference));else if(operation==='swap')list[index]=copy(reference);else if(operation==='detach')list.splice(index,1);
 else if(operation==='up'&&index>0)[list[index-1],list[index]]=[list[index],list[index-1]];else if(operation==='down'&&index<list.length-1)[list[index+1],list[index]]=[list[index],list[index+1]];
 if(single){if(list.length)next[kind][listName]=list[0];else delete next[kind][listName];}else next[kind][listName]=list;return next;
}

export function buildLineageGraph(base, recipes = {}, measurements = {}) {
 const graph={...base,nodes:base.nodes.map(n=>({...n,layout_size:n.layout_size || ({shot:{w:280,h:250},sequence:{w:300,h:320},video:{w:260,h:220}}[n.type])})),edges:[...(base.edges || [])],groups:(base.groups || []).map(g=>({...g,members:[...(g.members || [])],anchor_x:g.layout_x ?? g.x,anchor_y:g.layout_y ?? g.y,lineage_rows:[]}))};
 for(const node of graph.nodes){const saved=base.workspace_geometry?.nodes?.[node.key];if(saved?.pinned){node.x=saved.x;node.y=saved.y;node.pinned=true;}}
 const byKey=new Map(graph.nodes.map(n=>[n.key,n]));
 const add=(node,group)=>{const saved=base.workspace_geometry?.nodes?.[node.key];if(saved?.pinned){node.x=saved.x;node.y=saved.y;node.pinned=true;}graph.nodes.push(node);group.members.push(node.key);byKey.set(node.key,node);return node;};
 for(const group of graph.groups){
  const rows=group.rows || group.members.filter(k=>['shot','sequence'].includes(byKey.get(k)?.type));
  for(const key of rows){
   const owner=byKey.get(key);if(!owner||!['shot','sequence'].includes(owner.type))continue;
   owner.source_x=owner.x;owner.source_y=owner.y;
   const pictures=[...(owner.frames || []),...(owner.flow_frames || [])];
   const videos=[...(owner.videos || [])];
   for(const result of graph.nodes.filter(n=>n.type==='video'&&n.parent===key&&n.asset_id))if(!videos.some(v=>v.asset_id===result.asset_id))videos.push(result);
   for(const [kind,assets] of [['image',pictures],['video',videos]])for(const asset of assets){
    const lineage=recipes[asset.asset_id]?.lineage;
    let result=kind==='image'?add({...asset,key:`board:${asset.asset_id}`,type:'board-version',parent:key,kind,w:260,h:224,lineage},group):byKey.get(`ver:${asset.asset_id}`);
    if(!result)result=add({...asset,key:`ver:${asset.asset_id}`,type:'video',parent:key,w:260,h:220},group);
    result.lineage=lineage;group.lineage_rows.push({[kind]:origin(asset,owner,result,kind,lineage,group)});
   }
   const row={owner:key,drafts:[],auxiliary:[]};
   for(const kind of owner.type==='shot'?['image','video']:['video']){
    const draft=add({key:`draft:${key}:${kind}`,type:'draft-request',kind,parent:key,w:250,h:236,draft:owner.draft},group);
    graph.edges.push({from:kind==='video'?key:draft.key,from_port:kind==='video'?'image':'out',to:kind==='video'?draft.key:key,to_port:kind==='video'?'in':'plates',type:kind,style:'dashed',relationship:'draft'});
    const recipe=owner.draft?.payload?.[kind] || {};
    const references=draftGeometryReferences(recipe,owner.draft?.payload?.workspace_reference_ids?.[kind]);
    const instances=new Map();
    const refs=references.map((ref,i)=>{
     const identity=referenceGeometryIdentity(ref),occurrence=instances.get(identity) || 0;instances.set(identity,occurrence+1);
     const instance=ref.geometry_id || `${identity}-${occurrence}`;
     const node=add({key:`draft-reference:${key}:${kind}:${instance}`,reference_index:i,type:'draft-reference',kind:ref.list==='audio_references'?'audio':ref.list==='reference_videos'||/video/i.test(ref.list)?'video':'plates',recipe_kind:kind,parent:key,reference:ref,w:180,h:64,status:'draft'},group);
     graph.edges.push({from:node.key,from_port:'out',to:draft.key,to_port:'in',type:node.kind,style:'dashed',relationship:'draft_reference'});return node.key;
    });
    row.drafts.push({kind,request:draft.key,refs});
   }
   row.auxiliary=graph.nodes.filter(n=>group.members.includes(n.key) && (n.parent===key || (n.type==='link' && n.sequence_id===owner.id)) && !['origin-request','origin-reference','board-version','draft-request','draft-reference','video'].includes(n.type)).map(n=>n.key);
   group.lineage_rows.push(row);
  }
  const placed=new Set(group.lineage_rows.flatMap(row=>[row.owner,...(row.auxiliary || []),...[row.image,row.video,...(row.drafts || [])].filter(Boolean).flatMap(item=>[item.request,item.result,...item.refs])]).filter(Boolean));
  for(const key of group.members)if(!placed.has(key)){group.lineage_rows.push({owner:key});placed.add(key);}
 }
 return layoutLineageGraph(graph,measurements);
 function origin(asset,owner,result,kind,lineage,group){
  const facts=lineageFacts(lineage),request=add({key:`request:${asset.asset_id}`,type:'origin-request',kind,parent:owner.key,asset_id:asset.asset_id,w:250,h:216,lineage,...facts},group);
  graph.edges=graph.edges.filter(e=>!(e.to===result.key && e.relationship!=='timeline_audio'));
  graph.edges.push({from:request.key,from_port:'out',to:result.key,to_port:'in',type:kind,style:facts.sent?'solid':'dotted',relationship:'immutable_origin'});
  const refs=(facts.references_known?facts.references:[null]).map((ref,i)=>{
   const node=add({key:`reference:${asset.asset_id}:${i}`,type:'origin-reference',kind:ref?.mime?.startsWith('audio/')?'audio':ref?.mime?.startsWith('video/')?'video':'plates',parent:owner.key,asset_id:asset.asset_id,reference:ref,w:180,h:64,status:facts.status},group);
   graph.edges.push({from:node.key,from_port:'out',to:request.key,to_port:'in',type:node.kind,style:ref?'solid':'dotted',relationship:'immutable_reference'});return node.key;
  });
  return {request:request.key,result:result.key,refs};
 }
}

/** A geometry key identifies an explicit source occurrence, never evidence bytes.
 * Unedited legacy drafts use source occurrence slots. Explicit reference edits
 * persist instance IDs beside the recipe, preserving duplicate sources through
 * reorder, detach and swap. No workspace identity is sent to a provider.
 */
export function draftGeometryReferences(recipe={},identities={}){
 identities=identities&&typeof identities==='object'&&!Array.isArray(identities)?identities:{};
 const fields=['reference_images','referenceImages','refImages','references','audio_references','reference_videos','keyframes','promptImage','init_image','image_url','image','end_image','last_frame','source_video','video_url','videoUri','video_uri'];
 const counts=new Map(),taken=new Set();
 return fields.flatMap(list=>(Array.isArray(recipe[list])?recipe[list]:recipe[list]?[recipe[list]]:[]).map((ref,index)=>{
  const entry={...(typeof ref==='string'?{uri:ref}:ref),list},identity=referenceGeometryIdentity(entry);let occurrence=counts.get(identity) || 0;counts.set(identity,occurrence+1);
  let id=identities[list]?.[index];if(typeof id!=='string'||!/^(r[0-9a-f]{16}-\d+|i[0-9a-f-]{36})$/i.test(id)||taken.has(id)){id=`${identity}-${occurrence}`;while(taken.has(id))id=`${identity}-${++occurrence}`;}
  taken.add(id);return {...entry,geometry_id:id};
 }));
}
export function referenceGeometryIdentity(reference,includeRoles=false){
 const canonical=(value,depth=0)=>Array.isArray(value)?value.map(v=>canonical(v,depth+1)):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(k=>depth>0 || k!=='geometry_id'&&(includeRoles || !['reference_role','role','wire_role','order','position'].includes(k))).map(k=>[k,canonical(value[k],depth+1)])):value;
 const text=JSON.stringify(canonical(reference));let a=2166136261,b=2246822507;
 for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b^text.charCodeAt(i),3266489909);}
 return 'r'+(a>>>0).toString(16).padStart(8,'0')+(b>>>0).toString(16).padStart(8,'0');
}
/** Whole JSON edits reconcile visual identity by full reference, then source.
 * New sources receive new instances; removed sources keep only harmless old geometry.
 */
export function replaceDraftRecipe(payload,kind,recipe){
 const next=copy(payload || {}),old=draftGeometryReferences(next[kind],next.workspace_reference_ids?.[kind]),refs=draftGeometryReferences(recipe),used=new Set(),ids={},matches=refs.map(()=>-1);
 // Reserve unchanged duplicate references before matching edited source locators.
 for(const includeRoles of [true,false])for(const [slot,ref] of refs.entries())if(matches[slot]<0){
  const index=old.findIndex((candidate,i)=>!used.has(i)&&referenceGeometryIdentity(candidate,includeRoles)===referenceGeometryIdentity(ref,includeRoles));
  if(index>=0){used.add(index);matches[slot]=index;}
 }
 for(const [slot,ref] of refs.entries()){const index=matches[slot],id=index>=0?old[index].geometry_id:'i'+globalThis.crypto.randomUUID();(ids[ref.list] ||= []).push(id);}
 if(!next.workspace_reference_ids||typeof next.workspace_reference_ids!=='object'||Array.isArray(next.workspace_reference_ids))next.workspace_reference_ids={};next.workspace_reference_ids[kind]=ids;next[kind]=copy(recipe);return next;
}
export const WORKSPACE_SPACING=Object.freeze({column:96,branch:52,shot:140,scene:112,header:148,padding:36});
export function nodeFootprint(node){
 return {w:node.empty_size?Math.max(node.w,240+node.empty_size.w):node.w,h:Math.max(node.h,node.empty_size?.h || 0)};
}
export function layoutLineageGraph(graph,measurements={}){
 graph.layout_measurements=copy(measurements || {});
 const by=new Map(graph.nodes.map(n=>[n.key,n])),pad=WORKSPACE_SPACING.padding;
 for(const n of graph.nodes){
  n.layout_size ||= {w:n.w || 240,h:n.h || 180};
  const measured=measurements?.[n.key],size=n.layout_size;
  n.w=measured?.width>0?measured.width:size.w;n.h=measured?.height>0?measured.height:size.h;
  if(n.type==='sound'&&!n.versions?.length){const empty=measurements?.[n.key+':empty'];n.empty_size={w:empty?.width>0?empty.width:180,h:empty?.height>0?empty.height:110};}
 }
 const maxW=types=>Math.max(...graph.nodes.filter(n=>types.includes(n.type)).map(n=>nodeFootprint(n).w),0);
 const widths=[Math.max(180,maxW(['origin-reference','draft-reference','link'])),Math.max(250,maxW(['origin-request','draft-request'])),
  Math.max(300,maxW(['shot','sequence','board-version'])),Math.max(250,maxW(['origin-request','draft-request'])),Math.max(260,maxW(['video'])),Math.max(240,maxW(['audio','sound','link','inbetween']))];
 const lanes=[pad];for(let i=1;i<widths.length;i++)lanes.push(lanes[i-1]+widths[i-1]+WORKSPACE_SPACING.column);
 graph.columns=lanes.map((x,i)=>({x,width:widths[i],label:['ORDERED INPUTS','IMAGE REQUEST','STORYBOARD / SHOT','VIDEO REQUEST','FOOTAGE VERSIONS','EDIT / AUDIO'][i]}));
 let sceneY=20;
 for(const group of graph.groups){
  const anchorX=group.manual_position?group.anchor_x:20,anchorY=group.manual_position?group.anchor_y:sceneY;
  group.layout_x=anchorX;group.layout_y=anchorY;group.shot_rows=[];
  const members=group.members.map(k=>by.get(k)).filter(Boolean),assigned=new Set();
  const pins=members.filter(n=>n.pinned);
  const rows=(group.rows || members.filter(n=>['shot','sequence'].includes(n.type)).map(n=>n.key)).filter(k=>by.has(k));
  let cursor=anchorY+WORKSPACE_SPACING.header;
  const rowFor=owner=>{
   const children=members.filter(n=>n.parent===owner.key || (n.type==='link'&&n.sequence_id===owner.id) || (n.type==='inbetween'&&n.from_shot_id===owner.id));
   const descendants=[...children];for(let i=0;i<descendants.length;i++)for(const n of members)if(n.parent===descendants[i].key&&!descendants.includes(n))descendants.push(n);
   const nodes=[owner,...descendants].filter(n=>!assigned.has(n.key));nodes.forEach(n=>assigned.add(n.key));
   const row={owner:owner.key,label:owner.shot_code || owner.name || owner.title || owner.type,members:nodes.map(n=>n.key),branches:[]};
   group.shot_rows.push(row);
   const item=(key,lane,dy=0)=>({key,lane,dy});
   const stack=(keys,lane,start=0)=>{let dy=start;return keys.map(key=>{const it=item(key,lane,dy);dy+=nodeFootprint(by.get(key)).h+16;return it;});};
   const refsFor=request=>graph.edges.filter(e=>e.to===request.key&&['immutable_reference','draft_reference'].includes(e.relationship)).map(e=>e.from);
   const imageDraft=children.find(n=>n.type==='draft-request'&&n.kind==='image'),videoDraft=children.find(n=>n.type==='draft-request'&&n.kind==='video');
   const working=[item(owner.key,owner.type==='depth-source'?0:owner.type==='depth-map'?3:['shot','sequence'].includes(owner.type)?2:5)],imageRefs=imageDraft?refsFor(imageDraft):[];
   working.push(...stack(imageRefs,0));
   if(imageDraft)working.push(item(imageDraft.key,1));
   if(videoDraft){working.push(item(videoDraft.key,3));const start=imageRefs.reduce((sum,k)=>sum+nodeFootprint(by.get(k)).h+16,0);working.push(...stack(refsFor(videoDraft),0,start));}
   const links=children.filter(n=>n.type==='link');
   if(links.length){const start=working.filter(i=>i.lane===0).reduce((max,i)=>Math.max(max,i.dy+nodeFootprint(by.get(i.key)).h+16),0);working.push(...stack(links.map(n=>n.key),0,start));}
   row.branches.push({label:'Working recipe · edits create the next version',items:working});
   // Image and video histories are independent sets; index equality is never a causal link.
   for(const kind of ['image','video'])for(const request of children.filter(n=>n.type==='origin-request'&&n.kind===kind)){
    const result=graph.edges.find(e=>e.from===request.key&&e.relationship==='immutable_origin')?.to;
    row.branches.push({label:kind==='image'?'Storyboard origin':'Footage origin',items:[...stack(refsFor(request),0),item(request.key,kind==='image'?1:3),...(result?[item(result,kind==='image'?2:4)]:[])]});
   }
   const placed=new Set(row.branches.flatMap(b=>b.items.map(i=>i.key)));
   const auxiliary=nodes.filter(n=>!placed.has(n.key));
   if(auxiliary.length)row.branches.push({label:'Independent edit and audio',items:stack(auxiliary.map(n=>n.key),5)});
   const rowStart=cursor-40;
   for(const branch of row.branches){
    const automatic=branch.items.filter(i=>!by.get(i.key).pinned);
    for(let attempts=0;attempts<=pins.length;attempts++){
     let next=cursor;
     for(const i of automatic){const n=by.get(i.key),f=nodeFootprint(n),x=anchorX+lanes[i.lane];for(const pin of pins){const p=nodeFootprint(pin);if(x<pin.x+p.w+28&&x+f.w+28>pin.x&&cursor+i.dy<pin.y+p.h+28&&cursor+i.dy+f.h+28>pin.y)next=Math.max(next,pin.y+p.h+28-i.dy);}}
     if(next===cursor)break;cursor=next;
    }
    for(const i of automatic){const n=by.get(i.key);n.x=anchorX+lanes[i.lane];n.y=cursor+i.dy;}
    branch.y=cursor;
    cursor+=Math.max(0,...automatic.map(i=>i.dy+nodeFootprint(by.get(i.key)).h))+WORKSPACE_SPACING.branch;
   }
   const bottom=cursor-WORKSPACE_SPACING.branch;
   // Free dragging changes scene bounds, not narrative row ownership. A node
   // moved beyond its work row is marked as an outlier; row guides do not expand
   // across neighboring rows or paint over their cards.
   row.outliers=nodes.filter(n=>n.pinned&&(n.y<rowStart+40 || n.y+nodeFootprint(n).h>bottom)).map(n=>n.key);
   row.x=anchorX+pad-20;row.y=rowStart;
   row.w=lanes[5]+widths[5]-pad+40;row.h=Math.max(80,bottom+28-row.y);
   cursor=bottom+WORKSPACE_SPACING.shot;
  };
  for(const key of rows)rowFor(by.get(key));
  for(const n of members)if(!assigned.has(n.key))rowFor(n);
  const left=Math.min(anchorX,...members.map(n=>n.x-pad)),top=Math.min(anchorY,...members.map(n=>n.y-WORKSPACE_SPACING.header));
  const right=Math.max(anchorX+lanes[5]+widths[5]+pad,...members.map(n=>n.x+nodeFootprint(n).w+pad));
  const bottom=Math.max(anchorY+240,...members.map(n=>n.y+nodeFootprint(n).h+pad));
  group.x=left;group.y=top;group.expanded_w=Math.max(group.minimum_w || 0,right-left);group.expanded_h=Math.max(group.minimum_h || 0,bottom-top);
  group.w=group.collapsed?240:group.expanded_w;group.h=group.collapsed?132:group.expanded_h;
  sceneY=Math.max(sceneY,group.y+group.h+WORKSPACE_SPACING.scene);
 }
 return graph;
}
export function timelineTiles(timeline){return (timeline?.entries || []).map(entry=>({...entry,duration_ms:entry.kind==='still'?IMAGE_HOLD_MS:entry.duration_ms || IMAGE_HOLD_MS}));}
export function audioAt(track,positionMs) {
 const start=Number(track.timeline_start_ms ?? track.absolute_start_ms),duration=Number(track.timeline_used_duration_ms);
 const reason=track.source?.offline || track.offline?'offline':['source_changed','outside_cut','unplaced'].includes(track.status)?track.status:track.muted?'muted':null;
 return {active:!reason&&Number.isFinite(start)&&duration>0&&positionMs>=start&&positionMs<start+duration,reason,
  source_ms:(Number(track.effective_source_in_ms)||0)+positionMs-start,gain:Math.pow(10,(Number(track.gain_db)||0)/20)};
}
/** Timers are owned by one playback session and discarded on seek, pause or remount. */
export function createAudioScheduler({createMedia,urlOf,now=()=>performance.now(),gainFor,onWarning=()=>{}}) {
 let records=[],timers=[],generation=0;
 function stop(){generation++;timers.forEach(clearTimeout);timers=[];records.forEach(r=>{r.media.pause();r.media.onloadedmetadata=null;r.gain?.close?.();});records=[];}
 function start(tracks,positionMs){stop();const token=generation,started=now();
  for(const track of tracks || []){
   if(track.muted)continue;if(['source_changed','outside_cut','unplaced'].includes(track.status)){onWarning('Audio unavailable ('+track.status+'): '+(track.asset_id || track.id));continue;}if(track.source?.offline || track.offline || !(track.timeline_used_duration_ms>0)){if(track.source?.offline||track.offline)onWarning('Offline audio: '+(track.asset_id || track.id));continue;}
   const media=createMedia(urlOf(track.url || track.source?.url || track.source?.path)),gain=gainFor?.(media),linear=Math.pow(10,(Number(track.gain_db)||0)/20);records.push({media,gain});
   if(gain)gain.set(linear);else if(linear<=1)media.volume=linear;else{onWarning('Audio gain above 0 dB requires Web Audio support; this track cannot be played accurately.');continue;}
   const begin=()=>{if(token!==generation)return;const at=audioAt(track,positionMs+now()-started);if(!at.active)return;const seek=()=>{if(token!==generation)return;const current=audioAt(track,positionMs+now()-started);if(!current.active)return;media.currentTime=current.source_ms/1000;media.play().catch(()=>onWarning('Audio playback unavailable: '+(track.asset_id || track.id)));};if(media.readyState===0)media.onloadedmetadata=seek;else seek();};
   const start=track.timeline_start_ms ?? track.absolute_start_ms,delay=Math.max(0,start-positionMs),remaining=start+track.timeline_used_duration_ms-positionMs;if(remaining<=0)continue;
   if(delay)timers.push(setTimeout(begin,delay));else begin();timers.push(setTimeout(()=>media.pause(),remaining));
  }
 }
 return {start,stop};
}
