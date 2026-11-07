import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import MainSheet from './MainSheet.jsx';

/*
 * The character sheet's top (MainSheet.jsx): every action on it, each against its route.
 *   the main picture and its variations (click one: it becomes the main); the description (edit, save);
 *   step 1 (the main picture prompt, Copy); step 2 (the medium shot picture → the sheet prompt; or one from before);
 *   step 3 (upload the finished sheet).
 */
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });
const SHEET = (main = 's1') => ({
    character: { id: 'c1', name: 'JUNE', appearance_prompt: 'Auburn hair pinned back.', description: 'A watchful young woman.', age_range: '25-30' },
    main: main ? { asset_id: main, image_url: `/film/refsheets/p1/${main}.png`, kind: 'sheet', main: true } : null,
    variations: [{ asset_id: 's2', image_url: '/film/refsheets/p1/s2.png', kind: 'sheet' }, { asset_id: 'v1', image_url: '/film/refsheets/p1/front.png', kind: 'front view' }].filter(v => v.asset_id !== main),
    studio_portraits: [{ asset_id: 'p9', image_url: '/film/refsheets/p1/studio.png', kind: 'studio portrait' }],
});
let L, sheet, later;
// What ChatGPT finishes: the next read of the sheet carries the prompt.
const finish = () => { for (const [k, text] of Object.entries(later)) sheet = { ...sheet, prompts: { ...sheet.prompts, [k]: { status: 'done', prompt: text, model: 'gpt-6-astra' } } }; later = {}; };
const tick = async (ms = 2100) => { await act(async () => { await new Promise(r => setTimeout(r, ms)); }); await flush(); };
function open(start = SHEET()) {
    sheet = start; later = {};
    L = installLegacy({ routes: {
        'GET /characters/c1/sheet': () => sheet,
        'PUT /characters/c1/sheet/main': b => (sheet = SHEET(b.asset_id)),
        'POST /characters/c1/sheet/upload': () => (sheet = { ...sheet, variations: [{ asset_id: 'up1', image_url: '/x.png', kind: 'sheet' }, ...sheet.variations] }),
        // A prompt is a job: started (writing), then done on a later read of the sheet.
        // Each in two lightings: the original soft, matte one and the natural one. The uploaded picture is kept by the first.
        ...Object.fromEntries(['main', 'main_natural', 'sheet', 'sheet_natural'].map(k => [`POST /characters/c1/sheet/prompt/${k}`, b => {
            const light = k.endsWith('_natural') ? ' [natural]' : '';
            sheet = { ...sheet, prompts: { ...sheet.prompts, [k]: { status: 'writing', started_at: '2026-10-23 12:00:00', studio_portrait_id: k === 'sheet' ? (b.asset_id || 'up-studio') : b.asset_id } } };
            later[k] = k.startsWith('main') ? `Medium shot studio photograph of a young woman. Photographed not generated.${light}` : `A three-panel character reference sheet… (${b.asset_id || b.name})${light}`;
            return { prompts: sheet.prompts };
        }])),
        'PUT /characters/c1': () => ({ ok: true }),
    } });
    return render(<MainSheet characterId="c1" />);
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); try { localStorage.clear(); } catch (_) { /* none */ } });

