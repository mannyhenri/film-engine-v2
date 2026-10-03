/*
 * Registration, not just declaration: every name a React page or component says it puts on window
 * (react.json: a page's loader and provides, a component's provides) IS on window once App has
 * mounted, the way main.jsx mounts it. A react.json can list a name the code never registers, or
 * registers only from a component nothing mounts; tools/tests/react-pages.test.js reads the source
 * for the call, and this checks it actually ran. Set-based over every react.json in both directories.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import { installLegacy } from './test/setup.js';
import App from './App.jsx';

const ROOT = path.resolve(__dirname, '..');
const owners = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter(n => fs.existsSync(path.join(ROOT, dir, n, 'react.json')))
    .map(n => ({ owner: `${dir}/${n}`, ...JSON.parse(fs.readFileSync(path.join(ROOT, dir, n, 'react.json'), 'utf8')) }));
const OWNERS = [...owners('src/pages'), ...owners('src/components')];

describe('App registers every name the React pages and components provide', () => {
    it('found both kinds of owner', () => {
        expect(OWNERS.filter(o => o.owner.startsWith('src/pages/')).length).toBeGreaterThan(10);
        expect(OWNERS.filter(o => o.owner.startsWith('src/components/')).length).toBeGreaterThanOrEqual(1);
    });

    it('each is a function on window after App mounts', () => {
        installLegacy();
        render(<App />);
        const missing = OWNERS.flatMap(o => [o.loader, ...(o.provides || [])].filter(Boolean)
            .filter(n => typeof window[n] !== 'function').map(n => `${n} (${o.owner})`));
        expect(missing).toEqual([]);
    });

    it('each modal a component took over is in the document, hidden, from the first render', () => {
        installLegacy();
        render(<App />);
        const bad = OWNERS.filter(o => o.owner.startsWith('src/components/')).flatMap(o => o.modals
            .filter(id => { const el = document.getElementById(id); return !el || el.classList.contains('open'); }).map(id => `${id} (${o.owner})`));
        expect(bad).toEqual([]);
    });
});
