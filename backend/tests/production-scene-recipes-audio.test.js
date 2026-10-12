const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

// Set before every backend import: these tests never touch an existing project.
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'production-scene-recipes-'));
process.env.FILM_DATA_DIR = TEST_DIR;
const { db, generateId } = require('../db/database');
const log = console.log;
try { console.log = () => {}; require('../db/schema').ensureSchema(); } finally { console.log = log; }
const pg = require('../lib/production-graph');
const { handleProductionGraph } = require('../routes/production-graph');
const { handleSequences } = require('../routes/sequences');
test.after(() => { db.close(); fs.rmSync(TEST_DIR, { recursive: true, force: true }); });

function route(handler, method, url, body) {
    let result;
    const res = { writeHead(status) { this.status = status; }, end(json) { result = { status: this.status, data: JSON.parse(json) }; } };
    handler({ method, body }, res, url.split('/').filter(Boolean), {});
    assert.ok(result, `No response for ${method} ${url}`);
    return result;
}
function fixture() {
    const project = generateId(), scene = generateId(), scene2 = generateId();
    db.prepare("INSERT INTO film_projects(id, title) VALUES (?, 'Scene geometry')").run(project);
    for (const [id, n] of [[scene, 1], [scene2, 2]]) {
        db.prepare('INSERT INTO film_scenes(id, project_id, scene_number, location) VALUES (?, ?, ?, ?)').run(id, project, n, `Place ${n}`);
    }
    const shots = [0, 1, 2, 3].map(i => {
        const id = generateId();
        db.prepare('INSERT INTO film_shots(id, scene_id, shot_code, sort_order, duration_ms, scene_card_yaml) VALUES (?, ?, ?, ?, 3000, ?)')
            .run(id, i === 3 ? scene2 : scene, i === 3 ? '2A' : `1${String.fromCharCode(65 + i)}`, i, '{}');
        return id;
    });
    const a = generateId(), b = generateId();
    for (const [id, ids] of [[a, [shots[0], shots[1]]], [b, [shots[1], shots[2]]]]) {
        db.prepare('INSERT INTO film_sequences(id, project_id, name, shot_ids) VALUES (?, ?, ?, ?)').run(id, project, id === a ? 'A' : 'B', JSON.stringify(ids));
    }
    return { project, scene, scene2, shots, a, b, base: `/film/projects/${project}/production-graph` };
}
function audio(f, duration = 12000) {
    const id = generateId(), file = path.join(TEST_DIR, `${id}.wav`);
    fs.writeFileSync(file, Buffer.from('immutable original audio'));
    db.prepare('INSERT INTO film_assets(id, project_id, asset_type, file_path, duration_ms, mime_type, version) VALUES (?, ?, ?, ?, ?, ?, 3)')
        .run(id, f.project, 'audio_sfx', file, duration, 'audio/wav');
    return { id, file };
}

