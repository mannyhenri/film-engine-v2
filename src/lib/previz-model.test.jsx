import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { webcrypto, createHash } from 'node:crypto';
import { batchPrevizModel, loadPrevizModel, disposePrevizModel, clearPrevizModelCache, previzRepresentationDescriptor } from './previz-model.js';
const T = createRequire(import.meta.url)('../../public/legacy/vendor/three.min.js');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); clearPrevizModelCache(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function scene(count = 12) {
 const root = new T.Group(), material = new T.MeshStandardMaterial(), texture = new T.Texture({ originalPixels: true });
 material.map = texture;
 const geometry = new T.BufferGeometry();
 geometry.setAttribute('position',new T.BufferAttribute(new Float32Array([0,0,0,1,0,0,0,1,0]),3));
 geometry.setAttribute('normal',new T.BufferAttribute(new Float32Array([0,0,1,0,0,1,0,0,1]),3));
 geometry.setAttribute('uv',new T.BufferAttribute(new Float32Array([0,0,1,0,0,1]),2));
 geometry.setAttribute('tangent',new T.BufferAttribute(new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1]),4));
 geometry.setAttribute('color',new T.BufferAttribute(new Uint8Array([255,10,20,255,10,20,255,10,20]),3,true));
 geometry.setIndex([0,1,2]);
 for(let i=0;i<count;i++){const mesh=new T.Mesh(geometry,material);mesh.name='Native object '+i;mesh.position.set(i*.1,0,0);mesh.rotation.z=i*.01;mesh.userData.nativeObject=i;root.add(mesh);}
 root.userData.previz_asset_sha256='source';return {root,material,texture,geometry};
}
function snapshot(root) {
 root.updateMatrixWorld(true);const result=new Map(),inverse=root.matrixWorld.clone().invert();
 root.traverse(o=>{if(o.isMesh)result.set(o.name,{geometry:o.geometry,world:o.matrixWorld.clone(),relative:new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld),material:o.material});});
 return result;
}
function assertRetained(root, before, tolerance=1e-5) {
 const manifest=root.userData.previz_representation, batches=[];root.traverse(o=>{if(o.userData.previz_derived)batches.push(o);});
 let maxWorldError=0,maxAttributeError=0,indexErrors=0;
 for(const source of manifest.sources){const batch=batches[source.batch],original=before.get(source.name);
  expect(batch.material).toBe(original.material);
  const transformed=original.geometry.clone().applyMatrix4(original.relative);
  for(const [name,a] of Object.entries(transformed.attributes)){
   const merged=batch.geometry.attributes[name];expect(merged.itemSize).toBe(a.itemSize);expect(merged.normalized).toBe(a.normalized);expect(merged.array.constructor).toBe(a.array.constructor);
   for(let i=0;i<a.array.length;i++)maxAttributeError=Math.max(maxAttributeError,Math.abs(a.array[i]-merged.array[source.vertexOffset*a.itemSize+i]));
  }
  const actual=new T.Vector3(),expected=new T.Vector3();
  for(let i=0;i<source.vertexCount;i++){actual.fromBufferAttribute(batch.geometry.attributes.position,source.vertexOffset+i).applyMatrix4(root.matrixWorld);expected.fromBufferAttribute(original.geometry.attributes.position,i).applyMatrix4(original.world);maxWorldError=Math.max(maxWorldError,actual.distanceTo(expected));}
  for(let i=0;i<source.indexCount;i++)if(batch.geometry.index.getX(source.indexOffset+i)-source.vertexOffset!==(original.geometry.index?.getX(i)??i))indexErrors++;
  transformed.dispose();
 }
 expect(maxWorldError).toBeLessThan(tolerance);expect(maxAttributeError).toBe(0);expect(indexErrors).toBe(0);
}
test('spatial batches retain every triangle, material, texture, attribute and camera/light pose', async () => {
 const f=scene(),root=f.root;root.position.set(2,4,8);root.rotation.y=.3;root.scale.setScalar(2);
 const camera=new T.PerspectiveCamera(44,16/9,.03,500);camera.position.set(0,2,3);root.children[0].add(camera);
 const light=new T.PointLight(0xff00ff,2,10);light.position.set(0,4,0);root.add(light);
 const transparent=new T.Mesh(f.geometry,new T.MeshStandardMaterial({transparent:true,opacity:.5}));transparent.name='Glass';root.add(transparent);
 root.updateMatrixWorld(true);const projection=camera.projectionMatrix.toArray(),pose=camera.matrixWorld.toArray(),lightPose=light.matrixWorld.toArray(),before=snapshot(root),bounds=new T.Box3().setFromObject(root);
 await batchPrevizModel(T,root,{worldVersionId:'version'});
 const m=root.userData.previz_representation;expect(m.sourceMeshes).toBe(13);expect(m.batchedMeshes).toBe(12);expect(m.drawMeshes).toBe(2);expect(m.triangles).toBe(13);
 expect(root.userData.previz_asset_sha256).toBe('source');expect(m.derivedSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(camera.matrixWorld.toArray()).toEqual(pose);expect(camera.projectionMatrix.toArray()).toEqual(projection);expect(light.matrixWorld.toArray()).toEqual(lightPose);expect(transparent.parent).toBe(root);
 const after=new T.Box3().setFromObject(root);after.min.toArray().forEach((n,i)=>expect(Math.abs(n-bounds.min.toArray()[i])).toBeLessThan(1e-5));
 assertRetained(root,before);expect(f.material.map).toBe(f.texture);expect(f.texture.image).toEqual({originalPixels:true});
 const batch=root.children.find(o=>o.userData.previz_derived);expect(batch.geometry.attributes.color.normalized).toBe(true);expect(batch.geometry.attributes.color.array).toBeInstanceOf(Uint8Array);
});
test('transparent, mirrored, morph, editable and animated primitives preserve original scene objects', async () => {
 const f=scene(4),[a,b,c,d]=f.root.children;a.scale.x=-1;b.geometry=b.geometry.clone();b.geometry.morphAttributes.position=[b.geometry.attributes.position.clone()];c.userData.previz_editable=true;d.material=new T.MeshPhysicalMaterial({transmission:.8});
 await batchPrevizModel(T,f.root);expect(f.root.userData.previz_representation.batches).toBe(0);expect(f.root.children).toEqual([a,b,c,d]);
 const animated=scene(4),original=[...animated.root.children];await batchPrevizModel(T,animated.root,{animated:true});expect(animated.root.children).toEqual(original);
});
test('large scenes use spatial cells rather than one all-town batch', async () => {
 const f=scene(8);f.root.children.forEach((o,i)=>o.position.x=i<4?i:100+i);
 await batchPrevizModel(T,f.root,{cellSize:32});expect(f.root.userData.previz_representation.batches).toBe(2);expect(f.root.userData.previz_representation.drawMeshes).toBe(2);
});
test('invalid batching configuration is refused before modifying the scene', async () => {
 const f=scene(4),original=[...f.root.children];
 await expect(batchPrevizModel(T,f.root,{cellSize:0})).rejects.toThrow(/spatial cell/);
 expect(f.root.children).toEqual(original);
});
test('derived identity is deterministic and bound to the actual source/version/configuration', async () => {
 const a=scene(4),b=scene(4),other=scene(4);
 await batchPrevizModel(T,a.root,{sourceSha256:'actual source',worldVersionId:'v1'});
 await batchPrevizModel(T,b.root,{sourceSha256:'actual source',worldVersionId:'v1'});
 await batchPrevizModel(T,other.root,{sourceSha256:'actual source',worldVersionId:'v2'});
 expect(a.root.userData.previz_representation.derivedSha256).toBe(b.root.userData.previz_representation.derivedSha256);
 expect(a.root.userData.previz_representation.derivedSha256).not.toBe(other.root.userData.previz_representation.derivedSha256);
 const descriptor=previzRepresentationDescriptor(a.root);
 expect(descriptor.sources).toBeUndefined();expect(descriptor.sourceMappingSha256).toBe(hash(JSON.stringify(a.root.userData.previz_representation.sources)));
 expect(descriptor.sourceMappingCount).toBe(4);expect(descriptor.fullManifestBytes).toBe(Buffer.byteLength(JSON.stringify(a.root.userData.previz_representation)));
});
test('interrupted batching never installs a partial scene and disposes temporary buffers', async () => {
 const f=scene(4),original=[...f.root.children],controller=new AbortController();let now=0,pauses=0;
 vi.spyOn(performance,'now').mockImplementation(()=>now+=10);
 const dispose=vi.spyOn(T.BufferGeometry.prototype,'dispose');
 await expect(batchPrevizModel(T,f.root,{signal:controller.signal,yieldTask:async()=>{if(++pauses===5)controller.abort();}})).rejects.toMatchObject({name:'AbortError'});
 expect(f.root.children).toEqual(original);expect(f.root.userData.previz_representation).toBeUndefined();expect(dispose).toHaveBeenCalled();
});
test('model byte cache is keyed by version/hash; mismatched source never reaches parser', async () => {
 const bytes=new TextEncoder().encode('source bytes').buffer,sha=hash(new Uint8Array(bytes)),parse=vi.fn((b,base,ok)=>ok({scene:scene(2).root,animations:[]}));
 const fake={...T,GLTFLoader:class{parse(...args){parse(...args);}}};
 const fetcher=vi.fn(async()=>({ok:true,arrayBuffer:async()=>bytes}));vi.stubGlobal('fetch',fetcher);
 const a=await loadPrevizModel(fake,'http://example.test/set.glb',{worldVersionId:'A',expectedSha256:sha});
 const another=await loadPrevizModel(fake,'http://example.test/set.glb',{worldVersionId:'A',expectedSha256:sha});
 expect(fetcher).toHaveBeenCalledTimes(1);expect(a).not.toBe(another);expect(a.userData.previz_asset_sha256).toBe(sha);
 await loadPrevizModel(fake,'http://example.test/set.glb',{worldVersionId:'B',expectedSha256:sha});expect(fetcher).toHaveBeenCalledTimes(2);
 await expect(loadPrevizModel(fake,'http://example.test/set.glb',{worldVersionId:'C',expectedSha256:'wrong'})).rejects.toThrow(/source changed/);expect(parse).toHaveBeenCalledTimes(3);
 disposePrevizModel(a);disposePrevizModel(another);
});
test('staged prop opt-out preserves object graph and uses authoritative source hash', async () => {
 const f=scene(3),original=[...f.root.children],bytes=new TextEncoder().encode('staged prop').buffer;
 vi.stubGlobal('fetch',async()=>({ok:true,arrayBuffer:async()=>bytes}));
 const fake={...T,GLTFLoader:class{parse(b,base,ok){ok({scene:f.root,animations:[]});}}};
 const root=await loadPrevizModel(fake,'http://example.test/prop.glb',{batch:false});
 expect(root.children).toEqual(original);expect(root.userData.previz_representation).toBeUndefined();expect(root.userData.previz_asset_sha256).toBe(hash(new Uint8Array(bytes)));
});
test('cancelled late parser result is released, shared resources dispose once', async () => {
 const f=scene(3),controller=new AbortController(),callbacks=[];
 const fake={...T,GLTFLoader:class{parse(bytes,base,ok){callbacks.push(ok);}}};
 vi.stubGlobal('fetch',async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode('late').buffer}));
 const pending=loadPrevizModel(fake,'http://example.test/late.glb',{signal:controller.signal});
 await vi.waitFor(()=>expect(callbacks.length).toBe(1));controller.abort();
 const geometry=vi.spyOn(f.geometry,'dispose'),material=vi.spyOn(f.material,'dispose'),texture=vi.spyOn(f.texture,'dispose');
 callbacks[0]({scene:f.root,animations:[]});await expect(pending).rejects.toMatchObject({name:'AbortError'});
 disposePrevizModel(f.root);expect(geometry).toHaveBeenCalledTimes(1);expect(material).toHaveBeenCalledTimes(1);expect(texture).toHaveBeenCalledTimes(1);
});

