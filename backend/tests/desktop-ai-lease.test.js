const test = require('node:test'), assert = require('node:assert/strict');
const {createDesktopAILease} = require('../../electron/ai-connections.cjs');
const flush = () => new Promise(resolve => setImmediate(resolve));
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {EventEmitter} = require('node:events'), {createRequire} = require('node:module');

test('desktop retries a rejected first attach with the same authenticated owner', async t => {
    t.mock.timers.enable({apis: ['setInterval']});
    const calls = [], lease = createDesktopAILease({heartbeatMs: 10, getCapability: () => 'fixture-capability', request: async (action, body, options) => {
        calls.push({action, body, options});
        if (calls.length === 1) throw Error('Transient attach failure');
        return {application: 'film-engine-v2'};
    }});
    t.after(() => lease.stop());
    await assert.rejects(lease.start(), /Transient attach failure/);
    t.mock.timers.tick(10); await flush();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map(c => c.action), ['attach', 'attach']);
    assert.equal(calls[0].body.owner, calls[1].body.owner);
    assert.equal(calls[1].options.headers['X-Film-AI-Capability'], 'fixture-capability');
    await lease.stop();
    assert.equal(calls.at(-1).action, 'detach');
    assert.equal(calls.at(-1).options.headers['X-Film-AI-Capability'], 'fixture-capability');
    t.mock.timers.tick(100); await flush();
    assert.equal(calls.length, 3);
});

test('stopping during first attach detaches after it settles and never renews', async t => {
    t.mock.timers.enable({apis: ['setInterval']});
    const calls = []; let finish;
    const lease = createDesktopAILease({heartbeatMs: 10, request: (action, body) => {
        calls.push({action, body});
        return action === 'attach' ? new Promise(resolve => {finish = resolve;}) : Promise.resolve({application: 'film-engine-v2'});
    }});
    const starting = lease.start(), stopping = lease.stop();
    t.mock.timers.tick(100); await flush(); assert.equal(calls.length, 1);
    finish({application: 'film-engine-v2'}); await starting; await stopping;
    t.mock.timers.tick(100); await flush();
    assert.deepEqual(calls.map(c => c.action), ['attach', 'detach']);
    assert.equal(calls[0].body.owner, calls[1].body.owner);
});

function desktopFixture(extraEnv = {}) {
    const mainPath = path.join(__dirname, '../../electron/main.cjs'), actualRequire = createRequire(mainPath);
    const handlers = new Map(), spawns = [];
    class Window extends EventEmitter {
        constructor(options) {
            super(); this.options = options; this.webContents = new EventEmitter();
            this.webContents.mainFrame = {url: ''};
            this.webContents.getURL = () => this.webContents.mainFrame.url;
            this.webContents.setWindowOpenHandler = () => {};
        }
        async loadFile(file) {this.webContents.mainFrame.url = require('node:url').pathToFileURL(file).href;}
        async loadURL(url) {this.webContents.mainFrame.url = url;}
    }
    const app = new EventEmitter(); app.setName = () => {}; app.whenReady = () => new Promise(() => {});
    const electron = {app, BrowserWindow: Window, shell: {}, ipcMain: {handle(name, fn) {handlers.set(name, fn);}, on() {}}};
    const context = {module: {exports: {}}, __dirname: path.dirname(mainPath), URL, setInterval, clearInterval, setTimeout,
        process: {argv: [], env: {FILM_AI_CAPABILITY: 'd'.repeat(64), ...extraEnv}, platform: 'linux', on() {}}, console: {warn() {}, error() {}, log() {}},
        require(name) {
            if (name === 'electron') return electron;
            if (name === 'child_process') return {spawn(bin, args, options) {
                const child = new EventEmitter(); child.signals = []; child.kill = signal => child.signals.push(signal);
                spawns.push({bin, args, options, child}); return child;
            }};
            if (name === 'net') return {createServer() {return {listen(port, host, fn) {setImmediate(fn); return this;}, address() {return {port: 45678};}, close(fn) {fn();}, on() {}};}};
            return actualRequire(name);
        }};
    vm.runInNewContext(fs.readFileSync(mainPath, 'utf8') + '\nmodule.exports = {ensureBackend, createWindow, stopBackend, getAPI: () => API, setChecks(h, a) {health = h; acceptsAICapability = a;}};', context, {filename: mainPath});
    return {...context.module.exports, handlers, spawns, env: context.process.env};
}

test('capability IPC is restricted to the trusted main window and frame', async () => {
    const f = desktopFixture(), win = await f.createWindow(), capability = f.handlers.get('fe-ai-capability');
    const event = {sender: win.webContents, senderFrame: win.webContents.mainFrame};
    assert.equal(capability(event).capability, 'd'.repeat(64));
    assert.equal(f.env.FILM_AI_CAPABILITY, undefined);
    assert.throws(() => capability({...event, sender: {}}), /app window/);
    assert.throws(() => capability({...event, senderFrame: {url: event.senderFrame.url}}), /app window/);
    win.webContents.mainFrame.url = 'https://foreign.test/';
    assert.throws(() => capability(event), /trusted app page/);
    win.emit('closed'); assert.throws(() => capability(event), /app window/);
});

test('explicit local development window gets IPC while an unconfigured origin cannot', async () => {
    for (const [env, allowed] of [
        [{FE_DEV_URL: 'http://localhost:5173'}, true],
        [{FE_DEV_URL: 'http://localhost:5184', FILM_AI_DEV_ORIGINS: 'http://localhost:5184'}, true],
        [{FE_DEV_URL: 'http://localhost:5184'}, false],
    ]) {
        const f = desktopFixture(env), win = await f.createWindow(), event = {sender: win.webContents, senderFrame: win.webContents.mainFrame};
        const receive = () => f.handlers.get('fe-ai-capability')(event);
        if (allowed) assert.equal(receive().capability, 'd'.repeat(64)); else assert.throws(receive, /trusted app page/);
    }
});

test('incompatible shared backend is untouched and owned backend starts on loopback with ephemeral capability', async () => {
    const f = desktopFixture(), h = {service: 'film-engine', version: '1.0.1', backend_id: require('../lib/backend-identity').backendId, capabilities: {ai_connections: 1, application_ai_workspace: 1, ai_route_auth: 1}};
    let probes = 0;
    f.setChecks(async () => h, async () => ++probes > 1);
    assert.equal(await f.ensureBackend(), 'started');
    assert.equal(f.getAPI(), 'http://127.0.0.1:45678');
    assert.equal(f.spawns.length, 1);
    assert.equal(f.spawns[0].options.env.FILM_BACKEND_HOST, '127.0.0.1');
    assert.equal(f.spawns[0].options.env.FILM_AI_CAPABILITY, 'd'.repeat(64));
    assert.equal(f.spawns[0].args.some(arg => arg.includes('d'.repeat(64))), false);
    assert.equal(f.spawns[0].child.signals.length, 0);
    f.stopBackend(); assert.equal(f.spawns[0].child.signals.length, 1);
    const reused = desktopFixture(); reused.setChecks(async () => h, async () => true);
    assert.equal(await reused.ensureBackend(), 'reused'); reused.stopBackend();
    assert.equal(reused.spawns.length, 0);
});