test('all projected geometry persists, translates with its scene and survives Arrange/Undo without creative edits',()=>{
 const f=fixture(),asset=generateId(),owner=`shot:${f.shots[0]}`;
 db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version) VALUES(?,?,?,'storyboard',?,1)").run(asset,f.project,f.shots[0],path.join(TEST_DIR,'not-a-live-frame.png'));
 require('../lib/production-recipes').saveDraft(db,f.project,owner,{expected_revision:0,payload:{image:{prompt:'Untouched',reference_images:[{asset_id:asset,reference_role:'character'}]}}});
 const identity=pg.referenceGeometryIdentity({asset_id:asset,reference_role:'character',list:'reference_images'});
 const keys=[`board:${asset}`,`request:${asset}`,`reference:${asset}:0`,`draft:${owner}:image`,`draft:${owner}:video`,`draft-reference:${owner}:image:${identity}-0`];
 const creativeBefore={shots:db.prepare('SELECT * FROM film_shots WHERE scene_id=? ORDER BY id').all(f.scene),assets:db.prepare('SELECT * FROM film_assets WHERE project_id=?').all(f.project),draft:require('../lib/production-recipes').readDraft(db,f.project,owner)};
 const saved=route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:keys.map((key,i)=>({key,x:100+i*25,y:400+i*40,prompt:'MUST NOT BE WRITTEN'}))});assert.equal(saved.status,200);assert.equal(saved.data.saved,6);
 let graph=pg.buildGraph(db,f.project);for(const [i,key] of keys.entries())assert.deepEqual(graph.workspace_geometry.nodes[key],{x:100+i*25,y:400+i*40,pinned:true});
 const group=graph.groups.find(g=>g.members.includes(owner));pg.saveGroupLayout(db,f.project,group.key,{x:1100,y:2200,delta_x:70,delta_y:-30});
 graph=pg.buildGraph(db,f.project);for(const [i,key] of keys.entries())assert.deepEqual(graph.workspace_geometry.nodes[key],{x:170+i*25,y:370+i*40,pinned:true});
 const positions=pg.workspaceLayout(db,f.project),arranged=route(handleProductionGraph,'POST',`${f.base}/arrange`,{});
 assert.equal(route(handleProductionGraph,'POST',`${f.base}/arrange`,{undo:arranged.data.undo,expected_fingerprint:arranged.data.layout_fingerprint}).status,200);assert.deepEqual(pg.workspaceLayout(db,f.project),positions);
 assert.deepEqual({shots:db.prepare('SELECT * FROM film_shots WHERE scene_id=? ORDER BY id').all(f.scene),assets:db.prepare('SELECT * FROM film_assets WHERE project_id=?').all(f.project),draft:require('../lib/production-recipes').readDraft(db,f.project,owner)},creativeBefore);
});

test('geometry rejects other-project, absent and invalid synthetic identities atomically',()=>{
 const f=fixture(),other=fixture(),owner=`shot:${f.shots[0]}`,before=pg.workspaceLayout(db,f.project);
 for(const key of [`shot:${other.shots[0]}`,`draft:shot:${other.shots[0]}:image`,`board:${generateId()}`,`reference:${generateId()}:0`,`draft-reference:${owner}:image:r0000000000000000-0`,`draft:seq:${f.a}:image`]){
  const result=route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key:owner,x:40,y:40},{key,x:100,y:100}]});assert.equal(result.status,400,key);assert.deepEqual(pg.workspaceLayout(db,f.project),before);
 }
});

test('captured review reference order is source identity in geometry keys',()=>{
 const a={captured_reference:{review_id:'R',order:1},list:'reference_images',reference_role:'character'},b={captured_reference:{review_id:'R',order:2},list:'reference_images',reference_role:'character'};
 assert.notEqual(pg.referenceGeometryIdentity(a),pg.referenceGeometryIdentity(b));assert.equal(pg.referenceGeometryIdentity(a),pg.referenceGeometryIdentity({...a,reference_role:'location',order:5}));
});

test('saved reference instance geometry belongs to its draft and stays outside provider capability payloads',()=>{
 const f=fixture(),owner=`shot:${f.shots[0]}`,instance='i'+generateId(),key=`draft-reference:${owner}:image:${instance}`,recipes=require('../lib/production-recipes');
 recipes.saveDraft(db,f.project,owner,{expected_revision:0,payload:{image:{provider:'openai',model:'gpt-image-1',prompt:'Only provider content',reference_images:[]},workspace_reference_ids:{image:{reference_images:[instance]}}}});
 const credentials=require('../lib/providers/credentials'),prior=credentials.getCredential;credentials.getCredential=()=>({apiKey:'mock-only',meta:{}});
 try{const plan=require('../lib/production-draft-request').resolveDraftRequest(db,f.shots[0],{production_draft:{node_key:owner,revision:1}},'image');assert.equal(plan.payload.workspace_reference_ids,undefined);assert.equal(JSON.stringify(plan.payload).includes(instance),false);}finally{credentials.getCredential=prior;}
 recipes.saveDraft(db,f.project,owner,{expected_revision:1,payload:{image:{reference_images:[{asset_id:'explicit-fixture'}]},workspace_reference_ids:{image:{reference_images:[instance]}}}});
 assert.equal(route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:-600,y:1200}]}).status,200);assert.equal(pg.readLayout(db,f.project).get(key).x,-600);
});

