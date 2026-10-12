import { beforeEach, expect, test, vi } from 'vitest';
import { createRequire } from 'node:module';
import { installLegacy } from '../test/setup.js';
import { previzWorkspace as workspace } from './previz-workspace.js';
import { nearestSupport, blocked, walkStep } from './previz-navigation.js';
import * as E from '../pages/previs/engine.js';
let f, W;
const THREE = createRequire(import.meta.url)('../../public/legacy/vendor/three.min.js');
beforeEach(async () => {
  vi.restoreAllMocks();
  f = installLegacy({
    project: {
      id: 'p1',
      title: 'Fixture'
    }
  });
  W = f.fake.WORLD;
  Object.assign(E.MESHLOOK, {root:null, loadController:null, renderFrame:null, url:null, loadingVersion:null, versionId:null, worldSha256:null, renderer:null, scene:null});
  Object.assign(W, {
    world: {
      id: 'w1'
    },
    scout: {
      name: 'Fixture'
    },
    version: {
      id: 'v1',
      scale_factor: 1
    },
    shots: [{
      id: 'a',
      shot_code: '1A',
      location: 'Fixture'
    }, {
      id: 'b',
      shot_code: '1B',
      location: 'Fixture'
    }, {
      id: 'other',
      shot_code: '2A',
      location: 'Elsewhere'
    }],
    blocking: {
      blocking: {
        camera: {
          position: [0, 1.68, 4],
          rotation: [0, 0, 0]
        },
        subjects: [{
          name: 'Real prop',
          position: [0, 0, 0]
        }]
      },
      lighting: {
        rig: [{
          role: 'key'
        }]
      }
    },
    lens: 35
  });
  Object.assign(workspace, {
    E,
    revision: 0,
    sourceGeneration: 0,
    collapsedSets: {},
    creation: null,
    creationGeneration: 0,
    draft: null,
    pending: null,
    source: {
      world_sha256: 'hash'
    },
    busy: false
  });
  vi.spyOn(E, 'worldConsoleRender').mockImplementation(() => {});
  vi.spyOn(E, 'worldWalkRepaint').mockImplementation(() => {});
  f.fake.api.mockImplementation(async path => ({
    card: {
      action: `Canonical ${path}`
    }
  }));
  await E.worldLoadFlags();
  Object.assign(E.WORLD_FLAGS, {previs_console:true,world_engine:true,world_splats:true});
});
test('clicking the selected location collapses rooms across repaint without resetting the explored camera', async () => {
  window.THREE = THREE;
  W.scout = {worldId:'w1',versionId:'v1',name:'Fixture'};
  W.scoutable = [{world:W.world,version:W.version,name:'Fixture'}];
  W.geometryFor = 'v1';
  const room = {id:'room',name:'Foyer',matrix:new THREE.Matrix4().makeTranslation(9,1.7,2).toArray(),verticalFovDegrees:50};
  workspace.source = {world_version_id:'v1',world_sha256:'hash',rooms:[room]};
  f.fake.api.mockResolvedValue(workspace.source);
  const camera = JSON.stringify(W.blocking.blocking.camera);
  const click = async () => {
    const div = document.createElement('div'); div.innerHTML = workspace.railHtml();
    const handler = div.querySelector('.pv-set-entry > button').getAttribute('onclick');
    await new Function('worldScoutSelect','previzSelectSet',`return ${handler}`)(E.worldScoutSelect,id=>workspace.previzSelectSet(id));
  };
  await click();
  expect(JSON.stringify(W.blocking.blocking.camera)).toBe(camera);
  for (let n=0;n<3;n++) {
    workspace.changed();
    expect(workspace.railHtml()).not.toContain('pv-room-list');
  }
  await E.worldScoutSelect('w1');
  expect(workspace.railHtml()).not.toContain('pv-room-list');
  await click();
  expect(workspace.railHtml()).toContain('Foyer');
  expect(JSON.stringify(W.blocking.blocking.camera)).toBe(camera);
});
test('turning while a set audit is pending keeps the explored camera when the default room arrives', async () => {
  window.THREE = THREE;
  let release;
  f.fake.api.mockImplementation(()=>new Promise(resolve=>release=resolve));
  const opening = workspace.opened();
  E.worldWalkTurn(15,5);
  const camera = JSON.stringify(W.blocking.blocking.camera);
  release({world_version_id:'v1',world_sha256:'hash',rooms:[{id:'start',name:'Initial room',matrix:new THREE.Matrix4().makeTranslation(9,1.7,2).toArray(),verticalFovDegrees:50}]});
  await opening;
  expect(JSON.stringify(W.blocking.blocking.camera)).toBe(camera);
  expect(workspace.source.world_sha256).toBe('hash');
});
test('an empty location target picker offers explicit shot creation in a matching scene', async () => {
  W.world.location_id = 'loc'; W.scout = {worldId:'w1',versionId:'v1',locationId:'loc',name:'Fixture'};
  W.shots = [{id:'manchester',shot_code:'1A',location:'Manchester'}];
  workspace.source.world_version_id='v1';
  f.fake.api.mockImplementation(async (url,opts={}) => {
    if(url==='/projects/p1/scenes') return {scenes:[{id:'scene',scene_number:34,location:'FIXTURE',project_id:'p1'},{id:'elsewhere',scene_number:1,location:'Manchester'},{id:'removed',scene_number:35,location:'Fixture',status:'removed'}]};
    if(url==='/shots') return {shots:[{id:'new',scene_id:'scene',shot_code:'34A'}]};
    return {card:{description:'New location shot'}};
  });
  expect(workspace.pickerHtml()).toContain('Create shot');
  expect(workspace.footerHtml()).toContain('Create shot');
  const before = JSON.stringify(W.blocking);
  await workspace.previzCreateTarget();
  expect(workspace.creation.scenes.map(s=>s.id)).toEqual(['scene']);
  await workspace.previzCreateShot('scene');
  expect(W.targetId).toBe('new');
  expect(workspace.target().location).toBe('Fixture');
  expect(JSON.stringify(W.blocking)).toBe(before);
  const writes=f.fake.api.mock.calls.filter(([,o])=>o?.method&&o.method!=='GET');
  expect(writes.map(([u])=>u)).toEqual(['/shots','/shots/new/world','/shots/new/previs']);
  expect(JSON.parse(writes[0][1].body).scene_id).toBe('scene');
  expect(JSON.parse(writes[1][1].body).world_version_id).toBe('v1');
  expect(workspace.footerHtml()).not.toMatch(/onclick="previzCapture\(\)" disabled/);
  expect(writes.some(([u])=>u.includes('manchester'))).toBe(false);
});
test('returning to the same location refreshes its audit without resetting camera, target, timeline or collapsed rooms', async () => {
  W.scout = {worldId:'w1',versionId:'v1',name:'Fixture'};
  W.scoutable = [{world:W.world,version:W.version,name:'Fixture'}];
  W.targetId=W.shotId='a'; W.keys=[{t:10,camera:{position:[2,1.7,4]}}]; W.moves=[{kind:'pan'}];
  workspace.collapsedSets.w1=true; workspace.source=null;
  const before=JSON.stringify({blocking:W.blocking,target:W.targetId,keys:W.keys,moves:W.moves});
  f.fake.api.mockResolvedValue({world_version_id:'v1',world_sha256:'fresh',rooms:[]});
  await E.worldScoutSelect('w1');
  expect(JSON.stringify({blocking:W.blocking,target:W.targetId,keys:W.keys,moves:W.moves})).toBe(before);
  expect(workspace.source.world_sha256).toBe('fresh');
  expect(workspace.collapsedSets.w1).toBe(true);
});
test('A to B to A selections keep only the latest compact set audit without fetching dense geometry', async () => {
  const a={world:W.world,version:W.version,name:'Fixture'}, b={world:{id:'wB'},version:{id:'B',scale_factor:1},name:'Other'};
  W.scoutable=[a,b]; W.scout={worldId:'w1',versionId:'v1',name:'Fixture'};
  W.viewMode='look';
  const audits=[];
  f.fake.api.mockImplementation(path=>path.startsWith('/previz-workspace/world/')
    ? new Promise(resolve=>audits.push({path,resolve})) : Promise.resolve({enabled:false,splats:[]}));
  const old=workspace.opened(), toB=E.worldScoutSelect('wB'), toA=E.worldScoutSelect('w1');
  audits[0].resolve({world_version_id:'v1',world_sha256:'stale A',rooms:[]});
  audits[1].resolve({world_version_id:'B',world_sha256:'B',rooms:[]});
  await old; await toB;
  expect(workspace.source).toBeNull();
  audits[2].resolve({world_version_id:'v1',world_sha256:'current A',rooms:[],geometry:{vertices:[],triangles:[],bounds:{min:[0,0,0],max:[4,3,4]},representation:'bounds-only'}});
  await toA;
  expect(workspace.source.world_sha256).toBe('current A');
  expect(audits.every(x=>x.path.startsWith('/previz-workspace/world/'))).toBe(true);
  expect(W.geometry.representation).toBe('bounds-only');
});

