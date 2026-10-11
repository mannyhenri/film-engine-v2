const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
const Database=require('../node_modules/better-sqlite3');
const {readCards,writeCard,scenesOf,reconcile,hash}=require('../lib/screenplay-cards');
const fountain='INT. HALL - NIGHT #1#\n\nFirst action.\n\nVAN\nHi.\n\nINT. HALL - NIGHT #2#\n\nSecond action.\n\n.BACK TO SCENE #3#\n\nReturn action.\n';
function fixture(){const db=new Database(':memory:');db.exec('CREATE TABLE film_projects(id TEXT PRIMARY KEY); CREATE TABLE film_scripts(id TEXT PRIMARY KEY, project_id TEXT, version INTEGER, fountain_content TEXT);');db.exec(fs.readFileSync(require('path').join(__dirname,'../db/migrations/129_screenplay_index_cards.sql'),'utf8'));db.prepare('INSERT INTO film_projects VALUES(?)').run('p');db.prepare('INSERT INTO film_scripts VALUES(?,?,?,?)').run('s','p',1,fountain);return db;}
function edit(db,data,i,fields){return writeCard(db,'p',{id:data.cards[i].id,version:data.version,script_hash:data.script_hash,revision:data.cards[i].revision,...fields});}
test('all screenplay spans have independent persisted cards; summary writes preserve notes and script bytes',()=>{
 const db=fixture();let data=readCards(db,'p');assert.equal(data.cards.length,3);assert.equal(data.cards[2].heading,'BACK TO SCENE');assert.notEqual(data.cards[0].id,data.cards[1].id);
 data=edit(db,data,0,{notes:'User work'});data=edit(db,data,0,{summary:'The first scene changes things.'});
 const reload=readCards(db,'p');assert.equal(reload.cards[0].notes,'User work');assert.equal(reload.cards[0].summary,'The first scene changes things.');assert.equal(reload.cards[1].summary,'');assert.equal(db.prepare('SELECT fountain_content FROM film_scripts').get().fountain_content,fountain);db.close();
});
test('stale script and concurrent metadata saves are rejected; notes-only edits do not refresh summaries',()=>{
 const db=fixture();let data=readCards(db,'p');const first=data;data=edit(db,data,2,{summary:'Returned scene.'});assert.throws(()=>edit(db,first,2,{summary:'Overwrite'}),/edited elsewhere/);
 db.prepare('UPDATE film_scripts SET fountain_content=?').run(fountain.replace('Return action.','Return revised action.'));
 assert.throws(()=>edit(db,data,0,{notes:'Wrong draft'}),/Screenplay changed/);let fresh=readCards(db,'p');assert.equal(fresh.cards[2].id,data.cards[2].id);assert.equal(fresh.cards[2].stale,true);
 fresh=edit(db,fresh,2,{notes:'Review later'});assert.equal(fresh.cards[2].stale,true);db.close();
});
test('reordering repeated headings matches full text; unique heading edits retain stale summary identity',()=>{
 const before=scenesOf(fountain).map((s,i)=>({...s,id:'id'+i}));const after=[before[1],before[0],before[2]];const matched=reconcile(before,after);assert.deepEqual(matched.map(c=>c.id),['id1','id0','id2']);
 const edited=scenesOf(fountain.replace('Return action.','New action.'));assert.equal(reconcile(before,edited)[2].id,'id2');
});
test('ambiguous changed repeated headings do not steal old summaries or notes',()=>{
 const before=scenesOf(fountain).map((s,i)=>({...s,id:'id'+i}));const changed=scenesOf(fountain.replace('First action.','Unknown first.').replace('Second action.','Unknown second.'));
 const matched=reconcile(before,changed);assert.ok(!['id0','id1'].includes(matched[0].id));assert.ok(!['id0','id1'].includes(matched[1].id));
});
test('renumbering and whitespace separators preserve identity; exact duplicates get distinct IDs',()=>{
 const before=scenesOf(fountain).map((s,i)=>({...s,id:'id'+i}));const renumbered=scenesOf(fountain.replace('#1#','#10#'));assert.equal(renumbered[0].text_hash,before[0].text_hash);
 const duplicate=scenesOf('INT. A - DAY\n\nSame\n\nINT. A - DAY\n\nSame\n');const cards=reconcile([],duplicate);assert.notEqual(cards[0].id,cards[1].id);
});
test('other project and historical version cannot accidentally select current card',()=>{
 const db=fixture();const data=readCards(db,'p');db.prepare('INSERT INTO film_scripts VALUES(?,?,?,?)').run('s2','p',2,'INT. DIFFERENT - DAY\n\nOther.');const latest=readCards(db,'p');assert.equal(latest.version,2);assert.equal(readCards(db,'p',1).cards[0].id,data.cards[0].id);assert.throws(()=>edit(db,latest,0,{summary:200}),/must be text/);db.close();
});
// Exercise actual UI save/open functions with a DOM whose screenplay throws if
// touched. This catches a regression back to the old destructive card editor.
const spa=fs.readFileSync(require('path').join(__dirname,'../../src/index.html'),'utf8');
function section(start,end){return spa.slice(spa.indexOf(start),spa.indexOf(end,spa.indexOf(start)));}
test('UI cancel/reopen and repeated saves use metadata only, retain multiline notes, and reload persisted values',async()=>{
 const db=fixture();const fields={};const doc={getElementById:id=>{if(id==='screenplayEditor')throw new Error('Screenplay must not be touched');return fields[id]||(fields[id]={value:'',textContent:'',disabled:false});}};
 const ctx=vm.createContext({document:doc,state:{currentProject:{id:'p'}},showModal(){},closeModal(){},setStatus(){},paintReviewCards(){},api:async(path,opts)=>{assert.equal(opts.refresh,false);return writeCard(db,'p',JSON.parse(opts.body));}});
 vm.runInContext('let screenplayCardsResponse,editingReviewCard;'+section('    function openIndexCard(', '    /**\n     * The text of a block')+section('    async function saveIndexCard(', '    function reviewCardsPrintHTML('),ctx);
 ctx.loaded=readCards(db,'p');vm.runInContext('screenplayCardsResponse=loaded; openIndexCard(0)',ctx);fields.sceneCardSynopsis.value='Cancelled text';vm.runInContext('openIndexCard(0)',ctx);assert.equal(fields.sceneCardSynopsis.value,'');
 fields.sceneCardSynopsis.value='Saved summary';fields.sceneCardNotes.value='Note one\nNote two';await vm.runInContext('saveIndexCard()',ctx);vm.runInContext('openIndexCard(0)',ctx);assert.equal(fields.sceneCardSynopsis.value,'Saved summary');fields.sceneCardSynopsis.value='Repeated edit';await vm.runInContext('saveIndexCard()',ctx);assert.equal(readCards(db,'p').cards[0].notes,'Note one\nNote two');assert.equal(db.prepare('SELECT fountain_content FROM film_scripts').get().fountain_content,fountain);db.close();
});
test('print HTML escapes script-closing text and uses four slots with readable continuation',()=>{
 const ctx=vm.createContext({esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))});vm.runInContext(section('    function reviewCardsPrintHTML(', '    function printIndexCards('),ctx);ctx.data={version:1,cards:[{number:'1',heading:'Test',summary:'</script><script>bad()</script>',notes:''}]};const html=vm.runInContext("reviewCardsPrintHTML(data,'Test')",ctx);assert.ok(!html.includes('</script><script>bad()'));assert.ok(html.includes('repeat(2,minmax(0,1fr))'));assert.ok(html.includes('12pt/1.35'));assert.ok(html.includes('remaining.slice(cut)')); const embedded=html.match(/<script>([\s\S]*?)<\/script>/)[1]; assert.doesNotThrow(()=>new vm.Script(embedded));
});