test('read-only recorded provenance distinguishes empty, absent and malformed reference manifests',()=>{
 const f=fixture(),lineage=require('../lib/production-lineage');
 for(const references of [undefined,null,{},[]]){
  const id=generateId(),review=generateId(),snapshot={provider:'fixture',model:'fixture',body:{prompt:'Recorded prompt'},...(references===undefined?{}:{references})};
  db.prepare("INSERT INTO film_final_request_reviews(id,fingerprint,snapshot_json,editable_json,provenance_json,state,approved_at) VALUES(?,?,?,?,?,'completed',CURRENT_TIMESTAMP)").run(review,'fixture',JSON.stringify(snapshot),'{}',JSON.stringify({spec:{project_id:f.project}}));
  db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,version,metadata) VALUES(?,?,?,'storyboard',?,1,?)").run(id,f.project,f.shots[0],path.join(TEST_DIR,'unavailable-fixture.png'),JSON.stringify({final_request_review_id:review}));
  const before=db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(review),result=lineage.assetLineage(db,id);assert.equal(result.status,'recorded');assert.equal(result.approved.body.prompt,'Recorded prompt');assert.equal(result.approved.references_known,Array.isArray(references));assert.deepEqual(result.approved.references,Array.isArray(references)?[]:null);assert.deepEqual(db.prepare('SELECT * FROM film_final_request_reviews WHERE id=?').get(review),before);
 }
});

test('synthetic movement uses the same transaction rollback as real scene members',()=>{
 const f=fixture(),key=`draft:shot:${f.shots[0]}:video`,graph=pg.buildGraph(db,f.project),group=graph.groups[0];
 assert.equal(route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:-600,y:-800}]}).status,200);
 const before=pg.workspaceLayout(db,f.project);
 db.exec(`CREATE TEMP TRIGGER deny_projected_move BEFORE INSERT ON production_node_layout WHEN NEW.node_key='${key}' BEGIN SELECT RAISE(ABORT,'projected transaction proof'); END`);
 try{assert.throws(()=>pg.saveGroupLayout(db,f.project,group.key,{x:40,y:60,delta_x:20,delta_y:40}),/projected transaction proof/);}finally{db.exec('DROP TRIGGER deny_projected_move');}
 assert.deepEqual(pg.workspaceLayout(db,f.project),before);
});

test('Tidy all retains projected pins inside collapsed scenes',()=>{
 const f=fixture(),graph=pg.buildGraph(db,f.project),group=graph.groups[0],key=`draft:shot:${f.shots[0]}:video`,other=`draft:shot:${f.shots[3]}:video`;
 assert.equal(route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:-500,y:1800},{key:other,x:2800,y:4000}]}).status,200);
 pg.saveGroupLayout(db,f.project,group.key,{collapsed:true});assert.equal(route(handleProductionGraph,'POST',`${f.base}/tidy`,{all:true}).status,200);
 assert.deepEqual(pg.readLayout(db,f.project).get(key),{x:-500,y:1800,pinned:true});assert.equal(pg.readLayout(db,f.project).has(other),false);
 pg.saveGroupLayout(db,f.project,group.key,{collapsed:false});assert.deepEqual(pg.buildGraph(db,f.project).workspace_geometry.nodes[key],{x:-500,y:1800,pinned:true});
});

