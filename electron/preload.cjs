const { contextBridge, ipcRenderer } = require('electron');

// Where the API is: main started (or checked) the backend and passes its
// address. The page's own rule (same host, :3100) cannot know a backend main
// put on another port, and from file:// there is no host to follow at all.
const arg = process.argv.find(a => a.startsWith('--fe-api-base='));
if (arg) contextBridge.exposeInMainWorld('__filmEngineApiBase', arg.slice('--fe-api-base='.length));

// Which desktop shell this is, so the page can make room for the window controls.
contextBridge.exposeInMainWorld('__feDesktop', { platform: process.platform });
// This IPC resolves only for main's trusted app window; the token stays out of
// renderer argv, URLs and persisted settings.
contextBridge.exposeInMainWorld('__filmAI', {getCapability: () => ipcRenderer.invoke('fe-ai-capability')});

// window.prompt() for the page: Electron does not implement it (it throws), and the
// legacy code asks with it in ~40 places. Synchronous, as prompt() is: main shows a
// small input window and returns the text, or null on Cancel. src/main.jsx installs it.
contextBridge.exposeInMainWorld('__fePrompt', (message, value) => ipcRenderer.sendSync('fe-prompt', String(message ?? ''), value === undefined ? '' : String(value)));
