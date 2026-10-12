const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
process.env.FILM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'previz-compact-test-'));
const { readWorldWorkspace, roomCameras, structuralNavigation } = require('../routes/previz-workspace');
const { worldGeometry } = require('../lib/worlds');
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function fixture(count = 200) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'previz-loading-source-'));
 const positions = new Float32Array(count * 9), indices = new Uint32Array(count * 3);
 for (let i=0;i<count;i++) {positions.set([i,0,0,i+1,0,0,i,0,1],i*9);indices.set([i*3,i*3+1,i*3+2],i*3);}
 const bin=Buffer.concat([Buffer.from(positions.buffer),Buffer.from(indices.buffer)]);
 const g={asset:{version:'2.0'},scenes:[{nodes:[0,1,2]}],scene:0,nodes:[{name:'Floor fixture',mesh:0},{name:'Wall fixture',mesh:0,translation:[0,3,0]},{name:'Viewpoint',camera:0,translation:[0,2,5]}],
  cameras:[{type:'perspective',perspective:{yfov:.8,znear:.1}}],meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}],
  accessors:[{bufferView:0,componentType:5126,count:positions.length/3,type:'VEC3',min:[0,0,0],max:[count,0,1]},{bufferView:1,componentType:5125,count:indices.length,type:'SCALAR'}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.byteLength},{buffer:0,byteOffset:positions.byteLength,byteLength:indices.byteLength}],buffers:[{byteLength:bin.length}]};
 const text=Buffer.from(JSON.stringify(g)),j=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]),head=Buffer.alloc(20),chunk=Buffer.alloc(8);
 head.write('glTF');head.writeUInt32LE(2,4);head.writeUInt32LE(28+j.length+bin.length,8);head.writeUInt32LE(j.length,12);head.writeUInt32LE(0x4e4f534a,16);
 chunk.writeUInt32LE(bin.length,0);chunk.writeUInt32LE(0x004e4942,4);
 const file=path.join(root,'source.glb'),native=path.join(root,'source.blend');fs.writeFileSync(file,Buffer.concat([head,j,chunk,bin]));fs.writeFileSync(native,'Native bytes unchanged');
 const v={id:'version',project_id:'project',provider:'blender',scale_factor:1,scale_source:'native',bounds_json:JSON.stringify({min:[0,0,0],max:[count,3,1]}),editable_source_json:JSON.stringify({blend:{path:native,sha256:hash(fs.readFileSync(native))}})};
 const db={prepare:sql=>({get:()=>sql.includes('film_assets')?{id:'asset',file_path:file}:v})};
 return {root,file,native,v,db,g};
}
test('compact navigation parses/hashes once, retains camera/support metadata and source identity', () => {
 const f=fixture(),read=fs.readFileSync;let calls=0;
 fs.readFileSync=function(...args){if([f.file,f.native].map(x=>fs.realpathSync(x)).includes(String(args[0])))calls++;return read.apply(this,args);};
 try {
  const a=readWorldWorkspace(f.db,'version'),b=readWorldWorkspace(f.db,'version');
  assert.equal(calls,2,'one GLB read and one native read, neither repeated');
  assert.equal(a.world_sha256,hash(read(f.file)));assert.deepEqual(a,b);
  assert.deepEqual(a.rooms,roomCameras(f.file));assert.deepEqual(a.navigation.supports,structuralNavigation(f.file).supports);assert.deepEqual(a.navigation.blockers,structuralNavigation(f.file).blockers);
  assert.equal(a.rooms[0].verticalFovDegrees,.8*180/Math.PI);assert.deepEqual(a.rooms[0].matrix.slice(12,15),[0,2,5]);
  assert.equal(a.navigation.supports.length,1);assert.equal(a.navigation.blockers.length,1);
  assert.equal(a.mesh.bytes,fs.statSync(f.file).size);assert.match(a.mesh.url,/version_collider\.glb$/);
  assert.deepEqual(a.geometry.vertices,[]);assert.ok(JSON.stringify(a).length<2500);
  f.v.scale_factor=2;const scaled=readWorldWorkspace(f.db,'version');assert.deepEqual(scaled.geometry.bounds.max,[400,6,2]);assert.equal(calls,2);
  assert.deepEqual(scaled.navigation.supports[0].max,[400,0,2]);assert.deepEqual(scaled.navigation.blockers[0].max,[400,6,2]);assert.equal(scaled.navigation.coordinate_space,'metres');assert.deepEqual(scaled.rooms,a.rooms,'camera matrices retain source space');
  f.v.scale_factor=null;const approximate=readWorldWorkspace(f.db,'version');assert.equal(approximate.geometry.scale,null);assert.equal(approximate.navigation.coordinate_space,'source');assert.deepEqual(approximate.navigation.supports,a.navigation.supports);
  fs.appendFileSync(f.native,' changed');assert.throws(()=>readWorldWorkspace(f.db,'version'),/Native source changed/);
 } finally {fs.readFileSync=read;fs.rmSync(f.root,{recursive:true,force:true});}
});
test('sampled triangles reindex only referenced vertices while full bounds and geometry remain intact', () => {
 const f=fixture(1000),small=worldGeometry(f.db,'version',{budget:50});
 assert.equal(small.triangles.length,50);assert.ok(small.vertices.length<=150);
 assert.deepEqual(small.bounds,{min:[0,0,0],max:[1000,3,1]});assert.equal(small.triangles_total,2000);
 const before=hash(fs.readFileSync(f.file));
 const g=require('../lib/glb-parser').parseGlb(fs.readFileSync(f.file)),stride=g.triangles.length/50;
 for(let i=0;i<50;i++)assert.deepEqual(small.triangles[i].map(n=>small.vertices[n]),g.triangles[Math.floor(i*stride)].map(n=>g.vertices[n]));
 small.vertices[0][0]=999;assert.notEqual(worldGeometry(f.db,'version',{budget:50}).vertices[0][0],999,'cache cannot be mutated by caller');
 f.v.scale_factor=2;const scaled=worldGeometry(f.db,'version',{budget:50});assert.deepEqual(scaled.bounds.max,[2000,6,2]);
 assert.equal(hash(fs.readFileSync(f.file)),before);fs.rmSync(f.root,{recursive:true,force:true});
});
test('byte replacement invalidates compact metadata and sampled geometry cache even with same version', () => {
 const f=fixture(),a=readWorldWorkspace(f.db,'version'),geo=worldGeometry(f.db,'version',{budget:50});
 const bytes=fs.readFileSync(f.file),jsonSize=bytes.readUInt32LE(12),offset=20+jsonSize+8;bytes.writeFloatLE(123,offset);fs.writeFileSync(f.file,bytes);
 const b=readWorldWorkspace(f.db,'version');assert.notEqual(a.world_sha256,b.world_sha256);
 const updated=worldGeometry(f.db,'version',{budget:50});assert.notDeepEqual(updated.vertices,geo.vertices);
 fs.rmSync(f.root,{recursive:true,force:true});
});