test('scene groups contain vertical shot/sequence rows and retain both sequence memberships', () => {
    const f = fixture(), graph = pg.buildGraph(db, f.project);
    assert.deepEqual(graph.groups.map(g => g.scene_id), [f.scene, f.scene2]);
    const group = graph.groups[0], byKey = new Map(graph.nodes.map(n => [n.key, n]));
    assert.equal(graph.groups[1].x, group.x, 'scenes share a left origin');
    assert.ok(graph.groups[1].y >= group.y + group.h + 48, 'the whole next scene is below this scene');
    assert.ok(group.members.includes(`seq:${f.a}`) && group.members.includes(`seq:${f.b}`));
    assert.deepEqual(byKey.get(`seq:${f.b}`).shot_ids, [f.shots[1], f.shots[2]]);
    assert.deepEqual(byKey.get(`shot:${f.shots[1]}`).sequence_ids, [f.a, f.b]);
    assert.equal(graph.edges.filter(e => e.from === `shot:${f.shots[1]}` && e.type === 'image').length, 2);
    const rows = group.rows.map(key => byKey.get(key));
    assert.equal(new Set(rows.map(n => n.x)).size, 1);
    assert.ok(rows.every((n, i) => !i || n.y >= rows[i - 1].y + rows[i - 1].h));
    assert.deepEqual(graph.running_order, f.shots);
});

test('legacy automatic positions are refreshed while pinned nodes and saved scene anchors survive', () => {
    const f = fixture(), original = pg.buildGraph(db, f.project), a = original.nodes[0], b = original.nodes[1];
    route(handleProductionGraph, 'PUT', `${f.base}/layout`, {nodes:[{key:a.key,x:6000,y:8,pinned:false},{key:b.key,x:-100,y:1500}]});
    const fresh = pg.buildGraph(db, f.project);
    assert.notEqual(fresh.nodes.find(n=>n.key===a.key).x,6000);
    assert.equal(fresh.nodes.find(n=>n.key===b.key).x,-100);
    const key=fresh.groups[1].key;
    route(handleProductionGraph,'PUT',`${f.base}/groups/${encodeURIComponent(key)}`,{collapsed:true,w:1200,h:800});
    const saved=db.prepare('SELECT * FROM production_group_layout WHERE project_id=? AND group_key=?').get(f.project,key);
    assert.equal(saved.x,null,'collapse/resize does not pin an automatic scene position');
});

test('Arrange vertically and conflict-checked Undo only change workspace geometry', () => {
    const f=fixture(), before=pg.buildGraph(db,f.project), key=before.nodes[0].key;
    route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:-300,y:2100}]});
    pg.saveGroupLayout(db,f.project,before.groups[0].key,{x:3200,y:100,w:2200,h:1400});
    const snapshot=pg.workspaceLayout(db,f.project), shots=db.prepare('SELECT * FROM film_shots WHERE scene_id IN (?,?) ORDER BY id').all(f.scene,f.scene2);
    const arranged=route(handleProductionGraph,'POST',`${f.base}/arrange`,{});
    assert.equal(arranged.status,200);assert.equal(arranged.data.nodes.some(n=>n.pinned),false);
    assert.equal(arranged.data.groups[0].x,arranged.data.groups[1].x);
    const undo=route(handleProductionGraph,'POST',`${f.base}/arrange`,{undo:arranged.data.undo,expected_fingerprint:arranged.data.layout_fingerprint});
    assert.equal(undo.status,200);assert.deepEqual(pg.workspaceLayout(db,f.project),snapshot);
    assert.deepEqual(db.prepare('SELECT * FROM film_shots WHERE scene_id IN (?,?) ORDER BY id').all(f.scene,f.scene2),shots);
    const again=route(handleProductionGraph,'POST',`${f.base}/arrange`,{});
    route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:100,y:900}]});
    const conflict=route(handleProductionGraph,'POST',`${f.base}/arrange`,{undo:again.data.undo,expected_fingerprint:again.data.layout_fingerprint});
    assert.equal(conflict.status,409);assert.equal(pg.buildGraph(db,f.project).nodes.find(n=>n.key===key).y,900);
});