test('explicit geometry views fetch once at the existing quality budget and reject a late A to B to A geometry result', async () => {
  W.selectionRevision=1; W.geometryFor='v1'; W.geometry={representation:'bounds-only'};
  const requests=[]; f.fake.api.mockImplementation(path=>new Promise(resolve=>requests.push({path,resolve})));
  const old=E.worldEnsureGeometry(), duplicate=E.worldEnsureGeometry();
  expect(requests).toHaveLength(1); expect(requests[0].path).toContain('budget=250000');
  W.selectionRevision=3;
  const current=E.worldEnsureGeometry();
  requests[0].resolve({vertices:[[9,9,9]],triangles:[]});
  expect(await old).toBeNull(); expect(await duplicate).toBeNull();
  const geometry={vertices:[[0,0,0]],triangles:[],bounds:{min:[0,0,0],max:[4,3,4]}};
  requests[1].resolve(geometry); await current;
  expect(W.geometry).toBe(geometry);
  await E.worldEnsureGeometry(); expect(requests).toHaveLength(2);
});

test('a newer Look selection wins over a pending Plan geometry response', async () => {
  W.selectionRevision=1; W.geometryFor='v1'; W.geometry={representation:'bounds-only'}; W.viewMode='look';
  let release; f.fake.api.mockImplementation(path=>path.includes('/geometry?') ? new Promise(resolve=>release=resolve) : Promise.resolve({}));
  const plan=E.worldSetViewMode('plan');
  await E.worldSetViewMode('look');
  release({vertices:[[0,0,0]],triangles:[]}); await plan;
  expect(W.viewMode).toBe('look');
});

