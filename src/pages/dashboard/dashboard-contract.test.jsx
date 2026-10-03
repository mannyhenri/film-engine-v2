/*
 * Four home-page.test.js sub-tests read the legacy home builders (function homePhasesHtml ...
 * homeRunningHtml, their onclick text, async function resumeShot), which the React page does not have:
 *   "the phase fractions are declared once, and the page renders what it is served"
 *   "every needs-you item carries a way in"
 *   "every handler the home page calls is actually defined"
 *   "resume opens the frame rather than silently doing nothing"
 * All four are skipped (SKIPPED-SUBTESTS.json) and held here. Behaviour (each block's way in, Resume opening
 * the frame) is in DashboardPage.test.jsx; the structural rules are here.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import DashboardPage from './DashboardPage.jsx';

const ROOT = path.resolve(__dirname, '../../..');
const require_ = createRequire(import.meta.url);
const SRC = fs.readFileSync(path.join(ROOT, 'src/pages/dashboard/DashboardPage.jsx'), 'utf8');

describe('the home page (the backend home-page sub-tests, moved)', () => {
    it('the phases are declared ONCE (lib/home.js), and the page renders whatever it is served', async () => {
        const { PHASES } = require_(path.join(ROOT, 'backend/lib/home'));
        expect(PHASES.map(p => p.id)).toEqual(['write', 'plan', 'look', 'make', 'edit', 'deliver']);
        for (const id of PHASES.map(p => p.id)) expect(SRC, `the page declares its own '${id}' phase — a second copy that will drift`).not.toMatch(new RegExp(`id:\\s*'${id}'`));
        // Served three phases, it draws three; served none, none.
        const served = [{ page: 'a', label: 'A', done: 1, of: 2, note: '' }, { page: 'b', label: 'B', done: 0, of: 1, note: '' }, { page: 'c', label: 'C', done: 1, of: 1, note: '' }];
        installLegacy({ routes: { 'GET /projects/p1/home': { greeting: { salutation: 'Hi', project_title: 'X', shot_count: 0, scene_count: 0 }, phases: served } } });
        render(<DashboardPage />);
        await act(async () => { await window.loadDashboard(); });
        expect([...document.querySelectorAll('#homePhases .home-phase .name')].map(n => n.textContent)).toEqual(['A', 'B', 'C']);
    });

    it('every handler a home block calls exists, and every control in the home blocks does something', async () => {
        const { fake } = installLegacy({ routes: { 'GET /projects/p1/home': {
            greeting: { salutation: 'Hi', project_title: 'X', shot_count: 1, scene_count: 1 },
            resume: { shot_id: 's', shot_code: '1A', headline: 'h', summary: 's', state: 'x' },
            needs: [{ label: 'n', page: 'notes' }], phases: [{ page: 'scenes', label: 'P', done: 0, of: 1, note: '' }],
            activity: [], running: [{ kind: 'video', status: 'running' }],
        } } });
        render(<DashboardPage />);
        await act(async () => { await window.loadDashboard(); });
        const blocks = ['homeResume', 'homeNeeds', 'homePhases', 'homeRunning'].map(id => document.getElementById(id));
        const controls = blocks.flatMap(b => [...b.querySelectorAll('button, a')]);
        expect(controls.length, 'the scan found too few controls to mean anything').toBeGreaterThanOrEqual(5);
        for (const c of controls) {
            const before = fake.navigateTo.mock.calls.length + fake.openFrameViewer.mock.calls.length;
            await act(async () => { fireEvent.click(c); });
            expect(fake.navigateTo.mock.calls.length + fake.openFrameViewer.mock.calls.length, `"${c.textContent}" does nothing`).toBeGreaterThan(before);
        }
    });
});
