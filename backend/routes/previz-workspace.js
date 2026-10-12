const { getService } = require('../lib/previz-snapshot');
function workspaceLighting(body) {
    const lighting = require('../lib/lighting'), resolved = lighting.resolveLighting({ lighting: body.settings || {} });
    const mood = lighting.MOODS[resolved.type];
    return { ...resolved, rig: lighting.rigLights(resolved, body.camera, body.subject),
        mood: mood ? { ...mood, colour: mood.tint || lighting.kelvinToHex(mood.kelvin) } : null };
}
const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
};
// Evaluate cameras against this set's local blocking; never write a target shot.
function exploreWorkspace(service, body) {
    const source = service.worldSource(body.world_version_id);
    if (body.world_sha256 !== source.geometry.sha256) throw new Error('Set source changed');
    const cine = require('../lib/cinematography'), camera = body.blocking?.camera;
    if (!camera || !Array.isArray(camera.position) || !Array.isArray(camera.rotation)
        || [...camera.position, ...camera.rotation].some(x => !Number.isFinite(x))) throw new Error('Current local camera is required');
    const context = { blocking: body.blocking, world: {
        bounds: JSON.parse(source.version.bounds_json || 'null'), scale_factor: source.version.scale_factor,
    } };
    if (body.operation === 'brief') return cine.exploreBrief(context);
    if (body.operation === 'compare') return cine.compareCameras(body.a, body.b);
    if (body.operation === 'accept') return cine.acceptCandidates(body.candidates || [], context);
    throw new Error('Unknown local Explore operation');
}
async function handlePrevizWorkspace(req, res, parts) {
    try {
        const service = getService(), id = parts[2], action = parts[3], body = req.body || {};
        if (id === 'follow' && req.method === 'POST') {
            const source=service.worldSource(body.world_version_id);
            if(source.geometry.sha256!==body.world_sha256)throw new Error('Set source changed');
            return json(res,200,{cameraKeys:require('../lib/previs-subject-path').followCameraKeys(body.subject,{durationMs:body.durationMs,distanceM:body.distance_m,heightM:body.height_m,focalMm:body.focal_mm})});
        }
        if (id === 'explore' && req.method === 'POST') return json(res, 200, exploreWorkspace(service, body));
        if (id === 'lighting' && req.method === 'POST') {
            return json(res, 200, workspaceLighting(body));
        }
        if (id === 'capture' && req.method === 'POST') return json(res, 201, await service.prepare(body));
        if (id === 'world' && action && req.method === 'GET') {
            // Reading the navigation workspace is not a render freeze. Cache
            // derived metadata by version and actual file identity; prepare,
            // approve and render still use worldSource's fresh byte hashes.
            return json(res, 200, readWorldWorkspace(require('../db/database').db, action));
        }
        if (id && action === 'preview' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type':'image/png', 'Cache-Control':'no-store' });
            return require('../lib/file-storage').pipeFile(service.get(id).preview_path, res);
        }
        if (id && action === 'render-review' && req.method === 'POST') return json(res, 200, await service.prepareRender(id));
        if (id === 'reviews' && action && req.method === 'POST') {
            const rid = action, act = parts[4];
            if (act === 'approve') return json(res, 200, service.approve(rid, body));
            if (act === 'cancel') return json(res, 200, service.cancel(rid));
            if (body.id !== rid) return json(res, 409, { error: 'Approval token belongs to another review' });
            if (act === 'draft') return json(res, 201, service.saveDraft(body));
            if (act === 'render') return json(res, 201, await service.render(body));
        }
        return json(res, 404, { error: 'Previz workflow route not found' });
    } catch (err) { return json(res, err.status || 400, { error: err.message }); }
}
function roomCameras(file) {
    const g = typeof file === 'string' ? workspaceGlb(file).document : file;
    const { nodeMatrix, multiply } = require('../lib/glb-parser'), out = [], visited = new Set();
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const visit = (id, parent) => {
        if (visited.has(id)) throw new Error('Invalid set camera hierarchy');
        visited.add(id);
        const node = g.nodes[id], matrix = multiply(parent, nodeMatrix(node));
        if (node.camera != null && g.cameras?.[node.camera]?.perspective) out.push({
            id: String(id), name: node.name || g.cameras[node.camera].name || 'Viewpoint',
            matrix, verticalFovDegrees: g.cameras[node.camera].perspective.yfov * 180 / Math.PI,
        });
        for (const child of node.children || []) visit(child, matrix);
    };
    for (const id of g.scenes?.[g.scene || 0]?.nodes || []) visit(id, identity);
    return out;
}
// Source-space AABBs from actual named structural meshes; never one solid floor box.
function structuralNavigation(file) {
 const g=typeof file==='string'?workspaceGlb(file).document:file;
 const {nodeMatrix,multiply,applyMatrix,boundsOf}=require('../lib/glb-parser'),supports=[],blockers=[],seen=new Set();
 const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
 const visit=(id,parent)=>{if(seen.has(id))throw new Error('Invalid structural hierarchy');seen.add(id);
  const node=g.nodes[id],matrix=multiply(parent,nodeMatrix(node)),name=node.name||'',physical=node.extras?.physical,mesh=g.meshes?.[node.mesh];
  const support=physical!==false&&/(?:floor(?: \d{2} \d{2}| fixture)?|tread \d{2}|landing)(?:\.\d+)?$/i.test(name)&&!/riser|waist|rail|guard|beam|post|pier|column|header|carpet|board|joint|wear|scratch|stain|patch|dust|grime|crack|dirt|chip|scuff/i.test(name);
  const blocker=physical!==false&&(/^(?:B|G|U) .* \d{2} \d{2}$/i.test(name)||/(?:^wall\b| wall$|wall fixture|oak leaf|inch glass)/i.test(name))&&!/decor|paper|trim|board|joint|wear|scratch|stain|patch|dust|grime|crack|dirt|chip|scuff|frame|skirt|mould|panel|paint/i.test(name);
  if(mesh&&(support||blocker)){const points=[];for(const p of mesh.primitives||[]){const a=g.accessors[p.attributes?.POSITION];if(!a?.min||!a?.max)continue;for(const x of [a.min[0],a.max[0]])for(const y of [a.min[1],a.max[1]])for(const z of [a.min[2],a.max[2]])points.push(applyMatrix(matrix,[x,y,z]));}
   if(points.length){const b={name,...boundsOf(points).bounds};if(support)supports.push(b);if(blocker)blockers.push(b);}}
  for(const child of node.children||[])visit(child,matrix);
 };
 for(const id of g.scenes?.[g.scene||0]?.nodes||[])visit(id,identity);
 return{supports,blockers,scope:'Named structural floors, stair treads, walls and door leaves. Furniture is excluded.'};
}
// A bounded process cache holds the GLB JSON, not its binary mesh or decoded
// vertices. Both camera and navigation walks share the same read/parse/hash.
const workspaceCache = new Map(), nativeReadCache = new Map();
function fileIdentity(file) {
 const fs=require('fs'),p=fs.realpathSync(file),s=fs.statSync(p,{bigint:true});
 return {path:p,bytes:Number(s.size),key:[p,s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':')};
}
function keep(cache,key,value) {
 cache.set(key,value);while(cache.size>4)cache.delete(cache.keys().next().value);return value;
}
function workspaceGlb(file) {
 const ev=fileIdentity(file);if(workspaceCache.has(ev.key))return workspaceCache.get(ev.key);
 const bytes=require('fs').readFileSync(ev.path);
 if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw new Error('Invalid set GLB');
 const n=bytes.readUInt32LE(12);if(bytes.readUInt32LE(16)!==0x4e4f534a||20+n>bytes.length)throw new Error('Invalid set GLB JSON');
 const document=JSON.parse(bytes.toString('utf8',20,20+n).replace(/[\s\u0000]+$/,''));
 const sha256=require('crypto').createHash('sha256').update(bytes).digest('hex');
 return keep(workspaceCache,ev.key,{document,sha256,bytes:ev.bytes,path:ev.path,rooms:roomCameras(document),navigation:structuralNavigation(document)});
}
function nativeEvidence(file) {
 const ev=fileIdentity(file);if(nativeReadCache.has(ev.key))return nativeReadCache.get(ev.key);
 return keep(nativeReadCache,ev.key,{path:ev.path,sha256:require('crypto').createHash('sha256').update(require('fs').readFileSync(ev.path)).digest('hex')});
}
function parseJSON(value,fallback=null) {try{return JSON.parse(value);}catch{return fallback;}}
function readWorldWorkspace(db,id) {
 const v=db.prepare('SELECT v.*,w.project_id,w.location_id,w.name world_name FROM film_world_versions v JOIN film_worlds w ON w.id=v.world_id WHERE v.id=? AND w.archived_at IS NULL').get(id);
 if(!v){const e=new Error('Set version is missing or archived');e.status=404;throw e;}
 const asset=db.prepare("SELECT a.*,wa.metadata_json import_metadata FROM film_world_assets wa JOIN film_assets a ON a.id=wa.asset_id WHERE wa.world_version_id=? AND wa.kind='collider'").get(id);
 if(!asset?.file_path)throw new Error('This set has no readable 3D geometry');
 const g=workspaceGlb(asset.file_path),editable=parseJSON(v.editable_source_json);
 if(editable?.blend&&nativeEvidence(editable.blend.path).sha256!==editable.blend.sha256)throw new Error('Native source changed since import. Reimport the matched set');
 const factor=Number(v.scale_factor),scale=Number.isFinite(factor)&&factor>0?factor:null,b=parseJSON(v.bounds_json);
 const bounds=b?{min:b.min.map(x=>x*(scale||1)),max:b.max.map(x=>x*(scale||1))}:null;
 const geometry={world_version_id:id,vertices:[],triangles:[],bounds,size:bounds?bounds.max.map((x,i)=>x-bounds.min[i]):null,scale,
  scale_state:require('../lib/world-scale').describeScale(v),representation:'bounds-only'};
 const mesh={url:require('../lib/world-assets').servedUrlFor(v.project_id,id,'collider'),sha256:g.sha256,bytes:g.bytes,source:v.provider};
 // The walking controller compares metres. Camera matrices remain in source
 // space for pose selection; physical boxes follow the version's scale read.
 const physical=b=>({...b,min:b.min.map(x=>x*(scale||1)),max:b.max.map(x=>x*(scale||1))});
 const navigation={...g.navigation,supports:g.navigation.supports.map(physical),blockers:g.navigation.blockers.map(physical),coordinate_space:scale?'metres':'source'};
 return {world_version_id:id,world_sha256:g.sha256,native:editable?.blend?{...editable.blend}:null,geometry,mesh,rooms:g.rooms,navigation,
  read_contract:'Navigation metadata cached by file identity. Capture, approval and render rehash authoritative source bytes.'};
}
module.exports = { handlePrevizWorkspace, roomCameras, structuralNavigation, exploreWorkspace, workspaceLighting, readWorldWorkspace };