test('failed collider reads can be retried without reopening the location', async () => {
  W.selectionRevision=1; W.geometryFor='v1'; W.geometry={representation:'bounds-only'};
  const geometry={vertices:[[0,0,0]],triangles:[]};
  f.fake.api.mockRejectedValueOnce(new Error('temporary read failure')).mockResolvedValueOnce(geometry);
  expect(await E.worldEnsureGeometry()).toBeNull();
  expect(await E.worldEnsureGeometry()).toBe(geometry);
  expect(f.fake.api).toHaveBeenCalledTimes(2);
});

test('repeated render requests share a frame and synchronous capture cancels the queued render', () => {
  window.THREE=THREE; W.viewMode='look'; W.keys=[]; W.moves=[]; W.blocking.lighting={};
  document.body.innerHTML='<canvas id="pvGLMesh"></canvas>';
  let next=0; const frames=new Map();
  vi.spyOn(window,'requestAnimationFrame').mockImplementation(fn=>{frames.set(++next,fn);return next;});
  vi.spyOn(window,'cancelAnimationFrame').mockImplementation(id=>frames.delete(id));
  const render=vi.fn(); Object.assign(E.MESHLOOK,{renderer:{render,shadowMap:{}},camera:new THREE.PerspectiveCamera(),scene:new THREE.Scene(),rigSig:null});
  for(let n=0;n<8;n++) E.worldMeshRequestRender();
  expect(frames.size).toBe(1); expect(render).not.toHaveBeenCalled();
  E.worldMeshRenderOnce();
  expect(render).toHaveBeenCalledTimes(1); expect(frames.size).toBe(0);
});
test('a location without a matching scene offers screenplay authoring and never assigns an existing Manchester shot', async () => {
  W.world.location_id='bromwich'; W.scout.name='Bromwich'; W.shots=[{id:'old',shot_code:'1A',location:'Manchester'}];
  f.fake.api.mockResolvedValue({scenes:[{id:'manchester',location:'Manchester'}]});
  await workspace.previzCreateTarget();
  expect(workspace.creation.scenes).toEqual([]);
  expect(f.fake.showModalHtml.mock.calls.at(-1)[1]).toContain('Add scene in screenplay');
  await workspace.previzCreateShot('manchester');
  expect(f.fake.api).toHaveBeenCalledTimes(1);
  expect(W.shots[0].id).toBe('old');
  expect(workspace.targets()).toEqual([]);
});

