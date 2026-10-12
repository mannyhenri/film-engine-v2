import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import PipelinePage from './PipelinePage.jsx';

// The pipeline monitor, end to end against the fake core: the routes, bodies, stream and lines the legacy page produced.
const BOARD = { scenes: [
    { id: 'sc1', scene_number: 1, shots: [{ id: 'a', shot_code: '1A', status: 'generating' }, { id: 'b', shot_code: '1B', status: 'approved', duration_ms: 4200 }] },
    { id: 'sc2', scene_number: 2, shots: [{ id: 'c', shot_code: '2A', status: 'draft' }] },
] };
const AUDIT = { ready: false, shots: [{ shot_id: 'a', shot_code: '1A', ready: true }, { shot_id: 'b', shot_code: '1B', ready: false, missing: ['lock MAYA', 'lock DINER'] }] };
const ROUTES = {
    'GET /projects/p1/status-board': BOARD, 'GET /projects/p1/consistency/audit': AUDIT,
    'GET /projects/p1/providers': { effective: { llm: 'claude', image: 'flux', video: 'veo' } },
};
async function openPage(routes = {}) {
    const legacy = installLegacy({ routes: { ...ROUTES, ...routes } });
    render(<PipelinePage />);
    await act(async () => { await window.loadPipeline(); });
    return legacy;
}
const shotSelect = () => document.getElementById('pipelineShotSelect');

describe('Pipeline', () => {
    it('answers to the loader navigateTo calls: the board, the audit and the providers, then a status line', async () => {
        const { calls, status } = await openPage();
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/status-board', '/projects/p1/consistency/audit', '/projects/p1/pipeline', '/projects/p1/providers']);
        expect(status).toEqual(['Loading pipeline...', '3 shot(s) in pipeline']);
        expect(document.getElementById('pipelineProviders').textContent).toMatch(/^Providers → LLM: claude, image: flux, video: veo, voice: gridlight, music: gridlight · change$/);
    });

    it('lists active runs, the history and the shots, a not-ready shot marked', async () => {
        await openPage();
        expect(document.querySelector('#pipelineActive').textContent).toMatch(/Active RunsSc1 \/ 1Agenerating/);
        expect([...document.querySelectorAll('#pipelineHistory tr')].map(r => r.textContent)).toEqual(['ShotSceneStatusDuration', '1BSc1approved4.2s', '2ASc2draft-']);
        expect([...shotSelect().options].map(o => [o.textContent, o.dataset.scene, o.dataset.ready])).toEqual([
            ['Sc1 / 1A', 'sc1', '1'], ['⚠ Sc1 / 1B', 'sc1', '0'], ['Sc2 / 2A', 'sc2', ''],
        ]);
    });

    it('the readiness card names what blocks each shot', async () => {
        await openPage();
        const card = document.querySelector('#pipelineReadiness .card');
        expect(card.textContent).toMatch(/^⚠ 1 shot\(s\) not locked — 1\/2 shots ready\. Strict mode will block these\./);
        expect(card.textContent).toMatch(/1B: lock MAYA; lock DINER/);
    });

    it('every empty state: no shots, no active run, no history, no readiness; a failed audit still loads', async () => {
        await openPage({ 'GET /projects/p1/status-board': { scenes: [] }, 'GET /projects/p1/consistency/audit': () => { throw new Error('x'); } });
        expect([...shotSelect().options].map(o => o.textContent)).toEqual(['No shots — create shots first']);
        expect(screen.getByText('No active pipeline runs.')).toBeTruthy();
        expect(screen.getByText('No pipeline history yet.')).toBeTruthy();
        expect(document.querySelector('#pipelineReadiness').children.length).toBe(0);
    });

    it('nothing without a project; an error says so', async () => {
        const none = installLegacy({ project: null });
        render(<PipelinePage />);
        await act(async () => { await window.loadPipeline(); });
        expect(none.calls).toEqual([]);
        const { status } = await openPage({ 'GET /projects/p1/status-board': () => { throw new Error('offline'); } });
        expect(status).toContain('Error: offline');
    });

    it('change goes to Settings', async () => {
        const { fake } = await openPage();
        fireEvent.click(screen.getByText('change'));
        expect(fake.navigateTo).toHaveBeenCalledWith('settings');
    });

    it('Strict consistency blocks a shot that is not locked, before any request', async () => {
        const { fake, status } = await openPage();
        fireEvent.change(shotSelect(), { target: { value: 'b' } });
        fireEvent.click(document.getElementById('pipelineStrict'));
        fireEvent.click(screen.getByText('Run shot (live)'));
        expect(screen.getByText('⛔ Strict consistency: shot not locked')).toBeTruthy();
        expect(status).toContain('Blocked by strict consistency');
        expect(fake.streamSSEPost).not.toHaveBeenCalled();
    });

    it('a live run streams: readiness warnings, the steps as they go, then done and a reload', async () => {
        const { fake, status, calls } = await openPage();
        fireEvent.click(screen.getByText('Run shot (live)'));
        const [path, body, onEvent, onDone] = fake.streamSSEPost.mock.calls[0];
        expect([path, body]).toEqual(['/shots/a/pipeline/run/stream', { strict: false }]);
        expect(screen.getByText('Starting Sc1 / 1A…')).toBeTruthy();
        act(() => onEvent({ type: 'readiness', ready: true, warnings: ['no voice for MAYA'] }));
        expect(screen.getByText('⚠ Consistency warnings')).toBeTruthy();
        expect(screen.getByText('Running Sc1 / 1A…')).toBeTruthy();
        act(() => onEvent({ type: 'status', steps: [{ id: 'img', name: 'Image' }, { id: 'vid', name: 'Video' }] }));
        act(() => onEvent({ type: 'step_start', step_id: 'img' }));
        expect(document.querySelector('[data-step="img"]').dataset.state).toBe('running');
        act(() => onEvent({ type: 'step_complete', step_id: 'img' }));
        act(() => onEvent({ type: 'step_failed', step_id: 'vid' }));
        expect([...document.querySelectorAll('[data-step]')].map(e => e.dataset.state)).toEqual(['complete', 'failed']);
        await act(async () => { onDone({}); });
        expect(screen.getByText('1 step(s) failed')).toBeTruthy();
        expect(status).toContain('Pipeline finished');
        await waitFor(() => expect(calls.filter(c => c.path === '/projects/p1/status-board').length).toBe(2));
    });

    it('a clean run says so; cancelled and stream errors are shown', async () => {
        const { fake } = await openPage();
        fireEvent.click(screen.getByText('Run shot (live)'));
        const [, , onEvent, onDone, onError] = fake.streamSSEPost.mock.calls[0];
        act(() => onEvent({ type: 'status', steps: [{ id: 'img', name: 'Image' }] }));
        act(() => onEvent({ type: 'step_complete', step_id: 'img' }));
        act(() => onEvent({ type: 'cancelled' }));
        expect(screen.getByText('Cancelled.')).toBeTruthy();
        act(() => onError(new Error('socket hang up')));
        expect(screen.getByText('Error: socket hang up')).toBeTruthy();
        await act(async () => { onDone({}); });
        expect(screen.getByText(/^Pipeline complete →\s+ready to assemble \/ Export$/)).toBeTruthy();
    });

    it('Run scene and Run project POST with the strict flag, and say when they are done', async () => {
        const { calls, status } = await openPage({ 'POST /scenes/sc2/pipeline/run': {}, 'POST /projects/p1/pipeline/run': {} });
        fireEvent.change(shotSelect(), { target: { value: 'c' } });
        fireEvent.click(document.getElementById('pipelineStrict'));
        await act(async () => { fireEvent.click(screen.getByText('Run scene')); });
        expect(calls.find(call=>call.method==='POST'&&call.path==='/scenes/sc2/pipeline/run')).toEqual({ method: 'POST', path: '/scenes/sc2/pipeline/run', body: { strict: true } });
        expect(status).toContain('scene pipeline complete');
        await act(async () => { fireEvent.click(screen.getByText('Run project')); });
        expect(calls.find(c => c.path === '/projects/p1/pipeline/run').body).toEqual({ strict: true });
        expect(status).toContain('project pipeline complete');
    });

    it('with no shot there is nothing to run', async () => {
        const { status, fake } = await openPage({ 'GET /projects/p1/status-board': { scenes: [] } });
        fireEvent.click(screen.getByText('Run shot (live)'));
        await act(async () => { fireEvent.click(screen.getByText('Run scene')); });
        expect(status).toContain('Pick a shot first');
        expect(status).toContain('Pick a shot to identify its scene');
        expect(fake.streamSSEPost).not.toHaveBeenCalled();
    });
});

