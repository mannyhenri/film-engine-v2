/*
 * Boot order, the way the app really starts: main.jsx renders App synchronously BEFORE the legacy core
 * (a deferred script) has run, so no legacy global exists yet. Anything App mounts that reads a legacy
 * global while rendering throws, React unmounts the whole tree, the names below never reach window, and
 * the core then fails on its first call (the black screen: "pgEnsureSide is not defined"). App.test.jsx
 * installs the fake core first, so it cannot see this. Set-based over every react.json, like App.test.jsx.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';
import App from './App.jsx';

const ROOT = path.resolve(__dirname, '..');
const owners = (dir) => fs.readdirSync(path.join(ROOT, dir))
    .filter(n => fs.existsSync(path.join(ROOT, dir, n, 'react.json')))
    .map(n => ({ owner: `${dir}/${n}`, ...JSON.parse(fs.readFileSync(path.join(ROOT, dir, n, 'react.json'), 'utf8')) }));
const OWNERS = [...owners('src/pages'), ...owners('src/components')];

describe('App mounts before the legacy core exists (boot order)', () => {
    it('no legacy core is installed in this test', () => {
        expect(window.state).toBeUndefined();
        expect(window.api).toBeUndefined();
    });

    it('renders without throwing and registers every provided name', () => {
        expect(() => render(<App />)).not.toThrow();
        const names = OWNERS.flatMap(o => [o.loader, ...(o.provides || [])].filter(Boolean).map(n => ({ n, o: o.owner })));
        expect(names.length).toBeGreaterThan(10);
        expect(names.filter(({ n }) => window[n] === undefined).map(({ n, o }) => `${n} (${o})`)).toEqual([]);
        expect(typeof window.pgEnsureSide).toBe('function');
    });
});
