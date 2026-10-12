const {PORTS}=require('./composite-contract');
const {versionUrl}=require('./production-composite');
const wireType={VideoAsset:'video',AlphaSequence:'alpha',DepthSequence:'depth',ImagePlate:'image',CompositeVideo:'video',ForegroundLayer:'video',AlphaPreview:'alpha'};
const inputType={VideoAsset:'composite-source',AlphaSequence:'alpha-output',DepthSequence:'depth-output',ImagePlate:'composite-plate'};
const outputType={AlphaSequence:'alpha-output',AlphaPreview:'alpha-preview',CompositeVideo:'composite-output',ForegroundLayer:'foreground-layer'};
const inputId={source:'source_asset_id',alpha:'alpha_asset_id',background:'background_asset_id',foreground:'foreground_asset_id',depth:'depth_asset_id'};
function graphProjection(db,pid){
 let records;try{records=db.prepare('SELECT * FROM production_composite_nodes WHERE project_id=? ORDER BY created_at,id').all(pid);}catch{return {nodes:[],edges:[],groups:[]};}
 const nodes=[],edges=[],groups=[];
 for(const r of records){
  const source=JSON.parse(r.source_json),settings=JSON.parse(r.settings_json),inputs=JSON.parse(r.inputs_json),key='composite:'+r.id;
  const job=db.prepare('SELECT * FROM production_composite_jobs WHERE node_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(r.id);
  const latest=db.prepare('SELECT * FROM production_composite_versions WHERE node_id=? ORDER BY version DESC LIMIT 1').get(r.id);
  const ports=PORTS[r.node_type],input_types=Object.fromEntries(Object.entries(ports.inputs).map(([k,v])=>[k,v.types[0]])),rows=[];
  for(const [port,type] of Object.entries(input_types)){
   const aid=inputs[inputId[port]];if(!aid)continue;
   const a=db.prepare('SELECT * FROM film_assets WHERE id=? AND project_id=?').get(aid,pid);if(!a)continue;
   const k='composite-input:'+r.id+':'+port;let meta={};try{meta=JSON.parse(a.metadata||'{}');}catch{}
   nodes.push({key:k,type:inputType[type],id:r.id,workflow:'composite',asset_id:aid,name:port+' · '+(a.file_name||type),output_type:type,output_types:{out:type},fixture:meta.fixture===true||meta.provenance?.fixture===true,url:type==='VideoAsset'?`/film/projects/${pid}/production-composite/sources/${aid}`:null,w:260,h:220});
   edges.push({from:k,from_port:'out',to:key,to_port:port,type:wireType[type],relationship:'typed_'+port,style:'solid'});rows.push(k);
  }
  const asset=db.prepare('SELECT version FROM film_assets WHERE id=? AND project_id=?').get(source.asset_id,pid);
  nodes.push({key,type:r.node_type,id:r.id,workflow:'composite',name:r.node_type==='subject-matte'?'Subject Matte':'Composite',revision:r.revision,settings,input_types,output_types:ports.outputs,status:job?.status||'configuration_required',progress:job?.progress||0,phase:job?.phase||'Open controls to inspect inputs and review a plan',stale:!asset||asset.version!==source.asset_version,w:320,h:r.node_type==='composite'?390:240});rows.push(key);
  const versions=[];
  if(latest){const m=JSON.parse(latest.metadata_json),ids=JSON.parse(latest.assets_json);
   for(const [kind,info] of Object.entries(m.outputs||{})){
    const type=info.type;if(!outputType[type])continue;
    const k='composite-output:'+latest.id+':'+kind;
    nodes.push({key:k,type:outputType[type],id:r.id,workflow:'composite',asset_id:ids[kind],version_id:latest.id,version:latest.version,name:type+' · v'+latest.version,output_type:type,output_types:{out:type},fixture:m.fixture===true,stale:m.node_revision!==r.revision,url:['CompositeVideo','AlphaPreview'].includes(type)?versionUrl(pid,latest.id,kind):null,metadata:m,w:260,h:230});
    edges.push({from:key,from_port:type==='CompositeVideo'?'video':type==='ForegroundLayer'?'foreground':'alpha',to:k,to_port:'in',type:wireType[type],relationship:'immutable_processing_output',style:'solid'});versions.push(k);
   }
  }
  groups.push({id:'composite-group:'+r.id,label:(r.node_type==='subject-matte'?'MATTE':'COMPOSITE')+' · '+source.file_name,rows,shots:[],sequence:null,versions,sounds:[],links_start:[],links_end:[]});
 }
 return {nodes,edges,groups};
}
module.exports={graphProjection};
