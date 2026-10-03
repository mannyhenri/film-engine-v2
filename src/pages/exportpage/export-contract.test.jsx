/*
 * Two backend sub-tests read Export's legacy functions out of the page script, which a React page
 * does not have: premiere-scenes.test.js "an agent and a person can both reach it" and
 * delivery-quality.test.js "the page sets the codec, audio and drafting, applies presets through the
 * server, and shows the delivery decision". Both are skipped (SKIPPED-SUBTESTS.json) and EVERY one of
 * their assertions is held here: the legacy halves (Settings' delivery controls, deliveryLineHtml,
 * confirmPaidImage) against the same reassembled page they read (src/index.html, built by
 * tools/assemble-page.js before npm test), and Export's half as behaviour of the React page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ExportPage from './ExportPage.jsx';

const ROOT = path.resolve(__dirname, '../../..');
const require_ = createRequire(import.meta.url);
const backend = (m) => require_(path.join(ROOT, 'backend', m));
const page = () => fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
/** A function's source, by brace depth (as the backend test reads it). */
function pageFn(src, name) {
    const at = src.indexOf(`function ${name}(`);
    expect(at, `${name} is on the page`).toBeGreaterThan(-1);
    const i = src.indexOf('{', src.indexOf(')', at));
    let depth = 0, j = i;
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    return src.slice(at, j + 1);
}
afterEach(() => vi.restoreAllMocks());

describe('premiere-scenes: an agent and a person can both reach it (moved)', () => {
    it('the MCP tools exist, and the page plans then POSTs export/premiere-scenes', async () => {
        const tools = backend('lib/mcp-tools');
        const names = new Set((tools.TOOLS || tools.listTools()).map(t => t.name));
        expect(names.has('export_premiere_scenes_plan') && names.has('export_premiere_scenes')).toBe(true);
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const url = '/projects/p1/export/premiere-scenes';
        const { calls } = installLegacy({ routes: {
            'GET /projects/p1/shotlist': { shots: [] }, 'GET /projects/p1/delivery-check': { shots: [] },
            [`GET ${url}`]: { file_count: 0, scenes: [], missing: [] }, [`POST ${url}`]: { dest: 'x', copied: 0, xml: 'y' },
        } });
        render(<ExportPage />);
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make the folders' })); });
        expect(calls.map(c => `${c.method} ${c.path}`)).toEqual([`GET ${url}`, `POST ${url}`]);
    });
});

describe('delivery-quality: the delivery controls, presets and decision (moved)', () => {
    it('Settings offers every codec and preset, saves and shows the delivery fields, presets go through the server', () => {
        const src = page();
        const { CODECS } = backend('lib/delivery-quality');
        const { DELIVERY_PRESETS } = backend('lib/project-presets');
        const codecSel = /<select id="settingsDeliveryCodec">([\s\S]*?)<\/select>/.exec(src);
        expect(codecSel, 'a delivery codec control').toBeTruthy();
        for (const id of Object.keys(CODECS)) expect(codecSel[1]).toContain(`value="${id}"`);
        const presetSel = /<select id="settingsDeliveryPreset"[^>]*>([\s\S]*?)<\/select>/.exec(src);
        const presetIds = Array.isArray(DELIVERY_PRESETS) ? DELIVERY_PRESETS.map(p => p.id) : Object.keys(DELIVERY_PRESETS);
        for (const id of presetIds) expect(presetSel[1]).toContain(`value="${id}"`);
        const save = pageFn(src, 'saveTechnicalSettings');
        for (const f of ['delivery_codec', 'delivery_audio_channels', 'video_draft']) expect(save).toContain(f);
        const load = pageFn(src, 'loadTechnicalSettings');
        for (const f of ['delivery_codec', 'delivery_audio_channels', 'draft_video']) expect(load).toContain(f);
        expect(pageFn(src, 'applyDeliveryPreset')).toMatch(/settings\/preset/);
    });

    it('the delivery line, executed, and the paid confirmation renders it', () => {
        const src = page();
        // eslint-disable-next-line no-new-func
        const line = new Function('esc', pageFn(src, 'deliveryLineHtml') + '; return deliveryLineHtml;')(s => String(s));
        expect(line(null)).toBe('');
        const down = line({ asked: '3840x2160', delivered: '1280x720', downgraded: true, why: 'its best' });
        expect(down).toMatch(/below delivery/); expect(down).toMatch(/1280x720/);
        expect(line({ asked: '1920x1080', delivered: '1920x1080', downgraded: false })).toMatch(/full size/);
        expect(pageFn(src, 'confirmPaidImage')).toMatch(/deliveryLineHtml\(d\.delivery\)/);
        expect(fs.readFileSync(path.join(ROOT, 'backend/routes/video-gen.js'), 'utf8')).toMatch(/\n\s+delivery,\n/);
    });

    it('Export loads the delivery check from /delivery-check into #exportDeliveryCheck', async () => {
        const { calls } = installLegacy({ routes: { 'GET /projects/p1/shotlist': { shots: [] }, 'GET /projects/p1/delivery-check': { asked: '1920x1080', shots: [] } } });
        render(<ExportPage />);
        await act(async () => { await window.loadExportPage(); });
        expect(calls.map(c => c.path)).toEqual(['/projects/p1/shotlist', '/projects/p1/delivery-check']);
        expect(document.getElementById('exportDeliveryCheck').textContent).toMatch(/Delivers 1920x1080/);
    });
});
