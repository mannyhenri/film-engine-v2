/*
 * Runs backend/server.js for the Electron app, and exits when Electron does.
 * Electron holds this process's stdin open; however Electron ends — quit,
 * crash, SIGKILL — the pipe closes and the backend goes with it.
 */
process.stdin.on('end', () => process.exit(0));
process.stdin.on('error', () => process.exit(0));
process.stdin.resume();
require('../backend/server.js');
