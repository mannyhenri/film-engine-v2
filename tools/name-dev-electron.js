#!/usr/bin/env node
/*
 * In development the app runs inside node_modules/electron's own Electron.app, and macOS takes the
 * bold app-menu title and the Dock label from THAT bundle's Info.plist, which says "Electron".
 * app.setName() fixes the menu items but not those two. This renames the dev bundle to Film Engine.
 * Runs on npm postinstall (an electron reinstall resets it); a packaged build carries the name itself.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const NAME = 'Film Engine';
if (process.platform !== 'darwin') process.exit(0);
let plist;
try { plist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist', 'Electron.app', 'Contents', 'Info.plist'); }
catch (_) { process.exit(0); } // electron not installed yet
if (!fs.existsSync(plist)) process.exit(0);
for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
    try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${NAME}`, plist]); }
    catch (_) { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${NAME}`, plist]); }
}
console.log(`dev Electron bundle named "${NAME}" (${path.relative(process.cwd(), plist)})`);
