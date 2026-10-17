import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, screen, within, cleanup } from '@testing-library/react';
import path from 'path';
import { createRequire } from 'module';
import { installLegacy } from '../../../test/setup.js';
import ProductionStudio from './ProductionStudio.jsx';
import BASE from '../fixtures/graph.json';
import * as backendless from './direct-model.js';

/*
 * The Generate and Cut tabs, against the backend's OWN registries: every
 * Higgsfield video model the server lists must be selectable; in Cut, every
 * picture state a shot can be in shows as itself and every sound kind the cut
 * route takes can be wired, given a file in its own place, and (where it can)
 * generated. A page wired for a handful of models or kinds fails here.
 */
const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '../../../..');
const backend = (m) => require_(path.join(ROOT, 'backend', m));
const MODELS = backend('lib/video-model-facts.js').allFacts();
const CUT_KINDS_SERVER = backend('lib/production-cuts.js').KINDS;
const MEDIA_KINDS = backend('lib/media-kinds.js').MEDIA_KINDS;
const rec = backend('lib/model-recommender.js');
const catalog = backend('lib/higgsfield-catalog.js');
const RUNWAY = backend('lib/runway-catalog.js').runwayModels();

const P = BASE.project_id;
const [A, B] = BASE.nodes.filter(n => n.type === 'shot');
const SEQ = BASE.nodes.find(n => n.type === 'sequence');
const GRAPH = JSON.parse(JSON.stringify(BASE));
const shotA = GRAPH.nodes.find(n => n.id === A.id);
shotA.videos = [{ asset_id: 'vid-a', url: '/film/videos/p/1A.mp4', path: '/films/Demo/04 Video/Clips/1A.mp4', duration_ms: 4000, provider: 'higgsfield', model: 'seedance-2-5', created_at: '2026-10-14' }];
shotA.selected_video_asset_id = 'vid-a';
shotA.dialogue_lines = 1;
GRAPH.nodes.find(n => n.id === SEQ.id).audio_tracks = [{ id: 'trk-1', asset_id: 'mus-1', offset_ms: 0, duration_ms: 7000, source: { path: '/films/Demo/06 Sound/Music and Effects/theme.wav', asset_type: 'audio_music' } }];

// 1B has only its storyboard frame (a board); 1C has nothing yet. 1A (above) has a clip.
const shotB = GRAPH.nodes.find(n => n.id === B.id);
shotB.frames = [{ asset_id: 'frame-b', url: '/film/storyboards/p/1B.png', selected: true }];
const C = { ...JSON.parse(JSON.stringify(shotB)), id: '00000000-0000-4000-8000-0000000000b3', key: 'shot:00000000-0000-4000-8000-0000000000b3', shot_code: '1C', frames: [], videos: [], sequence_id: null };
GRAPH.nodes.push(C);
GRAPH.running_order = [...(GRAPH.running_order || []), C.id];
const enc = (k) => encodeURIComponent(k);
const STARTER = (code) => ({ recipe: { provider: 'runway', model: 'gen4.5', prompt: `Composed prompt for ${code}`,
    reference_images: [{ asset_id: 'plate-char', reference_role: 'character', name: 'Mara' }, { asset_id: 'plate-loc', reference_role: 'location', name: 'Diner' }],
    init_image: { asset_id: `frame-${code}`, reference_role: 'keyframe' } } });

const CARD_A = { description: 'Mara waits at the table.', direction: 'Mara sits alone at the table, watching the door. Joe comes in.', notes: '', dialogue: [{ character: 'MARA', line: 'Where were you?' }, { character: 'JOE', line: 'Out.' }],
    characters: ['MARA', 'JOE'], camera: { lens: '35mm', movement: 'push-in', shot_type: 'close-up' }, lighting: { notes: 'One bulb over the table.' }, sfx_cues: [], end_state: 'Joe in the doorway.', duration_s: 6 };
