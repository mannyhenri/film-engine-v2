require('../lib/manual-generation').allowSendForTests(); // exercises the dormant API send path
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'final-subject-plans-'));
process.env.FILM_DATA_DIR = temp;
process.env.MUAPI_API_KEY = 'mock-only';
process.env.RUNWAY_API_KEY = 'mock-only';
const { db } = require('../db/database');
require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential = () => ({ apiKey: 'mock-only', meta: {} });
const contract = require('../lib/final-request-review');
const { prepareSubjectRequests } = require('../lib/final-subject-request-plans');
const project = crypto.randomUUID(), character = crypto.randomUUID(), location = crypto.randomUUID(), prop = crypto.randomUUID();
db.prepare('INSERT INTO film_projects (id,title,provider_config,target_resolution) VALUES (?,?,?,?)').run(project, 'Fixture', JSON.stringify({ image: 'muapi', image_model: 'nano-banana-2' }), '2K');
db.prepare('INSERT INTO film_characters (id,project_id,name,description) VALUES (?,?,?,?)').run(character, project, 'Person', 'Red coat');
db.prepare('INSERT INTO film_locations (id,project_id,name,description) VALUES (?,?,?,?)').run(location, project, 'Room', 'Blue walls');
db.prepare('INSERT INTO film_props (id,project_id,name,description) VALUES (?,?,?,?)').run(prop, project, 'Cup', 'Green cup');
function response() { return { writeHead(status) { this.status = status; }, end(value) { this.value = JSON.parse(value); } }; }
async function approved(path, body) {
    const prepared = await prepareSubjectRequests({ path, body });
    const reviews = [], tokens = [];
    for (const item of prepared.items) {
        const review = await contract.store().preview(item);
        reviews.push(review);
        tokens.push(contract.store().approve(review.id, { fingerprint: review.fingerprint, human_confirmed: true, cost_unknown_ack: true }));
    }
    return { prepared, reviews, tokens };
}
test('character batch resolves distinct per-view requests and each actual route submission matches its reviewed adapter body', async () => {
    const route = `/film/characters/${character}/refsheet/generate`;
    const body = { views: ['front', 'side'], model: 'nano-banana-2', provider: 'muapi' };
    const plan = await approved(route, body);
    assert.equal(plan.reviews.length, 2);
    assert.notEqual(plan.prepared.items[0].payload.prompt, plan.prepared.items[1].payload.prompt);
    const original = global.fetch, sent = [];
    global.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: false, status: 400, text: async () => 'mock transport stops submission', json: async () => ({error: 'mock transport stops submission'}) }; };
    try {
        await contract.runWithApprovals(plan.tokens, () => require('../routes/characters').handleCharacters({ method: 'POST', body }, response(), ['film', 'characters', character, 'refsheet', 'generate']));
        assert.equal(sent.length, 2);
        sent.forEach((request, index) => { assert.equal(request.url, plan.reviews[index].snapshot.endpoint); assert.deepEqual(request.body, plan.reviews[index].snapshot.body); });
    } finally { global.fetch = original; }
});
test('location and prop one-off actual route transports use exactly each approved resolved body', async () => {
    for (const [kind, id] of [['locations', location], ['props', prop]]) {
        const route = `/film/${kind}/${id}/image/generate`, body = { model: 'nano-banana-2' };
        const plan = await approved(route, body), original = global.fetch, sent = [];
        global.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: false, status: 400, text: async () => 'mock transport stops submission', json: async () => ({error: 'mock transport stops submission'}) }; };
        try {
            await contract.runWithApprovals(plan.tokens, () => require('../routes/locations').handleLocations({ method: 'POST', body }, response(), ['film', kind, id, 'image', 'generate']));
            assert.equal(sent.length, 1);
            assert.equal(sent[0].url, plan.reviews[0].snapshot.endpoint);
            assert.deepEqual(sent[0].body, plan.reviews[0].snapshot.body);
        } finally { global.fetch = original; }
    }
});
test('canonical plate generate and refine actual transports match reviewed prompts, options and source bytes', async () => {
    const plate = require('../lib/reference-plates');
    const image = require('../lib/png-raster').encode({ width: 2, height: 2, pixels: Buffer.alloc(16, 255) });
    for (const [kind, plural, id] of [['location', 'locations', location], ['prop', 'props', prop]]) {
        const subject = db.prepare(`SELECT * FROM film_${plural} WHERE id=?`).get(id);
        const fileName = plate.plateFileName(kind, subject.name, '');
        const file = path.join(temp, fileName); fs.writeFileSync(file, image);
        const spec = plate.PLATE_KINDS[kind];
        db.prepare(`INSERT INTO film_assets (id,project_id,${spec.fkColumn},asset_type,file_path,file_name) VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(), project, id, spec.assetType, file, fileName);
        for (const mode of ['generate', 'refine']) {
            const route = `/film/${plural}/${id}/plate/${mode}`, body = { model: 'nano-banana-2', provider: 'muapi', instruction: 'Make the cup brighter' };
            const plan = await approved(route, body), original = global.fetch, sent = [], uploads = [];
            global.fetch = async (url, init) => {
                if (String(url).endsWith('/upload_file')) {
                    uploads.push(Buffer.from(await init.body.get('file').arrayBuffer()));
                    return { ok: true, status: 200, json: async () => ({ url: 'https://mock.invalid/reference.png' }) };
                }
                sent.push({ url: String(url), body: JSON.parse(init.body) });
                return { ok: false, status: 400, text: async () => 'mock transport stops submission', json: async () => ({error: 'mock transport stops submission'}) };
            };
            try {
                await contract.runWithApprovals(plan.tokens, () => require('../routes/locations').handleLocations({ method: 'POST', body }, response(), ['film', plural, id, 'plate', mode]));
                assert.equal(sent.length, 1, `${kind}/${mode}`);
                assert.equal(sent[0].url, plan.reviews[0].snapshot.endpoint);
                function map(value) { if (Array.isArray(value)) return value.map(map); if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,v])=>[key,map(v)])); return typeof value === 'string' && value.startsWith('data:') ? 'https://mock.invalid/reference.png' : value; }
                assert.deepEqual(sent[0].body, map(plan.reviews[0].snapshot.body));
                if (mode === 'refine') { assert.equal(uploads.length, 1); assert.deepEqual(uploads[0], image); assert.equal(plan.reviews[0].snapshot.references[0].sha256, crypto.createHash('sha256').update(image).digest('hex')); }
            } finally { global.fetch = original; }
        }
    }
});
test('compass reviews every static side; a refused first transport sends no later side or altered fallback', async () => {
    const route = `/film/locations/${location}/plate/compass`, body = {};
    const plan = await approved(route, body);
    assert(plan.prepared.items.length > 1);
    assert.equal(new Set(plan.prepared.items.map(item=>item.payload.prompt)).size, plan.prepared.items.length);
    const original=global.fetch,sent=[];
    global.fetch=async(url,init)=>{sent.push({url:String(url),body:JSON.parse(init.body)});return{ok:false,status:400,text:async()=> 'moderation refusal requires fresh review',json:async()=>({error:'moderation refusal requires fresh review'})};};
    try {
        await contract.runWithApprovals(plan.tokens,()=>require('../routes/locations').handleLocations({method:'POST',body},response(),['film','locations',location,'plate','compass']));
        assert.equal(sent.length,1);
        assert.deepEqual(sent[0].body,plan.reviews[0].snapshot.body);
        assert.equal(sent[0].url,plan.reviews[0].snapshot.endpoint);
    } finally {global.fetch=original;}
});
test('character orbit actual video transport matches approved video body', async () => {
    const existing=JSON.parse(db.prepare('SELECT provider_config FROM film_projects WHERE id=?').get(project).provider_config);
    db.prepare('UPDATE film_projects SET provider_config=? WHERE id=?').run(JSON.stringify({...existing,video:'runway'}),project);
    const route=`/film/characters/${character}/refsheet/orbit`,body={model:'gen4_turbo',seconds:5};
    const plan=await approved(route,body),original=global.fetch,sent=[];
    assert.equal(plan.reviews[0].editable.payload.audio,false);
    assert.equal(plan.reviews[0].editable.payload.generate_audio,false);
    assert.equal(plan.reviews[0].snapshot.body.audio,undefined);
    global.fetch=async(url,init)=>{sent.push({url:String(url),body:JSON.parse(init.body)});return{ok:false,status:400,text:async()=> 'mock stops after request',json:async()=>({error:'mock stops after request'})};};
    try {
        const res=response();
        await contract.runWithApprovals(plan.tokens,()=>require('../routes/characters').handleCharacters({method:'POST',body},res,['film','characters',character,'refsheet','orbit']));
        assert.equal(sent.length,1,JSON.stringify(res.value));assert.equal(sent[0].url,plan.reviews[0].snapshot.endpoint);assert.deepEqual(sent[0].body,plan.reviews[0].snapshot.body);
    } finally {global.fetch=original;}
});
test('identical character-view payloads select distinct approvals and both paid transports match', async () => {
    const route=`/film/characters/${character}/refsheet/generate`,body={views:['front','side'],model:'nano-banana-2',provider:'muapi',prompt_override:'Same visible edited prompt for both views'};
    const plan=await approved(route,body);
    assert.deepEqual(plan.reviews[0].snapshot.body,plan.reviews[1].snapshot.body);
    const original=global.fetch,sent=[];
    const image=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,255)});
    global.fetch=async(url,init={})=>{
        if(init.method==='POST'){sent.push({url:String(url),body:JSON.parse(init.body)});return{ok:true,status:200,json:async()=>({request_id:`mock-identical-${sent.length}`})};}
        if(String(url).includes('predictions/'))return{ok:true,status:200,json:async()=>({status:'completed',outputs:['https://mock.invalid/finished.png']})};
        return{ok:true,status:200,arrayBuffer:async()=>image};
    };
    try{
        await contract.runWithApprovals(plan.tokens,()=>require('../routes/characters').handleCharacters({method:'POST',body},response(),['film','characters',character,'refsheet','generate']));
        assert.equal(sent.length,2);
        for(let index=0;index<2;index++){assert.deepEqual(sent[index].body,plan.reviews[index].snapshot.body);assert.equal(contract.store().get(plan.tokens[index].id).state,'completed');}
    }finally{global.fetch=original;}
});
test('source edit after refinement assembly but before claim invalidates approval with zero provider requests', async () => {
    const route=`/film/props/${prop}/plate/refine`,body={model:'nano-banana-2',provider:'muapi',instruction:'Brighter cup'};
    const plan=await approved(route,body);
    const built=require('../routes/locations').buildSubjectRefineRequest('prop',prop,body);
    assert(plan.reviews[0].editable.provenance.source_paths.includes(built.existing.file_path));
    const previous=fs.readFileSync(built.existing.file_path),changed=Buffer.from(previous);changed[changed.length-1]^=1;fs.writeFileSync(built.existing.file_path,changed);
    const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not submit');};
    try{
        await assert.rejects(contract.runWithApprovals(plan.tokens,async()=>{const opts=require('../lib/final-subject-request-plans').subjectExecutionOptions('prop',prop);return built.provider.generate('image',built.payload,opts);}),/changed/);
        assert.equal(calls,0);
    }finally{global.fetch=original;fs.writeFileSync(built.existing.file_path,previous);}
});
test('look instruction edit after assembly invalidates subject approval before upload or paid POST', async () => {
    const route=`/film/props/${prop}/plate/generate`,body={model:'nano-banana-2',provider:'muapi'};
    const plan=await approved(route,body);
    const built=require('../routes/locations').buildSubjectGenerationRequest('prop',prop,body);
    const payload=require('../lib/reference-plates').buildPlateGenerationPlan(built.args).payload;
    const previous=db.prepare('SELECT style_preset FROM film_projects WHERE id=?').get(project).style_preset;
    db.prepare('UPDATE film_projects SET style_preset=? WHERE id=?').run('Changed approved look guidance',project);
    const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not submit');};
    try{
        await assert.rejects(contract.runWithApprovals(plan.tokens,async()=>{const opts=require('../lib/final-subject-request-plans').subjectExecutionOptions('prop',prop);return built.provider.generate('image',payload,opts);}),/changed/);
        assert.equal(calls,0);
    }finally{global.fetch=original;db.prepare('UPDATE film_projects SET style_preset=? WHERE id=?').run(previous,project);}
});
test('semantic subject edit after assembly invalidates approval before provider submission', async () => {
    const route=`/film/props/${prop}/plate/generate`,body={model:'nano-banana-2',provider:'muapi'};
    const plan=await approved(route,body);
    const built=require('../routes/locations').buildSubjectGenerationRequest('prop',prop,body);
    const payload=require('../lib/reference-plates').buildPlateGenerationPlan(built.args).payload;
    const previous=db.prepare('SELECT description FROM film_props WHERE id=?').get(prop).description;
    db.prepare('UPDATE film_props SET description=? WHERE id=?').run('Changed subject identity after approval',prop);
    const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not submit');};
    try{
        await assert.rejects(contract.runWithApprovals(plan.tokens,async()=>{const opts=require('../lib/final-subject-request-plans').subjectExecutionOptions('prop',prop);return built.provider.generate('image',payload,opts);}),/changed/);
        assert.equal(calls,0);
    }finally{global.fetch=original;db.prepare('UPDATE film_props SET description=? WHERE id=?').run(previous,prop);}
});
test.after(() => { db.close(); fs.rmSync(temp, { recursive: true, force: true }); });