test('Undo accepts stale workspace rows without recreating deleted creative owners',()=>{
 const f=fixture(),key=`shot:${f.shots[0]}`,orphan=`shot:${generateId()}`;
 route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key,x:-80,y:2000}]});
 db.prepare('INSERT INTO production_node_layout(project_id,node_key,x,y,pinned) VALUES(?,?,?,?,1)').run(f.project,orphan,3600,8);
 const before=pg.workspaceLayout(db,f.project),arranged=route(handleProductionGraph,'POST',`${f.base}/arrange`,{});
 const restored=route(handleProductionGraph,'POST',`${f.base}/arrange`,{undo:arranged.data.undo,expected_fingerprint:arranged.data.layout_fingerprint});
 assert.equal(restored.status,200);assert.deepEqual(pg.workspaceLayout(db,f.project),before);assert.equal(db.prepare('SELECT id FROM film_shots WHERE id=?').get(orphan.slice(5)),undefined);
});

test('scene gesture uses the visible anchor and exact delta when lineage expanded its automatic position',()=>{
 const f=fixture(),graph=pg.buildGraph(db,f.project),group=graph.groups[1],node=graph.nodes.find(n=>n.key===group.rows[0]);
 route(handleProductionGraph,'PUT',`${f.base}/layout`,{nodes:[{key:node.key,x:node.x,y:node.y}]});
 const result=pg.saveGroupLayout(db,f.project,group.key,{x:1400,y:6000,delta_x:30,delta_y:45});
 assert.equal(result.layout_x,1400);assert.equal(result.layout_y,6000);const moved=pg.buildGraph(db,f.project).nodes.find(n=>n.key===node.key);assert.equal(moved.x,node.x+30);assert.equal(moved.y,node.y+45);
});

test('scene moves translate members atomically; resize persists and expands as content grows', () => {
    const f = fixture(), before = pg.buildGraph(db, f.project), group = before.groups[0];
    const out = route(handleProductionGraph, 'PUT', `${f.base}/groups/${encodeURIComponent(group.key)}`, { x: -540, y: 870, w: 1100, h: 1800 });
    assert.equal(out.status, 200);
    let graph = pg.buildGraph(db, f.project), moved = graph.groups[0];
    assert.equal(moved.x, -540); assert.equal(moved.y, 870);
    for (const key of group.members) {
        const a = before.nodes.find(n => n.key === key), b = graph.nodes.find(n => n.key === key);
        assert.equal(b.x - a.x, -540 - group.x); assert.equal(b.y - a.y, 870 - group.y);
    }
    assert.ok(moved.w >= 1100 && moved.h >= 1800);
    const newShot = generateId();
    db.prepare('INSERT INTO film_shots(id, scene_id, shot_code, sort_order, duration_ms, scene_card_yaml) VALUES (?, ?, ?, 9, 3000, ?)')
        .run(newShot, f.scene, '1D', '{}');
    graph = pg.buildGraph(db, f.project); moved = graph.groups[0];
    assert.equal(moved.x, -540); assert.equal(moved.y, 870);
    const node = graph.nodes.find(n => n.id === newShot);
    assert.ok(node.x >= moved.x && node.y >= moved.y);
    route(handleProductionGraph, 'PUT', `${f.base}/layout`, { nodes: [{ key: node.key, x: node.x, y: moved.y + 2200 }] });
    const grown = pg.buildGraph(db, f.project).groups[0];
    assert.ok(grown.h >= 2200 + node.h);
    assert.deepEqual(graph.running_order, [f.shots[0], f.shots[1], f.shots[2], newShot, f.shots[3]]);
    const saved = db.prepare('SELECT * FROM production_group_layout WHERE project_id = ? AND group_key = ?').get(f.project, group.key);
    const invalid = route(handleProductionGraph, 'PUT', `${f.base}/groups/${encodeURIComponent(group.key)}`, { x: null });
    assert.equal(invalid.status, 400);
    assert.deepEqual(db.prepare('SELECT * FROM production_group_layout WHERE project_id = ? AND group_key = ?').get(f.project, group.key), saved);
});