const CARD_B = { description: 'Wide of the kitchen.', direction: '', notes: '', dialogue: [], characters: ['JOE'], camera: { shot_type: 'wide', movement: 'static' }, lighting: {}, sfx_cues: [], end_state: '', duration_s: 3 };
const DIRECTION = { shots: { [A.id]: { card: CARD_A, direction: null, revision: 0 }, [B.id]: { card: CARD_B, direction: null, revision: 0 } },
    cast: [{ id: 'char-joe', name: 'JOE', age: '50' }, { id: 'char-mara', name: 'MARA', age: '34' }],
    scenes: { [A.scene_id]: { number: 1, heading: 'INT. KITCHEN', time_of_day: 'NIGHT', setting: '', light: '', atmosphere: '', sound: 'diner hum' } }, studio: null, studio_revision: 0 };
const SEEDED_A = () => backendless.seedShot(CARD_A, 6);
const wait = (ms) => act(() => new Promise(r => setTimeout(r, ms)));

function open(extra = {}) {
    const routes = {
        'GET /production-studio/higgsfield-models': { models: MODELS, connected: true, website_models:catalog.websiteModels(),api_modes:catalog.apiModes() },
        [`GET /projects/${P}/production-graph/nodes/${enc(A.key)}/draft/starter?kind=video&provider=higgsfield`]: STARTER('1A'),
        [`GET /projects/${P}/production-graph/nodes/${enc(B.key)}/draft/starter?kind=video&provider=higgsfield`]: STARTER('1B'),
        [`POST /projects/${P}/production-studio/recommend`]: (body) => rec.recommend(body),
        [`POST /projects/${P}/production-studio/optimize-prompt`]: (body) => ({ prompt: `OPTIMIZED for ${body.model_id}`, changes: ['Camera move first'] }),
        [`GET /projects/${P}/production-graph/nodes/${enc(A.key)}/draft`]: { draft: null },
        [`GET /projects/${P}/production-graph/nodes/${enc(SEQ.key)}/draft`]: { draft: { revision: 3 } },
        [`PUT /projects/${P}/production-graph/nodes/${enc(A.key)}/draft`]: { draft: { revision: 1 } },
        [`PUT /projects/${P}/production-graph/nodes/${enc(SEQ.key)}/draft`]: { draft: { revision: 4 } },
        [`POST /shots/${A.id}/video/generate`]: { status: 'submitted', job_id: 'j1' },
        [`POST /sequences/${SEQ.id}/generate-native`]: { status: 'complete' },
        [`POST /projects/${P}/production-studio/send-to-resolve`]: { imported_into_resolve: true, dest: '/films/Demo/07 Delivery/Exports/Demo_Resolve', copied: 5, launch: { imported: true } },
        'PUT /providers/higgsfield/credentials': { ok: true },
        [`GET /projects/${P}/production-studio/direction`]: DIRECTION,
        'GET /production-studio/runway-models': { models: RUNWAY, connected: true, usd_per_credit: 0.01 },
        [`PUT /projects/${P}/production-studio/direction/studio`]: { revision: 1 },
        [`PUT /projects/${P}/production-studio/direction/shots/${A.id}`]: { revision: 1 },
        [`PUT /projects/${P}/production-studio/direction/shots/${B.id}`]: { revision: 1 },
        [`PUT /shots/${A.id}`]: { ok: true },
        ...extra,
    };
    const legacy = installLegacy({ routes, project: { id: P } });
    const reload = vi.fn(async () => {});
    const view = render(<ProductionStudio graph={GRAPH} reload={reload} />);
    return { legacy, view, calls: legacy.calls };
}
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    // jsdom has no media playback; the preview only asks a take to play and pause.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Production Studio: tabs', () => {
    it('opens on Generate, Cut is one click away, and there is no classic graph tab', async () => {
        open(); await flush();
        expect(screen.getByRole('tab', { name: 'Generate' }).getAttribute('aria-selected')).toBe('true');
        expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Generate', 'Cut']);
    });
});

