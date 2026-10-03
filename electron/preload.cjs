const { contextBridge } = require('electron');

// Where the API is: main started (or checked) the backend and passes its
// address. The page's own rule (same host, :3100) cannot know a backend main
// put on another port, and from file:// there is no host to follow at all.
const arg = process.argv.find(a => a.startsWith('--fe-api-base='));
if (arg) contextBridge.exposeInMainWorld('__filmEngineApiBase', arg.slice('--fe-api-base='.length));