describe('Pipeline staged final review',()=>{
 it('reopening discovers a persisted next review without starting any run',async()=>{const saved={run_id:'saved-run',status:'awaiting_review',next_review:{path:'/pipeline/saved-run/resume',body:{}}};const observed=[];window.__feObserveFinalRequestState=value=>observed.push(value);try{const {calls,fake}=await openPage({'GET /projects/p1/pipeline':{runs:[saved]}});expect(observed).toEqual([saved]);expect(calls.every(call=>call.method==='GET')).toBe(true);expect(fake.streamSSEPost).not.toHaveBeenCalled();}finally{delete window.__feObserveFinalRequestState;}});
 it('a saved waiting stream requires the next review instead of reporting completion',async()=>{const {fake,status}=await openPage();fireEvent.click(screen.getByText('Run shot (live)'));const [, ,onEvent,onDone]=fake.streamSSEPost.mock.calls[0];act(()=>onEvent({type:'status',steps:[{id:'img',name:'Image'}]}));act(()=>onEvent({type:'step_complete',step_id:'img'}));act(()=>onEvent({type:'result',run_id:'saved-run',status:'awaiting_review',next_review:{path:'/pipeline/saved-run/resume',body:{}}}));await act(async()=>onDone({type:'done'}));expect(screen.getByRole('status').textContent).toContain('Next request needs review');expect(screen.queryByText('Pipeline complete → ready to assemble / Export')).toBeNull();expect(status).toContain('Next request needs review');expect(status).not.toContain('Pipeline finished');});
 it('the existing held run updates on reviewed resume, without starting the original pipeline again',async()=>{const {fake,status}=await openPage();fireEvent.click(screen.getByText('Run shot (live)'));const [, ,onEvent]=fake.streamSSEPost.mock.calls[0];act(()=>onEvent({type:'result',run_id:'saved-run',status:'awaiting_review',next_review:{path:'/pipeline/saved-run/resume',body:{}}}));await act(async()=>window.dispatchEvent(new CustomEvent('fe-final-request-resumed',{detail:{run_id:'saved-run',status:'complete'}})));expect(fake.streamSSEPost).toHaveBeenCalledTimes(1);expect(screen.queryByText(/Completed steps are saved/)).toBeNull();expect(status).toContain('Pipeline complete');});
});