test('a reopened pinned shot uses its actual location name rather than the imported version label', () => {
  W.scout=null; W.world.name='Fixture detailed — WIP11';
  W.scoutable=[{world:W.world,version:W.version,name:'Fixture'}];
  expect(workspace.targets().map(s=>s.id)).toEqual(['a','b']);
  expect(workspace.scope().name).toBe('Fixture');
});
test('late A to B to A create-dialog reads cannot install stale location scenes', async () => {
  let release;
  f.fake.api.mockImplementation(()=>new Promise(resolve=>release=resolve));
  const opening=workspace.previzCreateTarget();
  W.version.id='B';workspace.changed();W.version.id='v1';workspace.changed();
  release({scenes:[{id:'old',location:'Fixture'}]});await opening;
  expect(workspace.creation).toBeNull();
  expect(f.fake.showModalHtml).not.toHaveBeenCalled();
});
test('create-shot retries finish the same new shot, and changed versions cannot retarget it', async () => {
  let pins=0;
  W.scout={worldId:'w1',versionId:'v1',name:'Fixture'};
  f.fake.api.mockImplementation(async(path,opts)=>{
    if(path.endsWith('/scenes'))return {scenes:[{id:'scene',scene_number:34,location:'Fixture'}]};
    if(path==='/shots')return {shots:[{id:'new',shot_code:'34A'}]};
    if(path.endsWith('/world') && ++pins===1)throw new Error('temporary pin failure');
    return {card:{description:'Created'}};
  });
  await workspace.previzCreateTarget();await workspace.previzCreateShot('scene');
  expect(workspace.creation.shot.id).toBe('new');
  await workspace.previzCreateShot('scene');
  expect(f.fake.api.mock.calls.filter(([p])=>p==='/shots')).toHaveLength(1);
  expect(W.targetId).toBe('new');
  workspace.creation={scope:workspace.scope(),revision:workspace.revision,scenes:[{id:'scene'}]};
  W.version.id='changed';
  const calls=f.fake.api.mock.calls.length;await workspace.previzCreateShot('scene');
  expect(f.fake.api.mock.calls).toHaveLength(calls);
});
test('created location target can save a reviewed draft and request Blender using the same frozen snapshot', async () => {
  W.scout={worldId:'w1',versionId:'v1',name:'Fixture'};W.shots=[];
  const snapshot={target:{id:'new',shot_code:'34A',location:'Fixture'},world:{version_id:'v1',name:'Fixture',version:1},camera:{lens_mm:35},frame:{width:160,height:90,playhead_ms:0},subjects:[],lights:{mode:'native'}};
  f.fake.api.mockImplementation(async(path)=>{
    if(path.endsWith('/scenes'))return {scenes:[{id:'scene',scene_number:34,location:'Fixture'}]};
    if(path==='/shots')return {shots:[{id:'new',shot_code:'34A'}]};
    if(path==='/previz-workspace/capture')return {snapshot_id:'snap',snapshot,review:{id:'draft-review',fingerprint:'d'}};
    if(path.endsWith('/approve'))return {id:path.includes('draft-review')?'draft-review':'render-review',fingerprint:'f'};
    if(path.endsWith('/draft'))return {snapshot_id:'snap',shot_id:'new',version:1};
    if(path.endsWith('/render-review'))return {snapshot_id:'snap',snapshot,review:{id:'render-review',fingerprint:'r'}};
    if(path.endsWith('/render'))return {shot_id:'new',version:2};
    return {card:{description:'Created'}};
  });
  await workspace.previzCreateTarget();await workspace.previzCreateShot('scene');
  vi.spyOn(workspace,'capture').mockResolvedValue({shot_id:W.targetId,world_version_id:W.version.id});
  await workspace.previzCapture();expect(workspace.pending.snapshot.target.id).toBe('new');
  await workspace.previzSend();expect(workspace.draft.snapshot_id).toBe('snap');
  expect(workspace.footerHtml()).not.toMatch(/onclick="previzRenderReview\(\)" disabled/);
  await workspace.previzRenderReview();await workspace.previzSend();
  expect(f.fake.api.mock.calls.some(([p])=>p==='/previz-workspace/reviews/render-review/render')).toBe(true);
  expect(f.fake.api.mock.calls.some(([p])=>p==='/previz-workspace/snap/render-review')).toBe(true);
});

