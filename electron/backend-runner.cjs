/*
 * Runs backend/server.js for the Electron app, and exits when Electron does.
 * Electron holds this process's stdin open; however Electron ends — quit,
 * crash, SIGKILL — the pipe closes and the backend goes with it.
 */
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    try {await require('../backend/lib/ai-connections').connections().dispose();}
    finally {process.exit(0);}
}
process.stdin.on('end', close);
process.stdin.on('error', close);
for (const signal of ['SIGTERM','SIGINT','SIGHUP']) process.on(signal, close);
process.stdin.resume();
require('../backend/server.js');
