/*
 * Puts the Node the backend runs on into the packaged app (build/node/node → Resources/node/node).
 * The backend runs under its own Node, not Electron's: better-sqlite3 is built for Node 23 (ABI 131), and Electron 33's
 * Node is another ABI, so a packaged app must carry that Node rather than rebuild the native module for Electron
 * (which would break running from source). Taken from FE_NODE, else the nvm Node 23 install, else `node` on PATH;
 * refused unless it is Node 23 and built for this architecture (x64 for the Intel DMG).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const candidates = [process.env.FE_NODE, path.join(os.homedir(), '.nvm/versions/node/v23.11.0/bin/node'), 'node'].filter(Boolean);
const src = candidates.find(p => { try { return execFileSync(p, ['-v']).toString().startsWith('v23.'); } catch (_) { return false; } });
if (!src) { console.error('bundle-node: no Node 23 found (set FE_NODE to one)'); process.exit(1); }
const arch = execFileSync(src, ['-p', 'process.arch']).toString().trim();
const want = process.env.FE_DIST_ARCH || 'x64';
if (arch !== want) { console.error(`bundle-node: ${src} is ${arch}, the build is ${want}`); process.exit(1); }
const real = execFileSync(src, ['-p', 'process.execPath']).toString().trim();
const out = path.join(__dirname, '..', 'build', 'node');
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(real, path.join(out, 'node'));
fs.chmodSync(path.join(out, 'node'), 0o755);
console.log(`bundle-node: ${real} (${execFileSync(src, ['-v']).toString().trim()}, ${arch}) → build/node/node`);
