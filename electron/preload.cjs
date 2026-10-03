const { contextBridge } = require('electron');

// Loaded from file:// the page cannot follow its own host to the API (it has
// none), so say where it is, as the iOS app does. Over http (vite dev) the
// page's own rule already finds it, and a saved override still wins there.
if (location.protocol === 'file:') {
    contextBridge.exposeInMainWorld('__filmEngineApiBase', process.env.FE_API_BASE || 'http://localhost:3100');
}
