// The prompt window's one channel back to main: the answer (a string, or null for Cancel).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('fePrompt', { answer: (v) => ipcRenderer.send('fe-prompt-answer', v === null ? null : String(v)) });