describe('Generate (Direct studio): pick, direct, watch the prompt, check, send', () => {
    const board = () => screen.getByRole('complementary', { name: 'Storyboard' });
    const direct = () => screen.getByRole('complementary', { name: 'Direct' });
    const prompt = () => screen.getByRole('region', { name: 'Prompt' });
    const pick = async (code) => { await act(async () => { fireEvent.click(within(board()).getByRole('button', { name: new RegExp(code) })); }); await flush(); };
    const click = async (el) => { await act(async () => { fireEvent.click(el); }); await flush(); };

    it('lists every website model and API mode, preserving exact names and IDs', async () => {
        const { view } = open(); await flush(); await pick('1A');
        expect([...view.container.querySelectorAll('[data-website-model]')].map(n => n.dataset.websiteModel).sort()).toEqual(catalog.websiteModels().map(m => m.id).sort());
        expect([...view.container.querySelectorAll('[data-api-mode]')].map(n => n.dataset.apiMode).sort()).toEqual(catalog.apiModes().map(m => m.id).sort());
    });

    it('website-only models open Higgsfield without saving or submitting an API draft', async () => {
        const { calls } = open(); await flush(); await pick('1A');
        fireEvent.change(screen.getByLabelText('Send to Higgsfield model'), { target: { value: 'website:flux_3_video' } });
        expect(screen.getByRole('link', { name: 'Open FLUX 3 Video on Higgsfield' }).href).toContain('model=flux_3_video');
        expect(calls.some(c => c.method === 'PUT' && c.path.endsWith('/draft'))).toBe(false);
    });

    it('every Higgsfield video model the server lists can be chosen to send to', async () => {
        open(); await flush(); await pick('1A');
        const offered = [...screen.getByLabelText('Send to Higgsfield model').querySelectorAll('option')].map(o => o.value);
        expect(MODELS.length).toBeGreaterThan(20);
        expect(MODELS.map(m => m.id).filter(id => !offered.includes(id))).toEqual([]);
    });

    it("picking a shot compiles the card's lines into a live prompt, one paragraph per beat, and asks for a recommendation from it", async () => {
        const { calls } = open(); await flush();
        expect(within(prompt()).getByText(/one paragraph per beat/)).toBeTruthy();
        await pick('1A'); await wait(600);
        const text = prompt().textContent;
        expect(text).toContain('Mara (@image1)');
        expect(text).toContain('{MARA: “Where were you?”}');
        expect(text).toContain('{JOE: “Out.”}');
        expect(text).toMatch(/0:00–0:00\.5.*Framing: close-up, eye height, 35mm/);
        expect(text.indexOf('Where were you?')).toBeLessThan(text.indexOf('Out.'));
        const asked = calls.filter(c => c.path === `/projects/${P}/production-studio/recommend`).pop();
        expect(asked.body).toMatchObject({ shot_count: 1, reference_count: 2, has_start_frame: true, dialogue: true, duration_s: 6 });
        expect(asked.body.prompt).toContain('Where were you?');
        expect(within(direct()).getAllByRole('button', { pressed: true }).length).toBeGreaterThan(0);
    });

    it('a picture the pipeline would attach but no project file matches is named, never dropped in silence', async () => {
        const starter = STARTER('1A');
        starter.recipe.reference_images.push({ unresolved: true, reference_role: 'image_reference', order: 4 });
        open({ [`GET /projects/${P}/production-graph/nodes/${enc(A.key)}/draft/starter?kind=video&provider=higgsfield`]: { ...starter, unresolved: [{ order: 4, reason: 'no match' }] } });
        await flush(); await pick('1A');
        expect(screen.getByText(/References · 3/)).toBeTruthy();
        expect(screen.getByText(/1 picture the pipeline would attach could not be matched to a project file/)).toBeTruthy();
    });

    it('choosing a model chip selects it for sending, and Optimize rewrites for it into the editable text', async () => {
        const { calls } = open(); await flush(); await pick('1A'); await wait(600);
        const gen = within(direct()).getByRole('heading', { name: 'Generate' }).closest('.ds-gen');
        const chips = gen.querySelectorAll('.ds-chips .ds-chip');
        expect(chips.length).toBeGreaterThan(1);
        await click(chips[1]);
        const id = screen.getByLabelText('Send to Higgsfield model').value;
        expect(chips[1].getAttribute('aria-pressed')).toBe('true');
        await click(within(prompt()).getByRole('button', { name: 'Optimize with AI' }));
        expect(screen.getByLabelText(/Your text is what gets sent/).value).toBe(`OPTIMIZED for ${id}`);
        expect(calls.find(c => c.path.endsWith('/optimize-prompt')).body).toMatchObject({ model_id: id });
        expect(calls.find(c => c.path.endsWith('/optimize-prompt')).body.prompt).toContain('Where were you?');
    });

    it('Send saves a Higgsfield draft with the compiled prompt and generates from that saved revision', async () => {
        const { calls } = open(); await flush(); await pick('1A'); await wait(600);
        const model = screen.getByLabelText('Send to Higgsfield model').value;
        await click(screen.getByRole('button', { name: /^Generate 1A · / }));
        const put = calls.find(c => c.method === 'PUT' && c.path.endsWith(`${enc(A.key)}/draft`));
        expect(put.body.payload.video).toMatchObject({ provider: 'higgsfield', model, init_image: { asset_id: 'frame-1A' }, settings: { duration_s: 6 } });
        expect(put.body.payload.video.prompt).toContain('{MARA: “Where were you?”}');
        expect(put.body.expected_revision).toBe(0);
        expect(calls.find(c => c.path === `/shots/${A.id}/video/generate`).body).toEqual({ production_draft: { node_key: A.key, revision: 1 } });
    });

    it('grouping makes a sequence: transitions between shots, one clip or separate, and one clip generates as that sequence', async () => {
        const { calls } = open(); await flush(); await pick('1A'); await pick('1B');
        await click(within(board()).getByRole('button', { name: 'Group 2 shots as a sequence' }));
        expect(within(direct()).getByText('Between shots')).toBeTruthy();
        await click(within(direct()).getByRole('button', { name: 'Continuous' }));
        await click(within(direct()).getByRole('button', { name: /Hard cut/ }));
        await click(within(direct()).getByRole('button', { name: 'Sequence' }));
        await click(within(direct()).getByRole('button', { name: /^One clip/ }));
        await wait(600);
        const text = prompt().textContent;
        expect(text).toContain('Sequence as one clip · 9s');
        expect(text).toMatch(/Out\.”}.*Hard cut\..*Framing: wide/);
        await click(screen.getByRole('button', { name: /^Generate the sequence · / }));
        expect(calls.some(c => c.method === 'POST' && c.path === `/projects/${P}/sequences`)).toBe(false);
        expect(calls.find(c => c.method === 'PUT' && c.path.endsWith(`${enc(SEQ.key)}/draft`)).body.expected_revision).toBe(3);
        expect(calls.find(c => c.path === `/sequences/${SEQ.id}/generate-native`).body).toEqual({ production_draft: { node_key: SEQ.key, revision: 4 } });
        const studio = calls.filter(c => c.method === 'PUT' && c.path.endsWith('/direction/studio')).pop();
        expect(studio.body.data).toMatchObject({ grouped: true, mode: 'one', order: [A.id, B.id] });
    });

    it('a character takes any of the emotions at any intensity; its beats land in the prompt at their time and are saved on the shot', async () => {
        const { calls } = open(); await flush(); await pick('1A');
        await click(within(direct()).getByRole('button', { name: /^Mara/ }));
        expect(within(direct()).getByText(/66 emotions/)).toBeTruthy();
        await click(within(direct()).getByRole('button', { name: /^Hurt/ }));
        await click(within(direct()).getByRole('button', { name: 'Explosive' }));
        const text = prompt().textContent;
        expect(text).toMatch(/Mara's face flinches, then freezes, uncontrolled\./);
        expect(text).toContain('MARA (overwhelming hurt)');
        await wait(700);
        const saved = calls.filter(c => c.method === 'PUT' && c.path.endsWith(`/direction/shots/${A.id}`)).pop();
        expect(saved.body.data.perf.MARA).toMatchObject({ emo: 'Hurt', inten: 5 });
        // An edited beat survives a change of emotion.
        const beat = within(direct()).getAllByLabelText('Acting beat')[0];
        await act(async () => { fireEvent.change(beat, { target: { value: 'Mara grips the table' } }); }); await flush();
        await click(within(direct()).getByRole('button', { name: /^Relief/ }));
        expect(prompt().textContent).toContain('Mara grips the table.');
        expect(prompt().textContent).toContain('breath goes out in one long exhale');
    });

    it('a shot takes several camera moves from the full library; each can be changed, and the prompt says them at their beat', async () => {
        open(); await flush(); await pick('1A');
        await click(within(direct()).getByRole('tab', { name: 'Camera' }));
        expect(within(direct()).getByText('Moves in this shot · 1')).toBeTruthy();
        await click(within(direct()).getByRole('button', { name: '+ Add move' }));
        expect(within(direct()).getAllByRole('button').filter(b => b.closest('.ds-lib') && b.classList.contains('ds-opt')).length).toBe(51);
        await click(within(direct()).getByRole('button', { name: /^Rack focus/ }));
        expect(prompt().textContent).toContain('Focus pulls from the foreground to the subject.');
        await click(within(direct()).getByRole('button', { name: 'Change move' }));
        await click(within(direct()).getByRole('button', { name: /^Orbit clockwise/ }));
        expect(prompt().textContent).toContain('orbits clockwise around the subject');
        const camLane = screen.getByRole('region', { name: 'Timeline' });
        expect(within(camLane).getByRole('button', { name: 'Orbit clockwise' })).toBeTruthy();
        expect(within(camLane).getByRole('button', { name: 'Dolly in' })).toBeTruthy();
    });

    it('screenplay lines are never locked: an edit is used at once and marked, and the screenplay changes only on confirmation', async () => {
        const { calls } = open(); await flush(); await pick('1A');
        await click(within(direct()).getByRole('tab', { name: 'Dialogue' }));
        const line = within(direct()).getAllByLabelText('Line text')[0];
        await act(async () => { fireEvent.change(line, { target: { value: 'Where have you been?' } }); }); await flush();
        expect(prompt().textContent).toContain('{MARA: “Where have you been?”}');
        expect(within(direct()).getByText('Changed from screenplay')).toBeTruthy();
        await click(within(direct()).getAllByRole('button', { name: 'More' })[0]);
        await click(within(direct()).getByRole('button', { name: 'Also update the screenplay…' }));
        expect(calls.some(c => c.path === `/shots/${A.id}`)).toBe(false);
        await click(within(direct()).getByRole('button', { name: 'Update the screenplay' }));
        expect(calls.find(c => c.method === 'PUT' && c.path === `/shots/${A.id}`).body).toEqual({ dialogue: [{ character: 'MARA', line: 'Where have you been?' }, { character: 'JOE', line: 'Out.' }] });
    });

    it('sounds are added at the playhead from the timeline, edited, and written into the beat they fall in', async () => {
        open(); await flush(); await pick('1A');
        fireEvent.click(screen.getByTestId('ds-ruler'), { clientX: 0 });
        await click(screen.getByRole('button', { name: '+ Sound at playhead' }));
        await act(async () => { fireEvent.change(within(direct()).getByLabelText('What we hear'), { target: { value: 'a chair scrapes' } }); }); await flush();
        expect(prompt().textContent).toMatch(/0:00–0:00\.5.*<a chair scrapes>/);
        await click(within(direct()).getByRole('button', { name: 'Remove' }));
        expect(prompt().textContent).not.toContain('a chair scrapes');
        await click(screen.getByRole('button', { name: /Ambience: diner hum/ }));
        await act(async () => { fireEvent.change(within(direct()).getByLabelText('Room and world sound'), { target: { value: 'rain on the roof' } }); }); await flush();
        expect(prompt().textContent).toContain('<rain on the roof, under everything>');
    });

    it('the timeline plays: the playhead moves, captions show the line being spoken', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        try {
            open(); await flush(); await pick('1A');
            await click(screen.getByRole('button', { name: 'Play' }));
            await act(async () => { vi.advanceTimersByTime(1000); });
            expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
            expect(document.querySelector('.ds-sub').textContent).toBe('Mara: Where were you?');
            expect(document.querySelector('.ds-tc').textContent).toBe('0:01');
        } finally { vi.useRealTimers(); }
    });

    it('a sequence longer than the model can make is a red check with fixes, and the button will not spend', async () => {
        open(); await flush(); await pick('1A'); await pick('1B');
        await click(within(board()).getByRole('button', { name: 'Group 2 shots as a sequence' }));
        await click(within(direct()).getByRole('button', { name: /^One clip/ }));
        fireEvent.change(screen.getByLabelText('Send to Higgsfield model'), { target: { value: 'kling-2-5-turbo-pro' } }); await flush();
        for (let i = 0; i < 3; i++) await click(within(direct()).getAllByRole('button', { name: 'Longer' })[0]);
        expect(within(direct()).getByText(/1A\+1B is 12s\. Kling 2\.5 Turbo \(pro\) makes at most 10s/)).toBeTruthy();
        const btn = screen.getByRole('button', { name: 'Fix the red item to generate' });
        expect(btn.disabled).toBe(true);
        await click(within(direct()).getByRole('button', { name: 'Generate as separate shots' }));
        expect(screen.queryByText(/makes at most 10s/)).toBeNull();
    });

    it("a saved direction comes back as it was left: the shot's lines and moves, the picked shots", async () => {
        const saved = { ...DIRECTION, studio: { picked: [A.id], grouped: false, order: [], mode: 'sep', bracket: false, music: { on: false, text: '' }, ages: {}, settings: {}, hand: null, aspect: '16:9', resolution: '', audio: true, model: '' },
            shots: { ...DIRECTION.shots, [A.id]: { ...DIRECTION.shots[A.id], direction: { ...SEEDED_A(), lines: [{ id: 'l1', ch: 'MARA', text: 'Saved line.', orig: 'Where were you?', t: 1, del: '', pause: 0, src: 'native' }] }, revision: 2 } } };
        open({ [`GET /projects/${P}/production-studio/direction`]: saved }); await flush();
        expect(prompt().textContent).toContain('Mara says: “Saved line.”');
    });

    it('Runway is a provider at the bottom: same ranking, its twins of the ranked models, its own credits, and Send goes to Runway', async () => {
        const { calls } = open(); await flush(); await pick('1A'); await wait(600);
        const gen = () => within(direct()).getByRole('heading', { name: 'Generate' }).closest('.ds-gen');
        const hfChips = [...gen().querySelectorAll('.ds-chips .ds-chip')].map(c => c.firstChild.textContent);
        await click(within(gen()).getByRole('button', { name: 'Runway' }));
        const rwChips = [...gen().querySelectorAll('.ds-chips .ds-chip')].map(c => c.firstChild.textContent);
        const twins = hfChips.map(l => RUNWAY.find(m => m.same_as.some(id => MODELS.find(x => x.id === id)?.label === l))?.label).filter(Boolean);
        expect(rwChips.length).toBeGreaterThan(0);
        expect(rwChips.slice(0, twins.length)).toEqual(twins.slice(0, rwChips.length));
        const offered = [...screen.getByLabelText('Send to Runway model').querySelectorAll('option')].map(o => o.value);
        expect(offered.sort()).toEqual(RUNWAY.map(m => m.id).sort());
        expect(screen.getByLabelText('Send to Runway model').textContent).toContain("Runway's own");
        fireEvent.change(screen.getByLabelText('Send to Runway model'), { target: { value: 'gen4.5' } }); await flush();
        const btn = screen.getByRole('button', { name: /^Generate 1A · 72 Runway credits \(≈\$0\.72\)/ });
        await click(btn);
        const put = calls.find(c => c.method === 'PUT' && c.path.endsWith(`${enc(A.key)}/draft`));
        expect(put.body.payload.video).toMatchObject({ provider: 'runway', model: 'gen4.5', init_image: { asset_id: 'frame-1A' }, settings: { duration_s: 6, width: 1280, height: 720, generate_audio: false } });
        expect(put.body.payload.video.prompt).toContain('Where were you?');
        expect(calls.find(c => c.path === `/shots/${A.id}/video/generate`).body).toEqual({ production_draft: { node_key: A.key, revision: 1 } });
        expect(calls.filter(c => c.path.endsWith('/direction/studio')).pop().body.data).toMatchObject({ provider: 'runway', runwayModel: 'gen4.5' });
    });

    it('API keys live in Settings only: Production shows no key button or key status', async () => {
        open({ 'GET /production-studio/higgsfield-models': { models: MODELS, connected: false } }); await flush();
        expect(screen.queryByRole('button', { name: /API keys/ })).toBeNull();
        expect(screen.queryByText(/not set/)).toBeNull();
    });
});

