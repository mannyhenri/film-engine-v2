import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import './styles/base.css';
import './styles/redesign.css';
import { installPageLoader } from './lib/pages.js';
import App from './App.jsx';

installPageLoader();

// Synchronously: the legacy core (a deferred script right after this module)
// looks its elements up by id the moment it runs.
const root = createRoot(document.getElementById('root'));
flushSync(() => root.render(<App />));