describe('Character sheet: the main picture, variations, description and the three steps', () => {
    it('shows the main picture (used for every generation) and the variations; clicking one makes it the main', async () => {
        open(); await flush();
        const main = screen.getByRole('region', { name: 'Main picture' });
        expect(main.querySelector('img').getAttribute('src')).toBe('http://api.test/film/refsheets/p1/s1.png');
        expect(main.textContent).toContain('Main · used for every generation');
        const vars = within(screen.getByRole('list', { name: 'Variations' })).getAllByRole('listitem');
        expect(vars.map(v => v.textContent)).toEqual(['sheet', 'front view']);
        await act(async () => { fireEvent.click(vars[0]); }); await flush();
        expect(L.calls.find(c => c.method === 'PUT' && c.path === '/characters/c1/sheet/main').body).toEqual({ asset_id: 's2' });
        expect(main.querySelector('img').getAttribute('src')).toBe('http://api.test/film/refsheets/p1/s2.png');
    });

    it('with no main yet, says how to make one', async () => {
        open(SHEET(null)); await flush();
        expect(screen.getByRole('region', { name: 'Main picture' }).textContent).toMatch(/No main picture yet/);
    });

    it('the description from the screenplay can be edited and saved', async () => {
        open(); await flush();
        expect(screen.getByRole('region', { name: 'Description and steps' }).textContent).toContain('Auburn hair pinned back.');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Edit' })); });
        fireEvent.change(screen.getByLabelText('Appearance'), { target: { value: 'Auburn hair, now cut short.' } });
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); }); await flush();
        expect(L.calls.find(c => c.method === 'PUT' && c.path === '/characters/c1').body).toEqual({ appearance_prompt: 'Auburn hair, now cut short.', description: 'A watchful young woman.' });
    });

    it('step 1 writes the main picture prompt in both lightings, side by side, each copied on its own', async () => {
        const writeText = vi.fn().mockResolvedValue(); vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
        open(); await flush();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write the prompts' })); }); await flush();
        expect(screen.getByRole('status').textContent).toMatch(/ChatGPT is writing the main picture prompt/);
        finish(); await tick();
        expect(L.calls.filter(c => c.method === 'POST').map(c => c.path)).toEqual(['/characters/c1/sheet/prompt/main', '/characters/c1/sheet/prompt/main_natural']);
        expect(screen.getByLabelText('Main picture prompt · Soft, matte light (current)').value).toBe('Medium shot studio photograph of a young woman. Photographed not generated.');
        expect(screen.getByLabelText('Main picture prompt · Natural light (new)').value).toMatch(/\[natural\]$/);
        await act(async () => { fireEvent.click(screen.getAllByRole('button', { name: 'Copy prompt' })[1]); });
        expect(writeText).toHaveBeenCalledWith('Medium shot studio photograph of a young woman. Photographed not generated. [natural]');
    });

    it('step 2 takes the medium shot picture and writes the sheet prompt; a picture from before can be reused', async () => {
        open(); await flush();
        const input = screen.getByLabelText('Medium shot studio picture');
        await act(async () => { fireEvent.change(input, { target: { files: [new File(['img'], 'studio.png', { type: 'image/png' })] } }); });
        await act(async () => { await new Promise(r => setTimeout(r, 30)); }); await flush();
        finish(); await tick();
        const posted = L.calls.find(c => c.path === '/characters/c1/sheet/prompt/sheet').body;
        expect(posted.name).toBe('studio.png');
        expect(posted.data).toMatch(/^data:image\/png;base64,/);
        expect(screen.getByLabelText('Character sheet prompt · Soft, matte light (current)').value).toBe('A three-panel character reference sheet… (studio.png)');
        // The natural-light one reads the same picture, the one the first kept, rather than uploading it twice.
        expect(L.calls.find(c => c.path === '/characters/c1/sheet/prompt/sheet_natural').body).toEqual({ asset_id: 'up-studio' });
        expect(screen.getByLabelText('Character sheet prompt · Natural light (new)').value).toBe('A three-panel character reference sheet… (up-studio) [natural]');
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'studio picture' })); }); await flush();
        finish(); await tick();
        expect(L.calls.filter(c => c.path === '/characters/c1/sheet/prompt/sheet').pop().body).toEqual({ asset_id: 'p9' });
        expect(L.calls.filter(c => c.path === '/characters/c1/sheet/prompt/sheet_natural').pop().body).toEqual({ asset_id: 'p9' });
    });

    it('step 3 uploads the finished sheet; it joins the variations', async () => {
        open(); await flush();
        await act(async () => { fireEvent.change(screen.getByLabelText('Finished character sheet'), { target: { files: [new File(['img'], 'june sheet.png', { type: 'image/png' })] } }); });
        await act(async () => { await new Promise(r => setTimeout(r, 30)); }); await flush();
        const posted = L.calls.find(c => c.path === '/characters/c1/sheet/upload').body;
        expect(posted.name).toBe('june sheet.png');
        expect(within(screen.getByRole('list', { name: 'Variations' })).getAllByRole('listitem')).toHaveLength(3);
    });

    // What happened: the director started a prompt, closed the sheet, came back.
    it('a prompt started, then the sheet left and opened again, shows when ChatGPT is done', async () => {
        const first = open(); await flush();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Write the prompts' })); }); await flush();
        first.unmount();
        render(<MainSheet characterId="c1" />); await flush();
        expect(screen.getByRole('status').textContent).toMatch(/ChatGPT is writing the main picture prompt.*you can close the sheet/);
        expect(screen.getByRole('button', { name: 'Writing…' }).disabled).toBe(true);
        finish(); await tick();
        expect(screen.getByLabelText('Main picture prompt · Soft, matte light (current)').value).toMatch(/^Medium shot studio photograph/);
    });

    it('a failure is said, and a prompt from before (kept in this window only) still shows', async () => {
        const kept = { 'fe-cs-sheet-c1': 'An older sheet prompt' };
        vi.stubGlobal('localStorage', { getItem: k => kept[k] ?? null, setItem: (k, v) => { kept[k] = v; }, clear: () => {} });
        open({ ...SHEET(), prompts: { main: { status: 'failed', error: 'ChatGPT is not signed in' } } }); await flush();
        expect(screen.getAllByRole('alert')[0].textContent).toMatch(/Soft, matte light \(current\): the last try failed: ChatGPT is not signed in/);
        expect(screen.getByLabelText('Character sheet prompt · Soft, matte light (current)').value).toBe('An older sheet prompt');
    });
});