test('a partial create remains bound to its first scene and frozen camera even after opening the dialog again', async () => {
  W.shots=[]; const camera=JSON.parse(JSON.stringify(W.blocking.blocking.camera)); let pins=0;
  f.fake.api.mockImplementation(async(path)=>{
    if(path.endsWith('/scenes'))return {scenes:[{id:'s1',scene_number:1,location:'Fixture'},{id:'s2',scene_number:2,location:'Fixture'}]};
    if(path==='/shots')return {shots:[{id:'new1',shot_code:'1A',scene_id:'s1'}]};
    if(path.endsWith('/world') && ++pins===1)throw Error('temporary pin failure');
    return {card:{description:'Created'}};
  });
  await workspace.previzCreateTarget(); await workspace.previzCreateShot('s1');
  const calls=f.fake.api.mock.calls.length;
  await workspace.previzCreateShot('s2');
  expect(f.fake.api.mock.calls).toHaveLength(calls);
  W.blocking.blocking.camera.position[0]=77; workspace.changed();
  const currentCamera=JSON.stringify(W.blocking.blocking.camera);
  await workspace.previzCreateTarget();
  expect(workspace.creation.shot.id).toBe('new1');
  expect(f.fake.showModalHtml.mock.calls.at(-1)[1]).toContain('Finish saving shot');
  await workspace.previzCreateShot('s1');
  expect(f.fake.api.mock.calls.filter(([p])=>p==='/shots')).toHaveLength(1);
  const write=f.fake.api.mock.calls.find(([p,options])=>p==='/shots/new1/previs' && options.method==='PUT');
  expect(JSON.parse(write[1].body).camera.position).toEqual(camera.position);
  expect(W.shots.find(s=>s.id==='new1').scene_id).toBe('s1');
  expect(W.shots.find(s=>s.id==='new1').shot_code).toBe('1A');
  expect(W.targetId).not.toBe('new1');
  expect(JSON.stringify(W.blocking.blocking.camera)).toBe(currentCamera);
  expect(workspace.creation).toBeNull();
});
test('leaving Previz and switching sets retains an in-flight creation and finishes its known shot without retargeting', async () => {
  let release, pins=0; W.shots=[];
  f.fake.api.mockImplementation(async(path)=>{
    if(path.endsWith('/scenes'))return {scenes:[{id:'s1',scene_number:1,location:'Fixture'}]};
    if(path==='/shots')return new Promise(resolve=>release=resolve);
    if(path.endsWith('/world') && ++pins===1)throw Error('temporary pin failure');
    if(path.endsWith('/source'))return {world_version_id:'v2',mesh:{url:'v2.glb'},rooms:[],geometry:{representation:'bounds-only',bounds:{min:[0,0,0],max:[1,1,1]}}};
    return {};
  });
  await workspace.previzCreateTarget();
  const close=workspace.bind(E), pending=workspace.previzCreateShot('s1'), creation=workspace.creation;
  close(); expect(workspace.creation).toBe(creation);
  W.scoutable=[{world:{id:'w2',name:'Elsewhere'},version:{id:'v2',version:1},name:'Elsewhere'}];
  await E.worldScoutSelect('w2'); expect(workspace.creation).toBe(creation);
  release({shots:[{id:'new1',shot_code:'1A',scene_id:'s1'}]}); await pending;
  await workspace.previzCreateTarget(); expect(workspace.creation.shot.id).toBe('new1');
  const camera=JSON.stringify(W.blocking);
  await workspace.previzCreateShot('s1');
  expect(f.fake.api.mock.calls.filter(([p])=>p==='/shots')).toHaveLength(1);
  for(const [path,options] of f.fake.api.mock.calls.filter(([p])=>p==='/shots/new1/world')) expect(JSON.parse(options.body).world_version_id).toBe('v1');
  expect(W.version.id).toBe('v2'); expect(W.targetId).not.toBe('new1');
  expect(JSON.stringify(W.blocking)).toBe(camera); expect(workspace.creation).toBeNull();
});
test('starting another shot explicitly leaves an unfinished known shot in its original scene', async () => {
  let sceneReads=0; W.shots=[];
  f.fake.api.mockImplementation(async(path)=>{
    if(path.endsWith('/scenes'))return {scenes:[++sceneReads===1 ? {id:'s1',scene_number:1,location:'Fixture'} : {id:'s2',scene_number:2,location:'Elsewhere'}]};
    if(path==='/shots')return {shots:[{id:'new1',shot_code:'1A',scene_id:'s1'}]};
    if(path.endsWith('/world'))throw Error('original set unavailable');
    return {};
  });
  await workspace.previzCreateTarget(); await workspace.previzCreateShot('s1');
  const original=workspace.creation;
  expect(f.fake.showModalHtml.mock.calls.at(-1)[1]).toContain('leaves 1A in its original scene');
  W.world={id:'w2',name:'Elsewhere'}; W.scout={name:'Elsewhere'}; W.version={id:'v2'};
  W.blocking.blocking.camera.position[0]=22; workspace.changed();
  await workspace.previzStartNewShot();
  expect(workspace.creation).not.toBe(original); expect(workspace.creation.scope.versionId).toBe('v2');
  expect(workspace.creation.blocking.camera.position[0]).toBe(22);
  expect(W.shots).toEqual([expect.objectContaining({id:'new1',shot_code:'1A',scene_id:'s1',location:'Fixture'})]);
  expect(f.fake.api.mock.calls.filter(([p])=>p==='/shots')).toHaveLength(1);
  expect(f.fake.api.mock.calls.filter(([,options])=>options?.method==='DELETE')).toHaveLength(0);
});
test('real location targets preserve current camera, subjects and lights', async () => {
  const before = JSON.stringify(W.blocking);
  await workspace.previzTarget('a');
  await workspace.previzTarget('b');
  expect(JSON.stringify(W.blocking)).toBe(before);
  expect(workspace.targets().map(x => x.id)).toEqual(['a', 'b']);
  await workspace.previzTarget('other');
  expect(W.targetId).toBe('b');
  expect(workspace.briefHtml()).toContain('Canonical /shots/b');
});
test('numeric GLB room IDs work through string click handlers and preserve camera orientation', () => {
  window.THREE = THREE;
  const position = new THREE.Vector3(3, 1.72, -1.1),
    quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(.12, .35, -.08, 'YXZ')),
    matrix = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1,1,1));
  workspace.source.rooms = [{id:10128,name:'Foyer',matrix:matrix.toArray(),verticalFovDegrees:57}];
  workspace.previzRoom('10128');
  expect(workspace.room.name).toBe('Foyer');
  expect(W.blocking.blocking.camera.position).toEqual(position.toArray());
  const actual = new THREE.PerspectiveCamera();
  E.worldAimCamera(actual, E.worldCameraPose(W.blocking.blocking.camera), THREE);
  expect(Math.abs(actual.quaternion.dot(quaternion))).toBeCloseTo(1,10);
  expect(W.lens).toBeCloseTo(18.66/(2*Math.tan(57*Math.PI/360)),10);
});
test('Camera step and Explore load stay local and preserve placement', async () => {
  workspace.source = {world_version_id:'v1',world_sha256:'hash',mesh:{url:'fixture.glb'}};
  W.targetId = W.shotId = 'a';
  const subjects = W.blocking.blocking.subjects,
    lighting = W.blocking.lighting;
  await E.worldNudge('truckM', .25);
  expect(W.blocking.blocking.camera.position[0]).toBe(.25);
  expect(f.fake.api).not.toHaveBeenCalled();
  expect(W.blocking.blocking.subjects).toBe(subjects);
  expect(W.blocking.lighting).toBe(lighting);
  E.EXPLORE.accepted = [{
    key: 'A',
    camera: {
      position: [1, 1.68, 4],
      rotation: [0, 0, 0],
      focalMm: 50
    }
  }];
  E.EXPLORE.workspaceRevision = workspace.revision;
  await E.worldExploreLoad('A');
  expect(W.blocking.blocking.camera.position[0]).toBe(1);
  expect(f.fake.api).not.toHaveBeenCalled();
  expect(W.blocking.blocking.subjects).toBe(subjects);
});
test('late approval after target change cancels without sending', async () => {
  let release;
  W.targetId = 'a';
  const p = {
    revision: 0,
    kind: 'draft',
    snapshot: {
      target: {
        id: 'a'
      },
      world: {
        version_id: 'v1'
      }
    },
    review: {
      id: 'review-a',
      fingerprint: 'f'
    }
  };
  workspace.pending = p;
  f.fake.api.mockImplementation(path => path.endsWith('/approve') ? new Promise(resolve => release = resolve) : Promise.resolve({}));
  const sending = workspace.previzSend();
  workspace.revision++;
  W.targetId = 'b';
  release({
    id: 'review-a',
    fingerprint: 'f'
  });
  await sending;
  expect(f.fake.api.mock.calls.map(x => x[0])).toEqual(['/previz-workspace/reviews/review-a/approve', '/previz-workspace/reviews/review-a/cancel']);
});
test.each(['draft', 'render'])('double %s Send shares a request; selecting another target cannot change its frozen destination', async kind => {
  let release;
  W.targetId = 'a';
  const p = {
    revision: 0,
    kind,
    snapshot: {
      target: {
        id: 'a',
        shot_code: '1A'
      },
      world: {
        version_id: 'v1'
      }
    },
    review: {
      id: 'r',
      fingerprint: 'f'
    },
    token: {
      id: 'r',
      fingerprint: 'f'
    }
  };
  workspace.pending = p;
  f.fake.api.mockImplementation(() => new Promise(resolve => release = resolve));
  const one = workspace.previzSend();
  await workspace.previzSend();
  workspace.revision++;
  W.targetId = 'b';
  release({
    shot_id: 'a',
    version: 1,
    kind: 'previz_draft'
  });
  await one;
  expect(f.fake.api).toHaveBeenCalledTimes(1);
  expect(workspace.draft).toBeNull();
  expect(f.status.at(-1)).toContain('1A');
});
test('A to B to A target switches reject delayed briefs and Current shot frames', async () => {
  const before = JSON.stringify(W.blocking), requests = [];
  f.fake.api.mockImplementation(path => new Promise(resolve => requests.push({path,resolve})));
  const oldA = workspace.previzTarget('a'), b = workspace.previzTarget('b'), newA = workspace.previzTarget('a');
  for (const request of requests.slice(0,4)) request.resolve(request.path.endsWith('/previs') ? {keyframe:{src:'stale.png'}} : {card:{action:'stale'}});
  await oldA; await b;
  expect(W.targetCard).toBeNull(); expect(W.targetFrame).toBeNull();
  requests[4].resolve({card:{action:'latest A brief'}});
  requests[5].resolve({keyframe:{src:'latest-A.png'}});
  await newA;
  expect(workspace.briefHtml()).toContain('latest A brief');
  expect(E.worldBoardSrc()).toContain('latest-A.png');
  expect(JSON.stringify(W.blocking)).toBe(before);
});
test('A to B to A set audits reject delayed old A and B responses', async () => {
  const requests = [];
  f.fake.api.mockImplementation(path => new Promise(resolve => requests.push({path,resolve})));
  const oldA = workspace.opened();
  W.version.id = 'B'; const b = workspace.opened();
  W.version.id = 'v1'; const newA = workspace.opened();
  requests[0].resolve({world_version_id:'v1',world_sha256:'old',rooms:[]});
  requests[1].resolve({world_version_id:'B',world_sha256:'B',rooms:[]});
  await oldA; await b; expect(workspace.source).toBeNull();
  requests[2].resolve({world_version_id:'v1',world_sha256:'new',rooms:[]});
  await newA; expect(workspace.source.world_sha256).toBe('new');
});
test('closing and returning to Previz cancels its review and rejects late approval', async () => {
  let release;
  W.targetId = 'a';
  const close = workspace.bind(E);
  workspace.pending = {revision:workspace.revision,kind:'render',snapshot:{target:{id:'a'},world:{version_id:'v1'}},review:{id:'closing',fingerprint:'f'}};
  f.fake.api.mockImplementation(path => path.endsWith('/approve') ? new Promise(resolve => release = resolve) : Promise.resolve({}));
  const sending = workspace.previzSend();
  close(); workspace.bind(E);
  release({id:'closing',fingerprint:'f'}); await sending;
  expect(workspace.pending).toBeNull();
  expect(f.fake.api.mock.calls.some(([path]) => path.endsWith('/render'))).toBe(false);
  expect(f.fake.api.mock.calls.filter(([path]) => path.endsWith('/cancel')).length).toBeGreaterThan(0);
});
test('no target blocks capture; changing set during capture cancels pending review', async () => {
  W.targetId = null;
  await expect(workspace.capture()).rejects.toThrow('target');
  let release;
  W.targetId = 'a';
  vi.spyOn(workspace, 'capture').mockResolvedValue({
    shot_id: 'a'
  });
  f.fake.api.mockImplementation(path => path.endsWith('/capture') ? new Promise(resolve => release = resolve) : Promise.resolve({}));
  const pending = workspace.previzCapture();
  await Promise.resolve();
  workspace.revision++;
  release({
    review: {
      id: 'r'
    }
  });
  await pending;
  expect(workspace.pending).toBeNull();
  expect(f.fake.api.mock.calls.at(-1)[0]).toContain('/cancel');
});
test('structural walking preserves holes, slides against walls, and steps onto stair treads', () => {
  const nav = {
    supports: [{
      min: [-2, -.2, -2],
      max: [2, 0, 0]
    }, {
      min: [-2, 0, 0],
      max: [2, .16, .3]
    }, {
      min: [-2, .16, .3],
      max: [2, .32, .6]
    }],
    blockers: [{
      min: [1, 0, -2],
      max: [1.2, 2, 2]
    }]
  };
  expect(nearestSupport(nav, 0, 1, 1)).toBeNull();
  expect(blocked(nav, .9, -1, 0)).toBe(true);
  const step = walkStep(nav, [0, 1.68, -.1], 0, .5, 0);
  expect(step.foot).toBe(.32);
  expect(step.position[2]).toBeCloseTo(.4);
  const wall = walkStep(nav, [0, 1.68, -1], 2, 0, 0);
  expect(wall.position[0]).toBeLessThan(.8);
});
test('Current shot loads the chosen target frame and follows a saved draft without replacing blocking', async () => {
  W.scout = {
    name: 'Fixture'
  };
  const before = JSON.stringify(W.blocking);
  f.fake.api.mockImplementation(async path => path.endsWith('/previs') ? {
    keyframe: {
      src: '/film/storyboards/p1/original.png?v=2'
    }
  } : {
    card: {
      action: 'Canonical action'
    }
  });
  await workspace.previzTarget('a');
  expect(E.worldBoardSrc()).toContain('original.png?v=2');
  expect(JSON.stringify(W.blocking)).toBe(before);
  workspace.pending = {
    revision: workspace.revision,
    kind: 'draft',
    snapshot: {
      target: {
        id: 'a',
        shot_code: '1A'
      },
      world: {
        version_id: 'v1'
      }
    },
    review: {
      id: 'r'
    },
    token: {
      id: 'r'
    }
  };
  f.fake.api.mockResolvedValue({
    url: '/film/storyboards/p1/draft.png',
    version: 3,
    kind: 'previz_draft'
  });
  await workspace.previzSend();
  expect(E.worldBoardSrc()).toContain('draft.png');
  expect(JSON.stringify(W.blocking)).toBe(before);
});
test('capture refuses a loaded previous set even when the target and source audit switched', async () => {
  W.targetId = 'a';
  workspace.source = {
    world_version_id: 'v1',
    world_sha256: 'hash'
  };
  vi.spyOn(E, 'worldViewMode').mockReturnValue('look');
  Object.assign(E.MESHLOOK, {
    root: {},
    camera: {},
    versionId: 'old'
  });
  await expect(workspace.capture()).rejects.toThrow('exact set version');
});
test('capture refuses a same-version mesh loaded at a different calibration from the camera', async () => {
  W.targetId='a';
  workspace.source={world_version_id:'v1',world_sha256:'hash'};
  vi.spyOn(E,'worldViewMode').mockReturnValue('look');
  vi.spyOn(E,'worldCameraPose').mockReturnValue({scale:1});
  Object.assign(E.MESHLOOK,{root:{scale:{x:2,y:2,z:2}},versionId:'v1',worldSha256:'hash',url:'set.glb',camera:{}});
  Object.assign(E.SPLAT,{infoFor:'v1',info:{mesh:{url:'set.glb'}}});
  E.SETEDIT.on=false;W.playing=false;
  await expect(workspace.capture()).rejects.toThrow('calibration and loaded preview differ');
});
test('a same-version set audit survives local target or camera changes without resetting that camera', async () => {
  let release;
  f.fake.api.mockImplementation(() => new Promise(resolve => release = resolve));
  const opened = workspace.opened();
  const camera = W.blocking.blocking.camera;
  workspace.changed();
  W.targetId = 'a';
  release({
    world_version_id: 'v1',
    world_sha256: 'hash',
    rooms: []
  });
  await opened;
  expect(workspace.source.world_version_id).toBe('v1');
  expect(W.blocking.blocking.camera).toBe(camera);
  expect(W.targetId).toBe('a');
});