test('draft revision conflicts preserve edits and immutable asset metadata', () => {
    const f = fixture(), source = audio(f), key = `shot:${f.shots[0]}`, url = `${f.base}/nodes/${encodeURIComponent(key)}/draft`;
    const first = route(handleProductionGraph, 'PUT', url, { expected_revision: 0, source_asset_id: source.id, payload: { prompt: 'A new draft', audio_references: [{ asset_id: source.id, role: 'reference_audio' }] } });
    assert.equal(first.status, 200); assert.equal(first.data.draft.revision, 1);
    const stale = route(handleProductionGraph, 'PUT', url, { expected_revision: 0, payload: { prompt: 'Late stale text' } });
    assert.equal(stale.status, 409);
    assert.equal(route(handleProductionGraph, 'GET', url).data.draft.payload.prompt, 'A new draft');
    assert.equal(db.prepare('SELECT metadata FROM film_assets WHERE id = ?').get(source.id).metadata, '{}');
    assert.deepEqual(route(handleProductionGraph, 'GET', url).data.audio_tracks, []);
    const recipes = require('../lib/production-recipes');
    const next = recipes.saveDraft(db, f.project, key, { expected_revision: 1, payload: { prompt: 'Updated by another inspector' } });
    assert.equal(next.revision, 2);
    assert.throws(() => recipes.saveDraft(db, f.project, key, { expected_revision: 1, payload: {} }), { status: 409 });
});

test('timeline audio stores exact placement/full source and never becomes conditioning', () => {
    const f = fixture(), source = audio(f), key = `shot:${f.shots[0]}`, url = `${f.base}/nodes/${encodeURIComponent(key)}/audio`;
    const input = { asset_id: source.id, offset_ms: -250, source_in_ms: 1500, duration_ms: 4000, gain_db: -4.5, muted: true, order: 0 };
    const result = route(handleProductionGraph, 'PUT', url, { tracks: [input] });
    assert.equal(result.status, 200);
    const track = result.data.tracks[0];
    for (const [field, value] of Object.entries(input)) assert.equal(track[field], value);
    assert.equal(track.relationship, 'timeline_audio');
    assert.equal(track.source.path, source.file); assert.equal(track.source.duration_ms, 12000);
    assert.equal(track.source.sha256, crypto.createHash('sha256').update(fs.readFileSync(source.file)).digest('hex'));
    const originalBytes = fs.readFileSync(source.file);
    db.prepare('UPDATE film_assets SET file_path = ?, duration_ms = 2 WHERE id = ?').run('/changed/current-selection.wav', source.id);
    const again = route(handleProductionGraph, 'PUT', url, { tracks: [{ ...input, id: track.id, gain_db: 2, muted: false }] });
    assert.equal(again.status, 200); assert.equal(again.data.tracks[0].source.path, source.file);
    assert.deepEqual(fs.readFileSync(source.file), originalBytes);
    const graph = pg.buildGraph(db, f.project), node = graph.nodes.find(n => n.key === key);
    assert.equal(node.audio_tracks.length, 1); assert.equal(node.draft, null);
    assert.ok(graph.edges.some(e => e.to === key && e.relationship === 'timeline_audio' && e.label === 'Timeline audio'));
});

test('audio source/owner/project/range validation is atomic for the replacement list', () => {
    const f = fixture(), other = fixture(), source = audio(f), foreign = audio(other), recipes = require('../lib/production-recipes');
    const key = `seq:${f.a}`, valid = { asset_id: source.id, offset_ms: 700, source_in_ms: 2000, duration_ms: 3000, gain_db: 0, muted: false, order: 0 };
    recipes.saveAudioTracks(db, f.project, key, [valid]);
    const before = recipes.readAudioTracks(db, f.project, key);
    assert.throws(() => recipes.saveAudioTracks(db, f.project, key, [valid, { ...valid, asset_id: foreign.id }]), { status: 400 });
    assert.deepEqual(recipes.readAudioTracks(db, f.project, key), before);
    assert.throws(() => recipes.saveAudioTracks(db, f.project, key, [{ ...valid, source_in_ms: 11000 }]), { status: 400 });
    assert.throws(() => recipes.saveAudioTracks(db, f.project, `seq:${other.a}`, [valid]), { status: 404 });
    assert.throws(() => recipes.saveAudioTracks(db, f.project, key, [{ ...valid, muted: 'false' }]), { status: 400 });
    const defaultDuration = recipes.saveAudioTracks(db, f.project, key, [{ ...valid, duration_ms: undefined }]);
    assert.equal(defaultDuration[0].duration_ms, 10000);
    assert.deepEqual(recipes.saveAudioTracks(db, f.project, key, []), []);
});

