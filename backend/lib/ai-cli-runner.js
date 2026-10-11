/** Dedicated text-only task processes. Never resumes another terminal or browser session. */
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {spawn,execFileSync}=require('child_process');
const LABELS={claude:'Claude Code · connected CLI account',codex:'OpenAI Codex · connected CLI account'};
function binary(name){
 const candidates=(process.env.PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,name));
 for(const p of ['/opt/homebrew/bin','/usr/local/bin',path.join(os.homedir(),'.local/bin')])candidates.push(path.join(p,name));
 const versions=path.join(os.homedir(),'.nvm/versions/node');
 if(fs.existsSync(versions))for(const v of fs.readdirSync(versions).sort().reverse())candidates.push(path.join(versions,v,'bin',name));
 return candidates.find(p=>{try{fs.accessSync(p,fs.constants.X_OK);return fs.statSync(p).isFile();}catch{return false;}})||null;
}
function cliEnv(bin){
 // Auth remains with the installed CLI. No credentials are copied into app storage.
 const env={...process.env,PATH:path.dirname(bin)+path.delimiter+(process.env.PATH||'')};
 for(const k of Object.keys(env))if(/^(NEONCORE_|CLAUDECODE$|CLAUDE_CODE_SESSION|CODEX_THREAD_ID$|CODEX_ACCESS_TOKEN$|CODEX_API_KEY$|OPENAI_API_KEY$|ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_RESUME_INTERRUPTED_TURN$)/.test(k))delete env[k];
 return env;
}
function argumentsFor(provider,id){
 if(provider==='claude')return ['-p','--safe-mode','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--disable-slash-commands','--no-chrome','--permission-prompts','none','--no-session-persistence','--session-id',id,'--output-format','stream-json','--verbose'];
 if(provider==='codex')return ['exec','--ignore-user-config','--ignore-rules','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--json','--color','never','-c','approval_policy="never"','-c','web_search="disabled"','-c','features.skip_host_skill_discovery=true',...['shell_tool','unified_exec','apps','hooks','plugins','remote_plugin','browser_use','browser_use_external','computer_use','in_app_browser','multi_agent','multi_agent_v2','code_mode_host','image_generation','view_image'].flatMap(f=>['--disable',f]),'-'];
 throw Error('Unsupported provider');
}
function parseEvent(provider,e){
 if(provider==='claude'){
  if(e.type==='system'&&e.subtype==='init')return {session:e.session_id,progress:'Claude session connected'};
  if(e.type==='assistant')return {text:(e.message?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n'),progress:'Claude response received'};
  if(e.type==='result')return e.is_error?{error:(e.errors||[e.result||'Claude task failed']).join('\n')}:{final:e.result||'',session:e.session_id};
 }else{
  if(e.type==='thread.started')return {session:e.thread_id,progress:'Codex session connected'};
  if(e.type==='item.completed'&&e.item?.type==='agent_message')return {text:e.item.text||'',progress:'Codex response received'};
  if(e.type==='error'||e.type==='turn.failed')return {error:e.message||e.error?.message||'Codex task failed'};
  if(e.type==='turn.completed')return {done:true};
 }
 return {progress:e.type==='turn.started'?'Thinking…':null};
}
const safeError=s=>String(s||'Task failed').replace(/\b(?:sk-[A-Za-z0-9_-]+|Bearer\s+\S+)/g,'[redacted]').slice(0,2000);
function createCLIRunner({spawnProcess=spawn,resolveBinary=binary}={}){
 let cached=null,lastProbe=0;
 function providers(force=false){
  if(!force&&cached&&Date.now()-lastProbe<30000)return cached;
  cached=Object.keys(LABELS).map(id=>{
   const bin=resolveBinary(id);let available=false,connected=false,note=bin?'Runner could not be verified':'CLI is not installed';
   if(bin)try{
    // Claude's native help can exit before a pipe flushes. Use a regular temporary
    // file for this public capability probe, then remove it immediately.
    const helpDir=fs.mkdtempSync(path.join(os.tmpdir(),'film-ai-cli-help-'));
    let help;const helpPath=path.join(helpDir,'help.txt'),fd=fs.openSync(helpPath,'w');
    try{execFileSync(bin,id==='claude'?['--help']:['exec','--help'],{env:cliEnv(bin),timeout:5000,stdio:['ignore',fd,'pipe']});help=fs.readFileSync(helpPath,'utf8');}
    finally{fs.closeSync(fd);fs.rmSync(helpDir,{recursive:true,force:true});}
    const required=id==='claude'?['--safe-mode','--input-format','--tools','--no-session-persistence']:['--ignore-user-config','--ephemeral','--json'];
    available=required.every(flag=>help.includes(flag));note=available?'Sign-in has not been verified':'Installed CLI does not support the required isolated task options';
    if(available)try{
     const authDir=fs.mkdtempSync(path.join(os.tmpdir(),'film-ai-account-check-')),authPath=path.join(authDir,'status'),authFd=fs.openSync(authPath,'w',0o600);let auth;
     try{execFileSync(bin,id==='claude'?['auth','status','--json']:['login','status'],{env:cliEnv(bin),timeout:5000,stdio:['ignore',authFd,authFd]});auth=fs.readFileSync(authPath,'utf8');}
     finally{fs.closeSync(authFd);fs.rmSync(authDir,{recursive:true,force:true});}
     if(id==='claude'){const status=JSON.parse(auth);connected=status.loggedIn===true&&['claude.ai','oauth_token'].includes(status.authMethod);}
     else connected=/logged in using chatgpt/i.test(auth);
     note=connected?'Connected subscription account · model response not yet verified':'Sign in securely from Film AI connections';
    }catch{note='Account unavailable; sign in securely from Film AI connections';}
   }catch{}
   return {id,label:LABELS[id],available:available&&connected,installed:!!bin,connected,note};
  });lastProbe=Date.now();return cached;
 }
 function start(input,hooks){
  const bin=resolveBinary(input.provider);if(!bin)throw Error('CLI is unavailable');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-engine-ai-')),sessionId=crypto.randomUUID();
  let child,buffer='',text='',final='',failure='',diagnostic='',session='',closed=false,cancelling=false,killTimer,timer;
  function close(code){if(closed)return;closed=true;clearTimeout(timer);clearTimeout(killTimer);fs.rmSync(dir,{recursive:true,force:true});
   if(cancelling)return hooks.cancelled();
   if(failure||code!==0)return hooks.error(safeError(failure||diagnostic||`CLI exited with status ${code}`));
   if(!(final||text).trim())return hooks.error('The CLI returned no text result');
   hooks.complete(final||text,{session_id:session||sessionId});
  }
  function line(s){if(!s.trim())return;let e;try{e=JSON.parse(s);}catch{failure='The CLI returned an unsupported event format';child?.kill('SIGTERM');return;}
   const out=parseEvent(input.provider,e);if(out.session){session=out.session;hooks.event({kind:'session',session_id:session});}
   if(out.progress)hooks.event({kind:'progress',message:out.progress});if(out.text)text=out.text;if(out.final!==undefined)final=out.final;if(out.error)failure=out.error;
  }
  try{child=spawnProcess(bin,argumentsFor(input.provider,sessionId),{cwd:dir,env:cliEnv(bin),stdio:['pipe','pipe','pipe'],shell:false});}catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
  child.stdout.on('data',b=>{buffer+=b.toString();if(buffer.length>2000000){failure='CLI event exceeded the output limit';child.kill('SIGTERM');return;}const lines=buffer.split('\n');buffer=lines.pop();for(const s of lines)line(s);});
  child.stderr.on('data',b=>{diagnostic=safeError((diagnostic+b.toString()).slice(-2000));});
  child.on('error',e=>{failure=e.message;close(1);});child.on('close',code=>{if(buffer.trim())line(buffer);close(code);});
  child.stdin.on('error',()=>{});child.stdin.end(input.payload);
  timer=setTimeout(()=>{failure='Task exceeded the 10 minute limit';child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);},600000);timer.unref?.();
  return {cancel(){if(closed)return false;cancelling=true;child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),2000);killTimer.unref?.();return true;}};
 }
 return {providers,start};
}
module.exports={createCLIRunner,argumentsFor,parseEvent,binary,cliEnv};
