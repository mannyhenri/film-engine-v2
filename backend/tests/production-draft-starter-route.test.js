'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fe-starter-route-'));
process.env.FILM_DATA_DIR = temp;
const { db } = require('../db/database'); require('../db/schema').ensureSchema();
const { handleProductionGraph } = require('../routes/production-graph');
const drafts = require('../lib/production-draft-request');
const priorStarter = drafts.starterDraft;
const project = crypto.randomUUID(), scene = crypto.randomUUID(), shot = crypto.randomUUID();
db.prepare('INSERT INTO film_projects(id,title) VALUES(?,?)').run(project, 'Starter dispatch');
db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene, project);
db.prepare("INSERT INTO film_shots(id,scene_id,shot_code,scene_card_yaml) VALUES(?,?,?,'{}')").run(shot, scene, '1A');
async function request({method='GET',key=`shot:${shot}`,kind='image'}={}) {
    let response; const res={writeHead(status){this.status=status;},end(value){response={status:this.status,body:JSON.parse(value)};}};
    await handleProductionGraph({method},res,['film','projects',project,'production-graph','nodes',encodeURIComponent(key),'draft','starter'],{kind});
    return response;
}
test('starter route awaits free composition and writes no draft or review', async () => {
    let calls=0;
    drafts.starterDraft=async (database,pid,key,kind)=>{await Promise.resolve();calls++;assert.equal(database,db);assert.equal(pid,project);assert.equal(key,`shot:${shot}`);assert.equal(kind,'video');return {recipe:{prompt:'complete',reference_images:[]},ready:true,unresolved:[],warnings:[]};};
    const before=db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n;
    const result=await request({kind:'video'});
    assert.equal(result.status,200);assert.equal(result.body.recipe.prompt,'complete');assert.equal(calls,1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM production_node_drafts').get().n,0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM film_final_request_reviews').get().n,before);
});
test('starter rejects mutation methods and invalid recipe kinds before composition', async () => {
    drafts.starterDraft=async()=>{throw new Error('Invalid input reached the composer');};
    assert.equal((await request({method:'PUT'})).status,405);
    assert.equal((await request({kind:'voice'})).status,400);
});
test('starter refuses nodes outside the named project', async () => {
    drafts.starterDraft=async()=>{throw new Error('Unknown node reached the composer');};
    assert.equal((await request({key:`shot:${crypto.randomUUID()}`})).status,404);
});
test.after(()=>{drafts.starterDraft=priorStarter;db.close();fs.rmSync(temp,{recursive:true,force:true});});
