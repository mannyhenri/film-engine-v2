/*
 * React pages are mounted per open project. Set-based over every page in the registry: after the project changes,
 * every React page is a NEW mount (nothing it drew or is still waiting for belongs to the new project), every
 * legacy page is the SAME node (core owns its markup and what it wrote there), the page on screen stays shown, and
 * every loader core calls is registered again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { render, act } from '@testing-library/react';
import { installLegacy } from '../test/setup.js';
import { PAGES } from '../pages/registry.js';
import Main from '../components/Main/Main.jsx';
import { noteOpenProject, resetProjectEpoch } from './project-epoch.js';

const ROOT = path.resolve(__dirname, '../..');
const reactJson = (id) => { const f = path.join(ROOT, 'src/pages', id, 'react.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const REACT_IDS = PAGES.filter(p => p.react).map(p => p.id);
const LEGACY_IDS = PAGES.filter(p => !p.react).map(p => p.id);
afterEach(() => resetProjectEpoch());

describe('React pages are mounted per open project', () => {
    it('the registry marks exactly the pages that have a react.json', () => {
        expect(REACT_IDS.length).toBeGreaterThan(20);
        expect(PAGES.filter(p => !!reactJson(p.id) !== !!p.react).map(p => p.id)).toEqual([]);
    });

    it('a project change remounts every React page and no legacy page; the page on screen stays shown; loaders stay registered', () => {
        const { fake } = installLegacy({ project: { id: 'A' } });
        fake.state.currentPage = 'storyboard';
        render(<Main />);
        act(() => { noteOpenProject(); });                                  // the first navigation: mounted for A
        document.getElementById('page-storyboard').classList.add('active'); // as navigateTo does
        const before = Object.fromEntries(PAGES.map(p => [p.id, document.getElementById('page-' + p.id)]));
        expect(PAGES.filter(p => !before[p.id]).map(p => p.id), 'a page with no root').toEqual([]);

        act(() => { noteOpenProject(); });                                  // same project: nothing moves
        expect(REACT_IDS.filter(id => document.getElementById('page-' + id) !== before[id])).toEqual([]);

        fake.state.currentProject = { id: 'B' };
        act(() => { noteOpenProject(); });
        expect(REACT_IDS.filter(id => document.getElementById('page-' + id) === before[id]), 'still the mount for A').toEqual([]);
        expect(LEGACY_IDS.filter(id => document.getElementById('page-' + id) !== before[id]), 'legacy markup replaced').toEqual([]);
        expect([...document.querySelectorAll('.page.active')].map(p => p.id), 'only the page on screen is shown').toEqual(['page-storyboard']);
        const loaders = REACT_IDS.flatMap(id => { const r = reactJson(id); return [r.loader, ...(r.provides || [])]; });
        expect(loaders.filter(n => typeof window[n] !== 'function')).toEqual([]);

        fake.state.currentProject = null;                                    // All Projects
        act(() => { noteOpenProject(); });
        expect(REACT_IDS.filter(id => !document.getElementById('page-' + id))).toEqual([]);
    });

    it('a late answer for the project you left draws nothing into the new mount', async () => {
        let releaseA;
        const { fake } = installLegacy({ project: { id: 'A' }, routes: {
            'GET /projects/A/characters': () => new Promise(r => { releaseA = () => r({ characters: [{ id: 'c1', name: 'From A' }] }); }),
        } });
        render(<Main />);
        act(() => { noteOpenProject(); });
        let pending;
        act(() => { pending = window.loadCharacters(); });                  // A's list is slow
        fake.state.currentProject = { id: 'B' };
        act(() => { noteOpenProject(); });                                  // switched: remounted for B
        await act(async () => { releaseA(); await pending; });
        expect(document.getElementById('characterGrid').textContent).not.toContain('From A');
    });
});