// Optional actual imported fixtures. Use the shipped GLTF parser, with only
// image decoding replaced by a source-image identity stub (no GPU in jsdom).
// Real image pixels are never modified by batching; this verifies binding and
// source bytes, not raster equivalence, which still needs browser visual QA.
test.runIf(!!process.env.PREVIZ_REAL_MODELS)('real imported sets preserve triangles, projections, bounds and texture/material bindings', async () => {
 new Function('THREE','ArrayBuffer',readFileSync(createRequire(import.meta.url).resolve('../../public/legacy/vendor/gltf-loader.js'),'utf8'))(T,new TextEncoder().encode('').buffer.constructor);
 const reports=[];
 for(const file of JSON.parse(process.env.PREVIZ_REAL_MODELS)){
  const bytes=readFileSync(file),sha=hash(bytes),worldVersionId=file.match(/([0-9a-f-]{36})_collider/)?.[1]||'fixture-version',start=performance.now(),loader=new T.GLTFLoader();
  loader.register(parser=>({name:'TEST_source_images',loadTexture:index=>{const texture=new T.Texture();texture.userData.sourceImage=parser.json.textures[index].source;return Promise.resolve(texture);}}));
  const gltf=await new Promise((ok,no)=>loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,no));
  const root=gltf.scene,parsed=performance.now(),before=snapshot(root),cameras=[],lights=[];
  root.updateMatrixWorld(true);root.traverse(o=>{if(o.isCamera)cameras.push({object:o,pose:o.matrixWorld.toArray(),projection:o.projectionMatrix.toArray()});if(o.isLight)lights.push({object:o,pose:o.matrixWorld.toArray()});});
  const originalBounds=new T.Box3().setFromObject(root);
  root.userData.previz_asset_sha256=sha;await batchPrevizModel(T,root,{sourceSha256:sha,worldVersionId});const end=performance.now();
  const manifest=root.userData.previz_representation;assertRetained(root,before,1e-4);
  cameras.forEach(c=>{expect(c.object.matrixWorld.toArray()).toEqual(c.pose);expect(c.object.projectionMatrix.toArray()).toEqual(c.projection);});lights.forEach(c=>expect(c.object.matrixWorld.toArray()).toEqual(c.pose));
  const bounds=new T.Box3().setFromObject(root);[bounds.min,bounds.max].forEach((v,a)=>v.toArray().forEach((n,i)=>expect(Math.abs(n-[originalBounds.min,originalBounds.max][a].toArray()[i])).toBeLessThan(1e-4)));
  expect(hash(readFileSync(file))).toBe(sha);
  const descriptor=previzRepresentationDescriptor(root),rawManifest=JSON.stringify(manifest);
  const repeated=await new Promise((ok,no)=>loader.parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'',ok,no));
  repeated.scene.userData.previz_asset_sha256=sha;
  await batchPrevizModel(T,repeated.scene,{sourceSha256:sha,worldVersionId});
  expect(repeated.scene.userData.previz_representation.derivedSha256).toBe(manifest.derivedSha256);
  expect(repeated.scene.userData.previz_representation.sourceMappingSha256).toBe(manifest.sourceMappingSha256);
  disposePrevizModel(repeated.scene);
  // Raster-ready source → metres scaling happens once AFTER derivation.
  const metres=new T.Matrix4().makeScale(2,2,2);root.scale.setScalar(2);root.updateMatrixWorld(true);
  for(const original of before.values())original.world.premultiply(metres);
  assertRetained(root,before,2e-4);
  cameras.forEach(c=>{expect(c.object.matrixWorld.toArray()).toEqual(new T.Matrix4().fromArray(c.pose).premultiply(metres).toArray());expect(c.object.projectionMatrix.toArray()).toEqual(c.projection);});
  reports.push({file,sourceSha256:sha,sourceBytes:bytes.length,parseMs:parsed-start,batchMs:end-parsed,sourceMeshes:manifest.sourceMeshes,drawMeshes:manifest.drawMeshes,batches:manifest.batches,triangles:manifest.triangles,cameras:cameras.length,lights:lights.length,bounds:manifest.bounds,derivedSha256:manifest.derivedSha256,sourceMappingSha256:manifest.sourceMappingSha256,fullManifestBytes:Buffer.byteLength(rawManifest),descriptorBytes:Buffer.byteLength(JSON.stringify(descriptor)),repeatHashIdentical:true,scaledGeometryAndProjectionVerified:true});
  if(process.env.PREVIZ_PERFORMANCE_EVIDENCE)writeFileSync(process.env.PREVIZ_PERFORMANCE_EVIDENCE.replace(/\.json$/,file.includes('f3386e8d')?'-town-manifest.json':'-mansion-manifest.json'),rawManifest);
  disposePrevizModel(root);
 }
 if(process.env.PREVIZ_PERFORMANCE_EVIDENCE)writeFileSync(process.env.PREVIZ_PERFORMANCE_EVIDENCE,JSON.stringify(reports,null,2));
},120000);
