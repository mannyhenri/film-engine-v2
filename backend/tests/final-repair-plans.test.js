const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
process.env.FILM_DATA_DIR=fs.mkdtempSync(path.join(os.tmpdir(),'final-repair-'));process.env.RUNWAY_API_KEY='mock-only';
const {db}=require('../db/database');require('../db/schema').ensureSchema();require('../lib/providers/credentials').getCredential=()=>({apiKey:'mock-only',meta:{}});
const bytes=require('../lib/png-raster').encode({width:2,height:2,pixels:Buffer.alloc(16,255)});
require('../lib/ffmpeg').inspectMedia=()=>({ok:true,durationSeconds:10});
require('../lib/ffmpeg').extractFrame=(source,{out})=>{fs.writeFileSync(out,bytes);return {ok:true,path:out};};
require('../lib/repair-plan').planRepair=()=>({extract:[{role:'first',atSeconds:0},{role:'last',atSeconds:4}],generate:{durationSeconds:5,resolution:'720p'},source:{durationSeconds:10},cost:{usd:1}});
const project=crypto.randomUUID(),scene=crypto.randomUUID(),shot=crypto.randomUUID(),file=require('../lib/file-storage').getFilePath(project,'video','clip.mp4');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'original clip');
db.prepare('INSERT INTO film_projects(id,title,provider_config) VALUES(?,?,?)').run(project,'Fixture',JSON.stringify({video:'runway',video_model:'veo3.1'}));db.prepare('INSERT INTO film_scenes(id,project_id,scene_number) VALUES(?,?,1)').run(scene,project);db.prepare('INSERT INTO film_shots(id,scene_id,shot_code) VALUES(?,?,?)').run(shot,scene,'1A');db.prepare("INSERT INTO film_assets(id,project_id,shot_id,asset_type,file_path,file_name,version) VALUES(?,?,?,'video_raw',?,'clip.mp4',1)").run(crypto.randomUUID(),project,shot,file);