test('sequence creation/edit shares shots by default; only explicit move removes another membership', () => {
    const f = fixture();
    const created = route(handleSequences, 'POST', `/film/projects/${f.project}/sequences`, { name: 'Shared third version', shot_ids: [f.shots[1]] });
    assert.equal(created.status, 201);
    assert.deepEqual(JSON.parse(db.prepare('SELECT shot_ids FROM film_sequences WHERE id = ?').get(f.a).shot_ids), [f.shots[0], f.shots[1]]);
    const id = created.data.sequence.id;
    assert.equal(route(handleSequences, 'PUT', `/film/sequences/${id}`, { shot_ids: [f.shots[0], f.shots[1]] }).status, 200);
    const moved = route(handleSequences, 'PUT', `/film/sequences/${id}`, { shot_ids: [f.shots[1]], move: true });
    assert.equal(moved.status, 200);
    assert.deepEqual(JSON.parse(db.prepare('SELECT shot_ids FROM film_sequences WHERE id = ?').get(f.a).shot_ids), [f.shots[0]]);
    assert.deepEqual(JSON.parse(db.prepare('SELECT shot_ids FROM film_sequences WHERE id = ?').get(f.b).shot_ids), [f.shots[2]]);
});

test('a cross-scene sequence keeps its real edges; free geometry never changes narrative order', () => {
    const f = fixture();
    db.prepare('UPDATE film_sequences SET shot_ids = ? WHERE id = ?').run(JSON.stringify([f.shots[0], f.shots[3]]), f.a);
    const graph = pg.buildGraph(db, f.project);
    assert.ok(graph.groups[0].members.includes(`seq:${f.a}`));
    assert.ok(!graph.groups[0].members.includes(`shot:${f.shots[3]}`));
    assert.ok(graph.groups[1].members.includes(`shot:${f.shots[3]}`));
    assert.ok(graph.edges.some(e => e.from === `shot:${f.shots[3]}` && e.to === `seq:${f.a}`));
    pg.saveGroupLayout(db, f.project, graph.groups[1].key, { x: -1000, y: -1000, w: 200, h: 100 });
    const next = pg.buildGraph(db, f.project);
    assert.deepEqual(next.running_order, f.shots);
    assert.deepEqual(next.nodes.find(n => n.key === `seq:${f.a}`).shot_ids, [f.shots[0], f.shots[3]]);
    assert.ok(next.groups[1].w > 200 && next.groups[1].h > 100, 'content must remain inside a manually resized minimum');
});

test('collapse retains member positions; failed group gesture rolls back all its node writes', () => {
    const f = fixture(), graph = pg.buildGraph(db, f.project), group = graph.groups[0];
    pg.saveGroupLayout(db, f.project, group.key, { x: 200, y: 400 });
    const before = db.prepare('SELECT node_key, x, y, pinned FROM production_node_layout WHERE project_id = ? ORDER BY node_key').all(f.project);
    const collapsed = pg.saveGroupLayout(db, f.project, group.key, { collapsed: true });
    assert.equal(collapsed.collapsed, true);
    assert.deepEqual(db.prepare('SELECT node_key, x, y, pinned FROM production_node_layout WHERE project_id = ? ORDER BY node_key').all(f.project), before);
    pg.saveGroupLayout(db, f.project, group.key, { collapsed: false });
    const stored = db.prepare('SELECT * FROM production_group_layout WHERE project_id = ?').all(f.project);
    db.exec(`CREATE TEMP TRIGGER deny_test_group_node BEFORE INSERT ON production_node_layout
        WHEN NEW.node_key = 'seq:${f.a}' BEGIN SELECT RAISE(ABORT, 'disposable transaction proof'); END`);
    try { assert.throws(() => pg.saveGroupLayout(db, f.project, group.key, { x: 900, y: 1200 }), /disposable transaction proof/); }
    finally { db.exec('DROP TRIGGER deny_test_group_node'); }
    assert.deepEqual(db.prepare('SELECT node_key, x, y, pinned FROM production_node_layout WHERE project_id = ? ORDER BY node_key').all(f.project), before);
    assert.deepEqual(db.prepare('SELECT * FROM production_group_layout WHERE project_id = ?').all(f.project), stored);
});

