import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './styles/base.css';
import './styles/redesign.css';
import './styles/desktop.css';
import './styles/list-controls.css';
import './styles/branding.css';
import { installPageLoader } from './lib/pages.js';
import { restoreRoute } from './lib/remember-route.js';
import App from './App.jsx';

// In the desktop app on macOS the title bar is hidden; desktop.css makes room for the window controls.
if (window.__feDesktop && window.__feDesktop.platform === 'darwin') document.documentElement.classList.add('fe-desktop-mac');
// Electron has no window.prompt(); the preload provides one (a small input window, synchronous).
if (window.__fePrompt) window.prompt = (message, value) => window.__fePrompt(message, value);
installPageLoader();
restoreRoute();

// Synchronously: the legacy core (a deferred script right after this module)
// looks its elements up by id the moment it runs.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<App />));
