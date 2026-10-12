'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'fe-activation-tests-'));process.env.FILM_DATA_DIR=temp;
const {db}=require('../db/database');require('../db/schema').ensureSchema();
const activation=require('../lib/storyboard-activation'),storage=require('../lib/file-storage');
const png=value=>require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,value)});
const old=png(60),chosen=png(160),next=png(230);
function fixture(mismatch=true) {
    const project=crypto.randomUUID(),scene=crypto.randomUUID(),shot=crypto.randomUUID();
    db.prepare('INSERT INTO film_projects (id,title) VALUES (?,?)').run(project,'Activation fixture');
    db.prepare('INSERT INTO film_scenes (id,project_id,scene_number) VALUES (?,?,1)').run(scene,project);
    db.prepare("INSERT INTO film_shots (id,scene_id,shot_code,scene_card_yaml,duration_ms,current_frame_version) VALUES (?,?,?,'{\"dialogue\":[\"keep\"]}',5000,?)").run(shot,scene,'1A',mismatch?5:4);
    const live=storage.getFilePath(project,'storyboards','1A.png');fs.mkdirSync(path.dirname(live),{recursive:true});fs.writeFileSync(live,old);
    const prior=crypto.randomUUID(),selected=crypto.randomUUID(),selectedFile=storage.getFilePath(project,'storyboards',`chatgpt_${selected}.png`);
    db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,4)").run(prior,project,shot,live,'1A.png');
    if(mismatch) {fs.writeFileSync(selectedFile,chosen);db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,5)").run(selected,project,shot,selectedFile,path.basename(selectedFile));}
    return {project,scene,shot,live,prior,selected,selectedFile};
}
function rows(f){return db.prepare("SELECT * FROM film_assets WHERE shot_id=? ORDER BY id").all(f.shot);}
function shot(f){return db.prepare('SELECT * FROM film_shots WHERE id=?').get(f.shot);}
function restore(f,version=5,body={}) {
    let status,result;
    require('../routes/storyboard').handleStoryboard({method:'POST',body},{writeHead(s){status=s;},end(s){result=JSON.parse(s);}},['film','shots',f.shot,'frames',String(version),'restore']);
    return {status,result};
}
test('actual 1A reproduction: selected v5 / live v4 reconciles via same-selected restore, preserving both original versions',()=>{
    const f=fixture(),before=shot(f);
    assert.equal(activation.activationEvidence(db,f.shot).live_matches_selected,false);
    const r=restore(f);assert.equal(r.status,200);assert.equal(r.result.changed,true);
    assert.equal(activation.activationEvidence(db,f.shot).live_matches_selected,true);
    assert.equal(activation.activationEvidence(db,f.shot).implementation_sha256,crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../lib/storyboard-activation'))).digest('hex'));
    assert.deepEqual(fs.readFileSync(f.live),chosen);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
    const archived=db.prepare('SELECT * FROM film_assets WHERE id=?').get(f.prior);assert.match(archived.file_path,/1A_v4\.png$/);assert.deepEqual(fs.readFileSync(archived.file_path),old);
    assert.equal(rows(f).length,2);assert.deepEqual(shot(f),before);assert.equal(restore(f).result.changed,false);
    assert.equal(restore(f,4).status,200);assert.deepEqual(fs.readFileSync(f.live),old);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
    assert.equal(restore(f,5).status,200);assert.deepEqual(fs.readFileSync(f.live),chosen);assert.deepEqual(fs.readFileSync(archived.file_path),old);
});
test('archive-only history preservation remains compatible with existing outer generation transactions',()=>{
    const f=fixture(),before=shot(f);
    db.transaction(()=>require('../routes/storyboard').archiveExistingFrame(f.project,f.shot,'1A'))();
    assert.deepEqual(shot(f),before);assert.deepEqual(fs.readFileSync(f.live),old);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
    assert.deepEqual(fs.readFileSync(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(f.prior).file_path),old);
});
test('ordinary imports activate immutable new versions, preserve live owner despite wrong pointer, and leave card timing/text unchanged',()=>{
    const f=fixture(),before=shot(f),media=require('../lib/media-imports');
    const out=media.importMedia('storyboard-image',{shotId:f.shot,bytes:next,mime:'image/png'});
    assert.equal(out.version,6);assert.deepEqual(fs.readFileSync(f.live),next);assert.deepEqual(fs.readFileSync(out.file_path),next);
    const archived=db.prepare('SELECT * FROM film_assets WHERE id=?').get(f.prior);assert.deepEqual(fs.readFileSync(archived.file_path),old);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
    assert.deepEqual({...shot(f),current_frame_version:before.current_frame_version},before);
    const second=media.importMedia('storyboard-image',{shotId:f.shot,versioned:true,bytes:chosen,mime:'image/png'});assert.equal(second.version,7);
    assert.deepEqual(fs.readFileSync(out.file_path),next);assert.deepEqual(fs.readFileSync(f.live),chosen);assert.equal(rows(f).length,4);
});
test('SQL failure after live rename rolls back file and ledger together; ordinary retry then succeeds',()=>{
    const f=fixture(),before=rows(f),beforeShot=shot(f);
    db.exec(`CREATE TRIGGER activation_failure BEFORE UPDATE OF current_frame_version ON film_shots WHEN NEW.id='${f.shot}' BEGIN SELECT RAISE(ABORT,'fixture SQL failure'); END;`);
    assert.throws(()=>require('../lib/media-imports').importMedia('storyboard-image',{shotId:f.shot,bytes:next,mime:'image/png'}),/fixture SQL failure/);
    assert.deepEqual(rows(f),before);assert.deepEqual(shot(f),beforeShot);assert.deepEqual(fs.readFileSync(f.live),old);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
    assert.equal(fs.readdirSync(path.dirname(f.live)).filter(name=>/import_|activation-/.test(name)).length,0);
    db.exec('DROP TRIGGER activation_failure');assert.equal(restore(f).status,200);
});
test('failed atomic live rename leaves no partial image, archive or pointer change and supports retry',()=>{
    const f=fixture(),before=rows(f),rename=fs.renameSync;
    fs.renameSync=(from,to)=>{if(to===f.live)throw new Error('fixture rename failure');return rename(from,to);};
    let r;try {r=restore(f);}finally {fs.renameSync=rename;}
    assert.equal(r.status,500);assert.deepEqual(fs.readFileSync(f.live),old);assert.deepEqual(rows(f),before);
    assert.equal(restore(f).status,200);assert.deepEqual(fs.readFileSync(f.live),chosen);
});
test('stale live/selection guards, missing sources, board locks and overwritten legacy aliases fail without mutation',()=>{
    const f=fixture(),before=rows(f);
    assert.equal(restore(f,5,{expected_live_sha256:'stale'}).status,409);
    assert.equal(restore(f,5,{expected_selected_asset_id:'different'}).status,409);
    db.prepare('UPDATE film_projects SET board_locked_at=CURRENT_TIMESTAMP WHERE id=?').run(f.project);
    assert.equal(restore(f).status,423);db.prepare('UPDATE film_projects SET board_locked_at=NULL WHERE id=?').run(f.project);
    fs.unlinkSync(f.selectedFile);assert.equal(restore(f).status,409);fs.writeFileSync(f.selectedFile,chosen);
    const alias=crypto.randomUUID();db.prepare("INSERT INTO film_assets (id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES (?,?,?,'storyboard',?,?,1)").run(alias,f.project,f.shot,f.live,'1A.png');
    assert.equal(restore(f,1).status,409);db.prepare('DELETE FROM film_assets WHERE id=?').run(alias);
    assert.deepEqual(rows(f),before);assert.deepEqual(fs.readFileSync(f.live),old);
});
test('archive collisions preserve existing bytes and unowned live images are recoverable',()=>{
    const f=fixture(),collision=path.join(path.dirname(f.live),'versions','1A_v4.png');fs.mkdirSync(path.dirname(collision),{recursive:true});fs.writeFileSync(collision,next);
    assert.equal(restore(f).status,200);assert.deepEqual(fs.readFileSync(collision),next);
    assert.deepEqual(fs.readFileSync(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(f.prior).file_path),old);
    const g=fixture();db.prepare('DELETE FROM film_assets WHERE id=?').run(g.prior);assert.equal(restore(g).status,200);
    const saved=fs.readdirSync(path.join(path.dirname(g.live),'versions')).find(name=>name.startsWith('1A_live_'));
    assert.deepEqual(fs.readFileSync(path.join(path.dirname(g.live),'versions',saved)),old);
});
test('a crash after live rename but before SQL commit recovers from the durable journal before retry',()=>{
    const f=fixture(),before=rows(f);
    const code=`const fs=require('fs');const {db}=require('./backend/db/database');const a=require('./backend/lib/storyboard-activation');const rename=fs.renameSync;fs.renameSync=(from,to)=>{rename(from,to);if(to===${JSON.stringify(f.live)})process.exit(77);};a.withStoryboardMutation(db,${JSON.stringify(f.shot)},files=>a.activateAsset(db,${JSON.stringify(f.shot)},${JSON.stringify(f.selected)},files));`;
    const child=spawnSync(process.execPath,['-e',code],{cwd:path.join(__dirname,'../..'),env:{...process.env,FILM_DATA_DIR:temp},encoding:'utf8'});
    assert.equal(child.status,77,child.stderr);assert.deepEqual(rows(f),before);assert.deepEqual(fs.readFileSync(f.live),chosen);
    assert.ok(fs.existsSync(path.join(path.dirname(f.live),`.activation-${f.shot}.json`)));
    assert.equal(restore(f).status,200);assert.deepEqual(fs.readFileSync(f.live),chosen);
    assert.deepEqual(fs.readFileSync(db.prepare('SELECT file_path FROM film_assets WHERE id=?').get(f.prior).file_path),old);
    assert.equal(fs.existsSync(path.join(path.dirname(f.live),`.activation-${f.shot}.json`)),false);
});
test('external changes during rollback are retained and reported rather than overwritten',()=>{
    const f=fixture(),journal=path.join(path.dirname(f.live),`.activation-${f.shot}.json`);
    assert.throws(()=>activation.withStoryboardMutation(db,f.shot,files=>{
        activation.activateAsset(db,f.shot,f.selected,files);fs.writeFileSync(f.live,next);throw new Error('fixture failure');
    }),/Recovery required.*changed/);
    assert.deepEqual(fs.readFileSync(f.live),next);assert.ok(fs.existsSync(journal));
    assert.equal(restore(f).status,409);assert.deepEqual(fs.readFileSync(f.live),next);
});
test('an external edit during final journal persistence fails before SQL commit and retains recovery evidence',()=>{
    const f=fixture(),before=rows(f),beforeShot=shot(f),journal=path.join(path.dirname(f.live),`.activation-${f.shot}.json`),rename=fs.renameSync;
    let injected=false;
    fs.renameSync=(from,to)=>{
        rename(from,to);
        if(to===journal && JSON.parse(fs.readFileSync(journal,'utf8')).afterDatabase && !injected){injected=true;fs.writeFileSync(f.live,next);}
    };
    let r;try {r=restore(f);}finally {fs.renameSync=rename;}
    assert.equal(injected,true);assert.equal(r.status,409);assert.match(r.result.error,/changed before activation commit/);
    assert.deepEqual(rows(f),before);assert.deepEqual(shot(f),beforeShot);assert.deepEqual(fs.readFileSync(f.live),next);assert.ok(fs.existsSync(journal));
    assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);assert.deepEqual(fs.readFileSync(path.join(path.dirname(f.live),'versions','1A_v4.png')),old);
});
test('a non-PNG selected legacy asset is refused before archival or live activation',()=>{
    const f=fixture(),before=rows(f),jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==','base64');
    require('../lib/media-imports').validateBytes({kind:'image',mimes:['image/jpeg']},'image/jpeg',jpeg);fs.writeFileSync(f.selectedFile,jpeg);
    const r=restore(f);assert.equal(r.status,400);assert.match(r.result.error,/re-export.*PNG/);
    assert.deepEqual(rows(f),before);assert.deepEqual(fs.readFileSync(f.live),old);assert.equal(fs.existsSync(path.join(path.dirname(f.live),'versions')),false);
});
test('an external chosen-source edit during final persistence is retained and all activation writes roll back',()=>{
    const f=fixture(),before=rows(f),beforeShot=shot(f),journal=path.join(path.dirname(f.live),`.activation-${f.shot}.json`),rename=fs.renameSync;
    let injected=false;
    fs.renameSync=(from,to)=>{
        rename(from,to);
        if(to===journal && JSON.parse(fs.readFileSync(journal,'utf8')).afterDatabase && !injected){injected=true;fs.writeFileSync(f.selectedFile,next);}
    };
    let r;try {r=restore(f);}finally {fs.renameSync=rename;}
    assert.equal(injected,true);assert.equal(r.status,409);assert.match(r.result.error,/source changed before activation commit/);
    assert.deepEqual(rows(f),before);assert.deepEqual(shot(f),beforeShot);assert.deepEqual(fs.readFileSync(f.live),old);assert.deepEqual(fs.readFileSync(f.selectedFile),next);
    assert.equal(fs.existsSync(journal),false);assert.equal(fs.existsSync(path.join(path.dirname(f.live),'versions','1A_v4.png')),false);
});
test('an external edit just before the live write cannot be adopted as the replacement baseline',()=>{
    const f=fixture(),before=rows(f),beforeShot=shot(f),read=fs.readFileSync;
    let injected=false;
    fs.readFileSync=(file,...args)=>{
        const archive=path.join(path.dirname(f.live),'versions','1A_v4.png');
        if(file===f.live && fs.existsSync(archive) && !injected && new Error().stack.includes('Object.write')) {
            injected=true;fs.writeFileSync(f.live,next);
        }
        return read(file,...args);
    };
    let r;try {r=restore(f);}finally {fs.readFileSync=read;}
    assert.equal(injected,true);assert.equal(r.status,409);assert.match(r.result.error,/changed before its replacement/);
    assert.deepEqual(rows(f),before);assert.deepEqual(shot(f),beforeShot);assert.deepEqual(fs.readFileSync(f.live),next);assert.deepEqual(fs.readFileSync(f.selectedFile),chosen);
});
test.after(()=>{db.close();fs.rmSync(temp,{recursive:true,force:true});});
