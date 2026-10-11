const test=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createCLIRunner,argumentsFor,parseEvent,cliEnv}=require('../lib/ai-cli-runner');
function fake(){const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.signals=[];child.kill=s=>child.signals.push(s);const calls=[];const runner=createCLIRunner({resolveBinary:()=>'/fake/cli',spawnProcess:(...args)=>{calls.push(args);return child;}});return {child,calls,runner};}
function hooks(){const state={events:[],result:null,error:null,cancelled:false,closed:0};return {state,event:e=>state.events.push(e),complete:(text,meta)=>state.result={text,meta},error:e=>state.error=e,cancelled:()=>state.cancelled=true,closed:()=>state.closed++};}
test('dedicated runners do not resume, invoke a shell, or inherit configured tools',()=>{const f=fake(),h=hooks();f.runner.start({provider:'codex',payload:'Only supplied context'},h);assert.equal(f.calls[0][2].shell,false);assert.equal(f.calls[0][1].includes('resume'),false);assert.ok(f.calls[0][1].includes('--ignore-user-config'));assert.ok(f.calls[0][1].includes('read-only'));const a=argumentsFor('claude','id');assert.ok(a.includes('--safe-mode'));assert.equal(a[a.indexOf('--tools')+1],'');f.child.emit('close',1);});
test('split JSON stream yields a result and true session id; diagnostics do not become failures',()=>{const f=fake(),h=hooks();f.runner.start({provider:'codex',payload:'x'},h);f.child.stdout.write('{"type":"thread.started","thread_id":"dedicated"}\n{"type":"item.com');f.child.stderr.write('Harmless startup warning');f.child.stdout.write('pleted","item":{"type":"agent_message","text":"Done"}}\n');f.child.emit('close',0);assert.equal(h.state.result.text,'Done');assert.equal(h.state.result.meta.session_id,'dedicated');assert.equal(h.state.error,null);});
test('structured provider error stays failed even with exit code zero and partial text',()=>{const f=fake(),h=hooks();f.runner.start({provider:'claude',payload:'x'},h);f.child.stdout.write(JSON.stringify({type:'assistant',message:{content:[{type:'text',text:'Partial'}]}})+'\n');f.child.stdout.write(JSON.stringify({type:'result',is_error:true,errors:['Account unavailable']})+'\n');f.child.emit('close',0);assert.equal(h.state.result,null);assert.match(h.state.error,/Account unavailable/);});
test('cancellation is pending until this owned process closes; malformed events fail clearly',()=>{const f=fake(),h=hooks(),handle=f.runner.start({provider:'codex',payload:'x'},h);handle.cancel();assert.equal(h.state.cancelled,false);assert.deepEqual(f.child.signals,['SIGTERM']);f.child.emit('close',null);assert.equal(h.state.cancelled,true);const g=fake(),k=hooks();g.runner.start({provider:'codex',payload:'x'},k);g.child.stdout.write('not json\n');g.child.emit('close',0);assert.match(k.state.error,/unsupported event/);});

test('async capability/account probes share one flight, leave timers responsive, isolate credentials and remove files',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-probe-test-')),calls=[];
 const saved=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='fixture-not-a-secret';
 try{
  const runner=createCLIRunner({temporaryRoot:dir,resolveBinary:id=>'/fixture/'+id,spawnProcess:(bin,args,options)=>{
   const child=new EventEmitter();child.stderr=new PassThrough();child.kill=()=>{};calls.push({bin,args,options});
   setTimeout(()=>{const help=bin.endsWith('claude')?'--safe-mode --input-format --tools --no-session-persistence':'--ignore-user-config --ephemeral --json';const output=args.includes('--help')?help:bin.endsWith('claude')?JSON.stringify({loggedIn:true,authMethod:'claude.ai'}):'Logged in using ChatGPT';fs.writeSync(options.stdio[1],output);child.emit('close',0);},15);return child;
  }});
  let responsive=false;setTimeout(()=>responsive=true,1);
  const first=runner.providersAsync(true),second=runner.providersAsync(true);
  assert.equal(first,second);const rows=await first;assert.equal(responsive,true);assert.equal(calls.length,4);assert.ok(rows.every(p=>p.available));
  calls.forEach(c=>{assert.equal(c.options.env.OPENAI_API_KEY,undefined);assert.equal(c.options.shell,false);});
  assert.deepEqual(fs.readdirSync(dir),[]);assert.deepEqual(runner.providers(),rows);
 }finally{saved===undefined?delete process.env.OPENAI_API_KEY:process.env.OPENAI_API_KEY=saved;fs.rmSync(dir,{recursive:true,force:true});}
});

test('probe failure and output bounds close their owned files without reporting available accounts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'film-probe-failure-test-'));
 try{const runner=createCLIRunner({temporaryRoot:dir,resolveBinary:id=>id==='codex'?'/fixture/codex':null,spawnProcess:(bin,args,options)=>{const child=new EventEmitter();child.stderr=new PassThrough();child.kill=()=>{};setImmediate(()=>{fs.writeSync(options.stdio[1],'x'.repeat(2000001));child.emit('close',0);});return child;}});const rows=await runner.providersAsync(true);assert.equal(rows.find(p=>p.id==='codex').available,false);assert.deepEqual(fs.readdirSync(dir),[]);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('runner contains throwing progress and terminal hooks, cleans its directory and invokes each hook at most once',()=>{
 for(const kind of ['event','complete','error','cancelled','closed']){
  const f=fake(),h=hooks();let calls=0;h[kind]=()=>{calls++;throw Error('fixture database write failed');};const handle=f.runner.start({provider:'codex',payload:'x'},h),dir=f.calls[0][2].cwd;
  if(kind==='cancelled')handle.cancel();
  assert.doesNotThrow(()=>{f.child.stdout.write('{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n');f.child.emit('close',kind==='error'?1:0);});
  assert.equal(calls,1);if(kind!=='closed')assert.equal(h.state.closed,1);assert.equal(fs.existsSync(dir),false);
 }
});

test('direct CLI environments remove the app capability before task or account subprocesses',()=>{
 const saved=process.env.FILM_AI_CAPABILITY;process.env.FILM_AI_CAPABILITY='fixture-app-capability';
 try{assert.equal(cliEnv('/fixture/codex').FILM_AI_CAPABILITY,undefined);}finally{saved===undefined?delete process.env.FILM_AI_CAPABILITY:process.env.FILM_AI_CAPABILITY=saved;}
});

test('rejected runner progress hooks suppress queued hooks and always run independent closed bookkeeping',async()=>{
 const f=fake(),h=hooks();let calls=0;h.event=()=>{calls++;return Promise.reject(Error('fixture storage failed'));};const handle=f.runner.start({provider:'codex',payload:'x'},h),dir=f.calls[0][2].cwd;f.child.stdout.write('{"type":"thread.started","thread_id":"fixture"}\n{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}\n');f.child.emit('close',0);const result=await handle.closed;assert.equal(result.status,'failed');assert.match(result.error,/could not be saved/);assert.equal(calls,1);assert.equal(h.state.closed,1);assert.equal(h.state.result,null);assert.equal(h.state.error,null);assert.equal(fs.existsSync(dir),false);
});