describe('Cut: picked shots, footage or not, sound wired to them, sent to Resolve', () => {
    // The server lays the cut out (lib/production-cuts.js); this stands in for it from the request.
    const layout = (shotIds, sounds = []) => {
        let at = 0;
        const shots = shotIds.map(id => { const n = GRAPH.nodes.find(x => x.id === id); const len = 4000; const s = { shot_id: id, shot_code: n.shot_code, start_ms: at, duration_ms: len,
            own_duration_ms: len, picture: n.videos.length ? 'clip' : n.frames.length ? 'board' : 'none', held: false }; at += len; return s; });
        return { id: 'cut-1', project_id: P, name: 'Rough cut', version: 1, label: 'Rough cut v1', shot_ids: shotIds, holds: {}, total_ms: at, shots,
            sounds: sounds.map((x, i) => ({ id: `snd-${i}`, gain_db: 0, fade_in_ms: 0, fade_out_ms: 0, offset_ms: 0, end_shot_id: null, label: '', asset: null, ...x,
                placed: true, start_ms: shots.find(s => s.shot_id === x.start_shot_id).start_ms, end_ms: shots.find(s => s.shot_id === x.start_shot_id).start_ms + 4000 })) };
    };
    function openCut(existing) {
        let cut = existing || null;
        const r = open({
            [`GET /projects/${P}/cuts`]: () => ({ cuts: cut ? [{ id: cut.id, label: cut.label, name: cut.name, version: cut.version }] : [] }),
            [`POST /projects/${P}/cuts`]: (body) => { cut = layout(body.shot_ids); return { cut }; },
            'GET /cuts/cut-1': () => ({ cut }),
            'PUT /cuts/cut-1': (body) => { cut = layout(body.shot_ids || cut.shot_ids, cut.sounds); return { cut }; },
            'POST /cuts/cut-1/sounds': (body) => { cut = layout(cut.shot_ids, [...cut.sounds, body]); return { cut }; },
            'PUT /cut-sounds/snd-0': (body) => { cut = layout(cut.shot_ids, [{ ...cut.sounds[0], ...body, asset: body.asset_id ? { id: body.asset_id, file_name: 'x.wav', file_path: '/f/x.wav' } : cut.sounds[0].asset }]); return { cut }; },
            'POST /cuts/cut-1/send-to-resolve': { imported_into_resolve: true, dest: '/films/Demo/07 Delivery/Exports/Demo_Rough_cut_v1_Resolve', copied: 4, launch: { imported: true } },
        });
        return r;
    }
    const toCut = async () => { await act(async () => { fireEvent.click(screen.getByRole('tab', { name: 'Cut' })); }); await flush(); };

    it('the kinds the page wires are exactly the kinds the cut route takes (the checks run over something)', async () => {
        const { CUT_KINDS } = await import('./studio-model.js');
        expect(CUT_KINDS.map(k => k.id).sort()).toEqual([...CUT_KINDS_SERVER].sort());
        for (const k of CUT_KINDS) expect(MEDIA_KINDS[k.capability], `${k.id} imports as a media kind`).toBeTruthy();
    });

    it('every shot is listed as what it has: a clip, its storyboard board, or nothing yet', async () => {
        openCut(); await flush(); await toCut();
        const shots = screen.getByRole('complementary', { name: 'Shots' });
        for (const [n, badge] of [[A, 'CLIP'], [B, 'BOARD'], [C, '—']]) {
            const row = within(shots).getByText(new RegExp(`^${n.shot_code}`)).closest('label');
            expect(row.textContent, n.shot_code).toContain(badge);
        }
    });

    it('ticking a shot starts a cut; ticking another puts it in story order, whatever order they were ticked in', async () => {
        const { calls } = openCut(); await flush(); await toCut();
        const tick = async (code) => { await act(async () => { fireEvent.click(within(screen.getByRole('complementary', { name: 'Shots' })).getByText(new RegExp(`^${code}`)).closest('label').querySelector('input')); }); await flush(); };
        await tick('1C');
        expect(calls.find(c => c.method === 'POST' && c.path === `/projects/${P}/cuts`).body.shot_ids).toEqual([C.id]);
        await tick('1A');
        expect(calls.filter(c => c.method === 'PUT' && c.path === '/cuts/cut-1').pop().body.shot_ids).toEqual([A.id, C.id]);
        expect(screen.getByRole('button', { name: /^1A, clip/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: /^1C, none/ })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Send 2 shots to DaVinci Resolve' })).toBeTruthy();
    });

    it('every sound kind can be wired to a shot, given a file in its own place, and generated where the generator makes it', async () => {
        const { CUT_KINDS } = await import('./studio-model.js');
        for (const k of CUT_KINDS) {
            cleanup();
            const { calls } = openCut(layout([A.id, B.id])); await flush(); await toCut();
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^1B, board/ })); });
            await act(async () => { fireEvent.click(screen.getByRole('button', { name: k.label })); }); await flush();
            expect(calls.filter(c => c.path === '/cuts/cut-1/sounds').pop().body, k.id).toMatchObject({ kind: k.id, start_shot_id: B.id });
            const insp = screen.getByRole('complementary', { name: 'Inspector' });
            expect(!!within(insp).queryByRole('button', { name: 'Generate…' }), `${k.id}: Generate offered`).toBe(!!k.generates);
            // A file goes in through the kind's own import: scene-wide for music and ambience, the shot's for the rest.
            const route = MEDIA_KINDS[k.capability].scope === 'scene' ? `/scenes/${B.scene_id}/media/${k.capability}/import` : `/shots/${B.id}/media/${k.capability}/import`;
            const legacy = window.api;
            window.api = vi.fn(async (p, o) => (p === route ? { asset_id: `asset-${k.id}` } : legacy(p, o)));
            const input = screen.getByLabelText('Sound file');
            await act(async () => { fireEvent.click(within(insp).getByRole('button', { name: 'Choose file…' })); });
            await act(async () => { fireEvent.change(input, { target: { files: [new File(['RIFF'], `${k.id}.wav`, { type: 'audio/wav' })] } }); });
            await flush(); await flush();
            expect(window.api.mock.calls.map(c => c[0]), `${k.id} imports through ${route}`).toContain(route);
            expect(window.api.mock.calls.find(c => c[0] === '/cut-sounds/snd-0')?.[1]?.body, `${k.id} wires the imported file`).toContain(`asset-${k.id}`);
            window.api = legacy;
        }
    });

    it('Send to DaVinci Resolve sends this cut only, and says Resolve opened with it as a timeline', async () => {
        const { calls } = openCut(layout([A.id, B.id])); await flush(); await toCut();
        await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send 2 shots to DaVinci Resolve' })); }); await flush();
        expect(calls.some(c => c.method === 'POST' && c.path === '/cuts/cut-1/send-to-resolve')).toBe(true);
        expect(screen.getByRole('status').textContent).toMatch(/Rough cut v1/);
    });
});

describe('Direct studio: who is who', () => {
    it('one key per person: "RAY", "Ray" and "RAY MERCER" are the cast member RAY MERCER; a stranger keeps their name', () => {
        const canon = backendless.canonOf(['RAY MERCER', 'JUNE']);
        expect(['RAY', 'Ray', 'ray mercer', 'June', 'ELAINE'].map(canon)).toEqual(['RAY MERCER', 'RAY MERCER', 'RAY MERCER', 'JUNE', 'ELAINE']);
    });
    it("an age in a shot's notes belongs to the nearest name before it, so June is never given Ray's age", () => {
        const age = (c) => (c === 'JUNE' ? '23' : '57');
        const out = backendless.ageConflicts(['JUNE', 'RAY MERCER'], [['1E', { notes: 'June asks about Elaine. Ray, late forties, looks at the glass.' }]], age, backendless.shortName);
        expect(out).toEqual([{ ch: 'RAY MERCER', profile: '57', card: 'late forties', shot: '1E' }]);
        expect(backendless.ageConflicts(['RAY MERCER'], [['1B', { notes: 'Ray, 57, sits down.' }]], age, backendless.shortName)).toEqual([]);
    });
});
