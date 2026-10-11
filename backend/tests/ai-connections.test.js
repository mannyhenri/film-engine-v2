const test = require('node:test'), assert = require('node:assert/strict');
const {EventEmitter} = require('node:events'), {PassThrough} = require('node:stream');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {spawn} = require('node:child_process');
const {createAIConnections, workerArguments, ownedEnv, signInURL} = require('../lib/ai-connections');
const {createDesktopAILease} = require('../../electron/ai-connections.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function fixture(options = {}) {
    const calls = [], children = [], dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-owned-lifecycle-test-'));
    const rows = ['claude', 'codex'].map(id => ({id, installed: true, connected: true, available: true}));
    const manager = createAIConnections({readyDelay: 1, readyTimeout: 200, killDelay: 15, reconnectDelays: [], temporaryRoot: dir,
        probe: async () => options.rows || rows, resolveBinary: id => '/fixture/' + id,
        spawnProcess: (bin, args, config) => {
            const spec = JSON.parse(args[1]), provider = path.basename(spec.bin), child = new EventEmitter();
            child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.signals = []; child.input = '';
            child.stdin.on('data', b => child.input += b.toString());
            child.kill = signal => {child.signals.push(signal); if (!options.manualClose) setImmediate(() => child.emit('close', 143));};
            child.provider = provider; child.spec = spec; children.push(child); calls.push({bin, args, config, child});
            setImmediate(() => {
                child.stdout.write(JSON.stringify({type: 'film.worker.ready'}) + '\n');
                if (provider === 'claude' && !spec.args.includes('login')) child.stdout.write(JSON.stringify({type: 'system', subtype: 'init', session_id: spec.args[spec.args.indexOf('--session-id') + 1], tools: [], mcp_servers: []}) + '\n');
            });
            return child;
        }});
    const keepAlive = setInterval(()=>{},1000);
    const cleanup = async () => {await manager.dispose(); clearInterval(keepAlive); fs.rmSync(dir, {recursive: true, force: true});};
    return {manager, children, calls, cleanup};
}
function task(provider = 'codex') {return {provider, project_id: crypto.randomUUID(), conversation_id: crypto.randomUUID(), task_id: crypto.randomUUID(), payload: '{"reviewed":"Only Film context"}'};}
function hooks() {const values = {events: [], completed: null, error: null, cancelled: false, interrupted: null}; return {values, event: e => values.events.push(e), complete: (text, meta) => values.completed = {text, meta}, error: e => values.error = e, cancelled: () => values.cancelled = true, interrupted: e => values.interrupted = e};}
test('opening Film owns both idle transports and sends no request; desktop instances have independent leases', async t => {
    const f = fixture(); t.after(f.cleanup);
    const owner = crypto.randomUUID(); await f.manager.attach(owner); await f.manager.attach(owner);
    assert.equal(f.children.length, 2); assert.ok(f.children.every(c => c.input === ''));
    assert.deepEqual(f.manager.providers().map(p => p.state), ['ready', 'ready']);
    assert.ok(f.manager.providers().every(p => !p.inference_verified));
    for (const call of f.calls) {assert.equal(call.config.shell, false); assert.match(call.config.cwd, /film-owned-ai-/);}
    const codex = f.children.find(c => c.provider === 'codex'); assert.ok(codex.spec.args.includes('--no-daemon')); assert.ok(codex.spec.args.includes('--ignore-user-config')); assert.ok(codex.spec.args.includes('--ignore-rules')); assert.equal(codex.spec.args.includes('resume'), false);
    const claude = f.children.find(c => c.provider === 'claude'); assert.equal(claude.spec.args.includes('--bare'),false); assert.ok(claude.spec.args.includes('--safe-mode')); assert.equal(claude.spec.args[claude.spec.args.indexOf('--tools') + 1], '');
    const other = crypto.randomUUID(); await f.manager.attach(other); await f.manager.detach(owner); assert.ok(f.manager.status().opened);
    await f.manager.detach(other); assert.ok(f.children.every(c => c.signals.includes('SIGTERM'))); assert.equal(f.manager.status().opened, false);
});
test('only Film-owned IDs dispatch; Unicode response and native session audit survive; reconnect never resubmits', async t => {
    const f = fixture(); t.after(f.cleanup); await f.manager.attach(crypto.randomUUID());
    const h = hooks(), request = task(), child = f.children.find(c => c.provider === 'codex');
    assert.throws(() => f.manager.start({...request, session_id: 'foreign-marketing'}, h), /Film-owned/);
    f.manager.start(request, h); const sent = JSON.parse(child.input.trim()); assert.equal(sent.value, request.payload); assert.equal(sent.close, true);
    child.stdout.write('{"type":"thread.started","thread_id":"owned-fixture"}\n');
    const body = Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"Été 静 ☕"}}\n');
    const cut = body.indexOf(Buffer.from('静')) + 1; child.stdout.write(body.subarray(0, cut)); child.stdout.write(body.subarray(cut)); child.emit('close', 0);
    await pause(10); assert.equal(h.values.completed.text, 'Été 静 ☕'); assert.equal(h.values.completed.meta.session_id, 'owned-fixture');
    assert.equal(f.manager.providers().find(p => p.id === 'codex').inference_verified, true);
    assert.equal(f.children.filter(c => c.provider === 'codex').length, 2);
    assert.equal(f.children.at(-1).input, '');
});
test('application relay requires explicit Film ownership and UUIDs; preserves existing project ownership', async t=>{
 const f=fixture();t.after(f.cleanup);await f.manager.attach(crypto.randomUUID());const h=hooks(),request={provider:'codex',scope:'application',owner:{scope:'application',application_id:'film-engine-v2'},conversation_id:crypto.randomUUID(),task_id:crypto.randomUUID(),payload:'Reviewed application evidence'};
 for(const invalid of [{...request,owner:undefined},{...request,project_id:crypto.randomUUID()},{...request,owner:{scope:'application',application_id:'other-app'}},{...request,conversation_id:'home'}])assert.throws(()=>f.manager.start(invalid,h),/Film-owned/);
 f.manager.start(request,h);assert.equal(JSON.parse(f.children.find(c=>c.provider==='codex').input).value,request.payload);
});
test('authentication failure is unavailable and unverified until explicit reconnect; never auto-signs in',async t=>{
 const f=fixture();t.after(f.cleanup);const owner=crypto.randomUUID();await f.manager.attach(owner);const h=hooks(),child=f.children.find(c=>c.provider==='claude');f.manager.start(task('claude'),h);child.stdout.write(JSON.stringify({type:'result',is_error:true,result:'Not logged in · Please run /login'})+'\n');child.emit('close',1);await pause(5);let p=f.manager.providers().find(p=>p.id==='claude');assert.equal(p.state,'sign_in_required');assert.equal(p.available,false);assert.equal(p.inference_verified,false);assert.match(h.values.error,/Not logged in/);const count=f.children.length;await f.manager.attach(owner);assert.equal(f.children.length,count);await f.manager.reconnect('claude');p=f.manager.providers().find(p=>p.id==='claude');assert.equal(p.state,'ready');assert.equal(p.inference_verified,false);assert.ok(f.children.every(c=>!c.spec.args.includes('login')));
});
test('cancel stays pending until the owned worker closes; shutdown interrupts without claiming completion', async t => {
    const f = fixture({manualClose: true}); t.after(async () => {for (const c of f.children) c.emit('close', 143); await f.cleanup();});
    await f.manager.attach(crypto.randomUUID()); const h = hooks(), c = f.children.find(c => c.provider === 'codex');
    const handle = f.manager.start(task(), h); handle.cancel(); assert.equal(h.values.cancelled, false); assert.equal(f.manager.providers().find(p => p.id === 'codex').state, 'cancelling');
    await pause(20); assert.deepEqual(c.signals, ['SIGTERM', 'SIGKILL']); c.emit('close', 143); assert.equal(h.values.cancelled, true); assert.equal(h.values.completed, null);
    const k = hooks(), claude = f.children.find(c => c.provider === 'claude'); f.manager.start(task('claude'), k);
    const shutdown = f.manager.shutdown(); assert.equal(k.values.interrupted, null); claude.emit('close', 143); await shutdown;
    assert.match(k.values.interrupted, /Film closed/); assert.equal(k.values.completed, null);
});
test('Claude result is reaped before completing', async t => {
    const f = fixture({manualClose: true}); t.after(async () => {for (const c of f.children) c.emit('close', 143); await f.cleanup();}); await f.manager.attach(crypto.randomUUID());
    const h = hooks(), c = f.children.find(c => c.provider === 'claude'); f.manager.start(task('claude'), h);
    c.stdout.write(JSON.stringify({type: 'result', result: 'A quiet scene.', session_id: c.spec.args[c.spec.args.indexOf('--session-id') + 1]}) + '\n');
    assert.equal(h.values.completed, null); assert.equal(JSON.parse(c.input.trim().split('\n').at(-1)).close, true); c.emit('close', 0); assert.equal(h.values.completed.text, 'A quiet scene.');
});
test('missing account never dispatches; sign-in is explicit, safe provider URLs only, and cancellation awaits exit', async t => {
    const rows = [{id: 'claude', installed: true, connected: false, available: false}, {id: 'codex', installed: false, connected: false, available: false}];
    const f = fixture({rows}); t.after(f.cleanup); await f.manager.attach(crypto.randomUUID()); assert.equal(f.children.length, 0); assert.equal(f.manager.providers()[0].state, 'sign_in_required');
    await assert.rejects(f.manager.signIn('claude', false), /Confirm secure/); await f.manager.signIn('claude', true);
    const c = f.children[0]; assert.deepEqual(c.spec.args, ['auth', 'login', '--claudeai']);
    c.stdout.write('https://example.com/stolen\nhttps://claude.ai/oauth/authorize?test=fixture\n');
    assert.equal(f.manager.providers()[0].login.url, 'https://claude.ai/oauth/authorize?test=fixture');
    await f.manager.cancelSignIn('claude'); assert.equal(f.manager.providers()[0].login, null); assert.equal(c.input, '');
    assert.equal(signInURL('https://auth.openai.com.evil.test/'), null); assert.equal(signInURL('https://user:password@auth.openai.com/'), null);
});
test('malformed provider events interrupt instead of applying partial output; other provider stays independent', async t => {
    const f = fixture(); t.after(f.cleanup); await f.manager.attach(crypto.randomUUID()); const h = hooks(), c = f.children.find(c => c.provider === 'codex'); f.manager.start(task(), h);
    c.stdout.write('not protocol JSON\n'); await pause(5); assert.match(h.values.interrupted, /Unsupported provider/); assert.equal(h.values.completed, null);
    assert.equal(f.manager.providers().find(p => p.id === 'claude').state, 'ready');
});
test('CLI environment cannot inherit Marketing, session resume or metered API credentials', () => {
    const names = ['NEONCORE_SESSION', 'CODEX_THREAD_ID', 'CLAUDECODE', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_RESUME_INTERRUPTED_TURN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_OAUTH_TOKEN'];
    const saved = names.map(k => process.env[k]); names.forEach(k => process.env[k] = 'fixture-not-a-secret');
    try {const env = ownedEnv('/fixture/cli'); names.forEach(k => assert.equal(env[k], undefined));}
    finally {names.forEach((k, i) => saved[i] === undefined ? delete process.env[k] : process.env[k] = saved[i]);}
    assert.equal(workerArguments('codex', 'id').includes('proxy'), false);
});
test('desktop owns startup and detach; smoke opens no provider; stops only its own lease', async () => {
    const calls = [], lease = createDesktopAILease({request: async (action, b) => {calls.push({action, b}); return {application: 'film-engine-v2'};}});
    await lease.start(); await lease.stop(); assert.deepEqual(calls.map(c => c.action), ['attach', 'detach']); assert.equal(calls[0].b.owner, calls[1].b.owner);
    const smoke = createDesktopAILease({disabled: true, request: () => {throw Error('smoke must not connect');}}); await smoke.start(); await smoke.stop();
});
test('guardian kills its own CLI when parent pipe closes, even after task input ended', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'film-guardian-test-'));
    const script = path.join(dir, 'idle.cjs'); fs.writeFileSync(script, "process.stdout.write(JSON.stringify({type:'fixture.pid',pid:process.pid})+'\\n');process.stdin.resume();process.stdin.on('end',()=>{setInterval(()=>{},1000);});");
    const guardian = spawn(process.execPath, [path.join(__dirname, '../lib/ai-cli-guardian.cjs'), JSON.stringify({bin: process.execPath, args: [script]})], {stdio: ['pipe', 'pipe', 'pipe']});
    let pid, buffer = '';
    await new Promise((resolve, reject) => {const timer = setTimeout(() => reject(Error('fixture timeout')), 3000); guardian.stdout.on('data', b => {buffer += b; for (const s of buffer.split('\n')) try {const e = JSON.parse(s); if (e.type === 'fixture.pid') {pid = e.pid; clearTimeout(timer); resolve();}} catch {}}); guardian.on('error', reject);});
    guardian.stdin.write(JSON.stringify({type: 'input', value: 'synthetic fixture only', close: true}) + '\n'); await pause(20); assert.doesNotThrow(() => process.kill(pid, 0));
    const exited = new Promise(resolve => guardian.on('close', resolve)); guardian.stdin.end(); await exited;
    assert.throws(() => process.kill(pid, 0), /ESRCH/); fs.rmSync(dir, {recursive: true, force: true});
});

test('Claude rejects a foreign session or tools introduced after the reviewed request', async t => {
    const f = fixture(); t.after(f.cleanup); await f.manager.attach(crypto.randomUUID());
    const h = hooks(), c = f.children.find(c => c.provider === 'claude'); f.manager.start(task('claude'), h);
    c.stdout.write(JSON.stringify({type:'system',subtype:'init',session_id:'foreign-marketing-session',tools:['shell'],mcp_servers:[{name:'foreign'}]})+'\n');
    await pause(5); assert.match(h.values.interrupted,/isolated Film session/); assert.equal(h.values.completed,null);
});
