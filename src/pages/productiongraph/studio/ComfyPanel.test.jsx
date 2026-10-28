import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, act, screen, cleanup, within } from '@testing-library/react';
import { installLegacy } from '../../../test/setup.js';
import ComfyPanel, { splitLabel, defaultChoices, stageText, timeLeft } from './ComfyPanel.jsx';

/*
 * Direct › Generate › My PC against the options the PC's workflow really lists (storyboard_shot_to_video.fe.json,
 * as GET /film/comfyui/workflows answers it): every choice of every option is a button, every one reaches the
 * request; the length covering the shot is picked; the PC being away and a take coming back both read plainly.
 */
const enumOpt = (id, label, labels) => ({ id, label, type: 'enum', choices: labels.map((l, index) => ({ label: l, index })), default: 0 });
const OPTIONS = [
    enumOpt('aspect', 'Aspect ratio', ['16:9 (864x480)', '9:16 (480x864)', '1:1 (480x480)', '2.39:1 (1152x480)']),
    enumOpt('duration', 'Duration', ['5 s', '8 s', '10 s', '15 s']),
    enumOpt('quality', 'Quality', ['Turbo 4-step (draft)', 'Full 20-step (final)']),
    enumOpt('color', 'Color', ['SDR (standard)', 'HDR (HLG, 10-bit)']),
];
const WF = { slug: 'storyboard_shot_to_video', name: 'Storyboard shot to video (draft 480p)', kind: 'video', ready: true, problems: [], options: OPTIONS };
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

let posted, onFiled;
function open({ ok = true, job = null } = {}) {
    posted = [];
    onFiled = vi.fn();
    installLegacy({ routes: {
        'GET /comfyui/status': ok ? { ok: true, url: 'http://192.168.4.60:8188', version: '0.43.1' } : { ok: false, url: 'http://192.168.4.60:8188', error: 'not answering' },
        'GET /comfyui/workflows': { workflows: [WF] },
        'POST /projects/p1/production-studio/comfyui': (b) => { posted.push(b); return { jobs: [{ id: 'j1', label: 'Take 1', status: 'queued', stage_label: 'Waiting on the PC', position: 1 }], note: null }; },
        'GET /comfyui/jobs/j1': () => ({ job: job || { id: 'j1', label: 'Take 1', status: 'running', stage_label: 'Generating' } }),
    } });
    return render(<ComfyPanel pid="p1" unit={() => ({ label: '1A', prompt: 'p', shots: [{ shot_id: 's1' }] })} codeLabel="1A" dur={6}
        names={['June', 'The Diner']} hasFrame lineCount={1} dialogueName="" onFiled={onFiled} onUseHiggsfield={vi.fn()} />);
}
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ComfyPanel', () => {
    it('splits a choice into what you pick by and the detail under it', () => {
        expect(splitLabel('16:9 (864x480)')).toEqual(['16:9', '864x480']);
        expect(splitLabel('5 s')).toEqual(['5 s', '']);
    });

    it('says where every take is, in plain words, for every state the server reports', () => {
        const cases = [
            [{ status: 'uploading', stage_label: 'Sending the inputs' }, 'Sending the inputs'],
            [{ status: 'queued', stage_label: 'Waiting on the PC', position: 1 }, 'Waiting on the PC'],
            [{ status: 'queued', stage_label: 'Waiting on the PC', position: 3 }, 'Waiting on the PC · 2 ahead'],
            [{ status: 'running', stage_label: 'Generating' }, 'Generating'],
            [{ status: 'running', stage_label: 'Generating', progress: { value: 1, max: 4, eta_s: 3284 } }, 'Step 1 of 4 · about 55 min left'],
            [{ status: 'running', stage_label: 'Generating', progress: { value: 3, max: 4, eta_s: 40 } }, 'Step 3 of 4 · under 2 min left'],
            [{ status: 'running', stage_label: 'Generating', progress: { value: 0, max: 4, eta_s: null } }, 'Step 0 of 4'],
            [{ status: 'downloading', stage_label: 'Bringing it back' }, 'Bringing it back'],
            [{ status: 'failed', stage_label: 'Failed' }, 'Failed'],
        ];
        for (const [job, text] of cases) expect(stageText(job)).toBe(text);
        expect(timeLeft(7200)).toBe('about 2.0 h left');
    });

    it('starts on the length that covers the shot, and the workflow default for the rest', () => {
        expect(defaultChoices(OPTIONS, 6)).toEqual({ aspect: '16:9 (864x480)', duration: '8 s', quality: 'Turbo 4-step (draft)', color: 'SDR (standard)' });
        expect(defaultChoices(OPTIONS, 20).duration).toBe('15 s');
    });

    it('every choice of every option is a button, and each one picked reaches the request', async () => {
        open();
        await flush();
        for (const o of OPTIONS) {
            for (const c of o.choices) {
                const group = screen.getByRole('group', { name: o.label });
                const [main] = splitLabel(c.label);
                fireEvent.click(within(group).getByRole('button', { name: new RegExp('^' + main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }));
                fireEvent.click(screen.getByRole('button', { name: /^Make \d (draft|take)s?$/ }));
                await flush();
                expect(posted.at(-1).options[o.id]).toBe(c.label);
                expect(posted.at(-1).workflow).toBe('storyboard_shot_to_video');
                cleanup(); open(); await flush();
            }
        }
    });

    it('says what goes in, and the length hint when it differs from the shot', async () => {
        open();
        await flush();
        expect(screen.getByText('Starts from the storyboard frame of 1A')).toBeTruthy();
        expect(screen.getByText(/Dialogue: 1 line, spoken and lip-synced/)).toBeTruthy();
        expect(screen.getByText('The shot is 6 s. Trim the extra in Cut.')).toBeTruthy();
        fireEvent.click(within(screen.getByRole('group', { name: 'Duration' })).getByRole('button', { name: /^5 s/ }));
        expect(screen.getByText('The shot is 6 s, so the last 1 s will be missing.')).toBeTruthy();
    });

    it('the PC not answering is said plainly, with a way out', async () => {
        open({ ok: false });
        await flush();
        expect(screen.getByText("Your PC isn't answering")).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Use Higgsfield instead' })).toBeTruthy();
    });

    it('a take that comes back plays, says where it went, and reloads Direct', async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        open({ job: { id: 'j1', label: 'Take 1', status: 'done', stage_label: 'Done', filed: { version: 3, url: '/film/video/p1/1A_comfyui_v3.mp4' } } });
        await flush();
        fireEvent.click(screen.getByRole('button', { name: 'Make 2 drafts' }));
        await flush();
        expect(screen.getByText(/Making 1 draft/)).toBeTruthy();
        await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
        await flush();
        expect(screen.getByText('Added to 1A as version 3')).toBeTruthy();
        expect(document.querySelector('video.cf-video').getAttribute('src')).toBe('/film/video/p1/1A_comfyui_v3.mp4');
        expect(onFiled).toHaveBeenCalledTimes(1);
    });
});
