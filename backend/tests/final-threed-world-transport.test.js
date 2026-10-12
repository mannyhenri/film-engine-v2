const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),Module=require('module'),{Readable}=require('stream');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'fe-final-3d-world-'));
const {db}=require('../db/database');require('../db/schema').ensureSchema();
require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const serverPath=path.join(__dirname,'../server.js'),compiled=new Module(serverPath,module);compiled.filename=serverPath;compiled.paths=Module._nodeModulePaths(path.dirname(serverPath));
compiled._compile(fs.readFileSync(serverPath,'utf8').replace(/\nstart\(\);\s*$/,'\nmodule.exports={server};'),serverPath);
const handler=compiled.exports.server.listeners('request')[0];
async function request(url,body){return new Promise((resolve,reject)=>{const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.socket={remoteAddress:'127.0.0.1'};req.method='POST';req.url='/film'+url;req.headers={'content-type':'application/json'};const res={statusCode:200,headersSent:false,setHeader(){},writeHead(code){this.statusCode=code;this.headersSent=true;},end(data){resolve({status:this.statusCode,body:JSON.parse(String(data))});}};Promise.resolve(handler(req,res)).catch(reject);});}
const project=crypto.randomUUID(),character=crypto.randomUUID();
db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project,'Exact 3D fixture',JSON.stringify({model3d:'meshy',world:'worldlabs'}));
db.prepare('INSERT INTO film_characters(id,project_id,name,appearance_prompt) VALUES(?,?,?,?)').run(character,project,'Fixture','A blue robot');
const worlds=require('../lib/worlds'),world=worlds.createWorld(db,{projectId:project,name:'Fixture world'}),version=worlds.newVersion(db,world.id,{model:'marble-1.0-draft'});
const pixels=Buffer.alloc(64*64*4,255),png=require('../lib/png-raster').encode({width:64,height:64,pixels}),uri='data:image/png;base64,'+png.toString('base64');
test.after(()=>{compiled.exports.server.close();db.close();fs.rmSync(process.env.FILM_DATA_DIR,{recursive:true,force:true});});