test('offline or deleted audio keeps its captured source identity and edit range', () => {
    const f = fixture(), source = audio(f), recipes = require('../lib/production-recipes'), key = `shot:${f.shots[0]}`;
    const first = recipes.saveAudioTracks(db, f.project, key, [{ asset_id: source.id, source_in_ms: 2000, duration_ms: 3000 }])[0];
    fs.unlinkSync(source.file);
    db.prepare('DELETE FROM film_assets WHERE id = ?').run(source.id);
    const read = recipes.readAudioTracks(db, f.project, key)[0];
    assert.equal(read.source.offline, true); assert.equal(read.source.sha256, first.source.sha256);
    assert.equal(read.asset_id, source.id); assert.equal(read.source.path, source.file);
    const edited = recipes.saveAudioTracks(db, f.project, key, [{ id: first.id, asset_id: source.id, source_in_ms: 2000, duration_ms: 3000, offset_ms: 80 }])[0];
    assert.equal(edited.source.offline, true); assert.equal(edited.offset_ms, 80);
    assert.equal(pg.buildGraph(db, f.project).nodes.find(n => n.key === key).audio_tracks.length, 1);
});

test('resize and collapse do not shift untouched rows when a dragged node expands scene bounds left/up', () => {
    const f = fixture(), first = pg.buildGraph(db, f.project), group = first.groups[0];
    const key = `shot:${f.shots[1]}`;
    route(handleProductionGraph, 'PUT', `${f.base}/layout`, { nodes: [{ key, x: -700, y: -420 }] });
    const expanded = pg.buildGraph(db, f.project), positions = expanded.nodes.filter(n => group.members.includes(n.key)).map(n => [n.key, n.x, n.y]);
    assert.ok(expanded.groups[0].x < group.x);
    pg.saveGroupLayout(db, f.project, group.key, { w: 1600, h: 2000 });
    pg.saveGroupLayout(db, f.project, group.key, { collapsed: true });
    pg.saveGroupLayout(db, f.project, group.key, { collapsed: false });
    const after = pg.buildGraph(db, f.project);
    assert.deepEqual(after.nodes.filter(n => group.members.includes(n.key)).map(n => [n.key, n.x, n.y]), positions);
    pg.saveGroupLayout(db, f.project, group.key, { x: 160, y: 230 });
    const moved = pg.buildGraph(db, f.project);
    assert.equal(moved.groups[0].x, 160); assert.equal(moved.groups[0].y, 230);
});

test('an unassigned sequence retains its unresolved links as movable visible members', () => {
    const f = fixture(), id = generateId();
    db.prepare('INSERT INTO film_sequences(id, project_id, name, shot_ids, start_frame_ref) VALUES (?, ?, ?, ?, ?)')
        .run(id, f.project, 'Next version', '[]', JSON.stringify({ sequence_id: f.a, mode: 'shot_image' }));
    const graph = pg.buildGraph(db, f.project), group = graph.groups.find(g => g.key === 'unassigned-sequences');
    assert.ok(group.members.includes(`seq:${id}`)); assert.ok(group.members.includes(`link:${id}:start`));
    const link = graph.nodes.find(n => n.key === `link:${id}:start`);
    assert.equal(link.ok, false);
    assert.ok(link.x >= group.x && link.y >= group.y);
});
