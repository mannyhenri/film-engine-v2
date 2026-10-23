import { useCallback, useEffect, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import './main-sheet.css';

/*
 * The character sheet, the director's way (backend/lib/character-sheet-main.js).
 *
 *   Left: the MAIN picture, the one every generation uses (storyboards, footage, Production, Meshy, Seedance), and under
 *   it the variations (other finished sheets, other wardrobe, the older views): click one and it takes the stage.
 *   Right: the character's description from the screenplay, editable, and the three steps that make the sheet:
 *     1. ChatGPT writes the main (studio, medium shot) picture prompt from the description and the stored guide;
 *     2. given that picture, it writes the three-panel character sheet prompt from the stored guide;
 *     3. the finished sheet is uploaded: the main if there is none yet, else a variation.
 *   Each prompt is shown with a Copy button, to paste into an image generator. Nothing is generated here.
 */
const api = (p, o) => legacy.api(p, o);
const src = u => (!u ? '' : /^https?:|^data:/.test(u) ? u : legacy.API_BASE + u);
const readFile = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('the file could not be read')); r.readAsDataURL(f); });
// A prompt written before they were kept on the server lives in this window only: shown when the server has none.
const keep = (id, k) => { try { return localStorage.getItem(`fe-cs-${k}-${id}`) || ''; } catch (_) { return ''; } };
const utc = s => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : String(s).replace(' ', 'T') + 'Z').getTime();
const POLL_MS = 2000;

function Elapsed({ since }) {
    const [, tick] = useState(0);
    useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t); }, []);
    const s = Math.round((Date.now() - since) / 1000);
    return <span className="text-muted">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} elapsed · usually under two minutes</span>;
}

function PromptBox({ label, text, onCopy, copied }) {
    if (!text) return null;
    return <div className="msh-prompt">
        <label className="msh-lab">{label}</label>
        <textarea readOnly value={text} rows={8} aria-label={label} />
        <button type="button" className="btn btn-sm" onClick={onCopy}>{copied ? 'Copied' : 'Copy prompt'}</button>
    </div>;
}

export default function MainSheet({ characterId }) {
    const [sheet, setSheet] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(null);          // null | { what, since }
    const [desc, setDesc] = useState(null);          // { appearance_prompt, description } while editing

    const [copied, setCopied] = useState('');
    const portraitInput = useRef(null), sheetInput = useRef(null);

    const load = useCallback(async () => {
        try { setSheet(await api(`/characters/${characterId}/sheet`)); setError(''); }
        catch (e) { setError(e.message); }
    }, [characterId]);
    useEffect(() => { load(); }, [load]);
    /*
     * The prompts are jobs on the server, kept per character (backend film_character_sheet_prompts): read back from the
     * sheet, and read again every two seconds while one is being written. Leaving the sheet loses nothing.
     */
    const prompts = sheet?.prompts || {};
    const writing = k => prompts[k]?.status === 'writing';
    useEffect(() => {
        if (!writing('main') && !writing('sheet')) return undefined;
        const t = setTimeout(load, POLL_MS);
        return () => clearTimeout(t);
    }); // eslint-disable-line react-hooks/exhaustive-deps
    const textOf = k => prompts[k]?.prompt || (prompts[k] ? '' : keep(characterId, k));
    const mainPrompt = textOf('main'), sheetPromptText = textOf('sheet');

    const run = async (what, fn) => {
        setBusy({ what, since: Date.now() }); setError('');
        try { await fn(); } catch (e) { setError(e.message); } finally { setBusy(null); }
    };
    const makeMain = id => run('main', async () => setSheet(await api(`/characters/${characterId}/sheet/main`, { method: 'PUT', body: JSON.stringify({ asset_id: id }), refresh: false })));
    // Each starts the job and returns at once; the prompt arrives through the sheet's own read.
    const start = (kind, body) => run('start-' + kind, async () => {
        const r = await api(`/characters/${characterId}/sheet/prompt/${kind}`, { method: 'POST', body: JSON.stringify(body || {}), refresh: false });
        setSheet(s => ({ ...s, prompts: r.prompts }));
        load();
    });
    const writeMain = () => start('main');
    const writeSheet = async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (f) start('sheet', { data: await readFile(f), name: f.name });
    };
    const writeSheetFrom = id => start('sheet', { asset_id: id });
    const upload = async e => {
        const f = e.target.files?.[0]; e.target.value = '';
        if (!f) return;
        run('upload', async () => setSheet(await api(`/characters/${characterId}/sheet/upload`, { method: 'POST', body: JSON.stringify({ data: await readFile(f), name: f.name }), refresh: false })));
    };
    const saveDesc = () => run('desc', async () => {
        await api(`/characters/${characterId}`, { method: 'PUT', body: JSON.stringify(desc), refresh: false });
        setDesc(null); await load();
    });
    const copy = async (k, text) => { try { await navigator.clipboard.writeText(text); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch (e) { setError('Copy failed: ' + e.message); } };

    if (!sheet) return <div className="msh">{error ? <p className="msh-err" role="alert">{error}</p> : <div className="loading-spinner" />}</div>;
    const c = sheet.character;
    const waiting = what => (busy && busy.what === 'start-' + what.replace('prompt-', '')) || writing(what.replace('prompt-', ''));
    const sinceOf = k => (prompts[k]?.started_at ? utc(prompts[k].started_at) : busy?.since || Date.now());
    const failed = k => ['failed', 'interrupted'].includes(prompts[k]?.status) ? prompts[k].error || prompts[k].status : '';
    return (
        <div className="msh">
            <section className="msh-left" aria-label="Main picture">
                <div className="msh-main">
                    {sheet.main
                        ? <><img src={src(sheet.main.image_url)} alt={`${c.name}: main picture`} /><span className="msh-badge">Main · used for every generation</span></>
                        : <div className="msh-empty"><b>No main picture yet.</b><span>Follow the three steps on the right, then upload the finished character sheet: it becomes the main picture, the one storyboards and footage use.</span></div>}
                </div>
                {sheet.variations.length > 0 && <>
                    <h4 className="msh-h">Variations <span className="text-muted">click one to make it the main picture</span></h4>
                    <div className="msh-vars" role="list" aria-label="Variations">
                        {sheet.variations.map(v => (
                            <button key={v.asset_id} type="button" role="listitem" className="msh-var" disabled={!!busy} title={`Make this the main picture (${v.kind})`} onClick={() => makeMain(v.asset_id)}>
                                <img src={src(v.image_url)} alt="" /><small>{v.kind}</small>
                            </button>
                        ))}
                    </div>
                </>}
            </section>

            <section className="msh-right" aria-label="Description and steps">
                <div className="msh-desc">
                    <div className="msh-row"><h4 className="msh-h">Description <span className="text-muted">from the screenplay</span></h4>
                        {!desc && <button type="button" className="btn btn-sm" onClick={() => setDesc({ appearance_prompt: c.appearance_prompt, description: c.description })}>Edit</button>}</div>
                    {desc ? <>
                        <label className="msh-lab" htmlFor="mshAppearance">Appearance</label>
                        <textarea id="mshAppearance" rows={4} value={desc.appearance_prompt} onChange={e => setDesc(d => ({ ...d, appearance_prompt: e.target.value }))} />
                        <label className="msh-lab" htmlFor="mshDescription">Description</label>
                        <textarea id="mshDescription" rows={5} value={desc.description} onChange={e => setDesc(d => ({ ...d, description: e.target.value }))} />
                        <div className="msh-row"><button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={saveDesc}>Save</button>
                            <button type="button" className="btn btn-sm" onClick={() => setDesc(null)}>Cancel</button></div>
                    </> : <>
                        {c.appearance_prompt && <p className="msh-text"><b>Appearance.</b> {c.appearance_prompt}</p>}
                        {c.description && <p className="msh-text">{c.description}</p>}
                        {!c.appearance_prompt && !c.description && <p className="text-muted">No description yet. Edit to write one: the prompts are written from it.</p>}
                        {(c.age_range || c.gender) && <p className="text-muted text-sm">{[c.age_range, c.gender].filter(Boolean).join(' · ')}</p>}
                    </>}
                </div>

                <div className="msh-steps">
                    <h4 className="msh-h">Make the character sheet</h4>
                    <div className="msh-step">
                        <div className="msh-row"><b>1. Main picture prompt</b>
                            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || waiting('prompt-main')} onClick={writeMain}>{waiting('prompt-main') ? 'Writing…' : mainPrompt ? 'Write again' : 'Write the prompt'}</button></div>
                        <p className="text-muted text-sm">ChatGPT writes a medium-shot studio photo prompt from the description. Paste it in your image generator.</p>
                        {waiting('prompt-main') && <div role="status" className="msh-busy">ChatGPT is writing the main picture prompt… <Elapsed since={sinceOf('main')} /> · you can close the sheet: it shows here when done</div>}
                        {failed('main') && <p className="msh-err" role="alert">The last try failed: {failed('main')}</p>}
                        <PromptBox label="Main picture prompt" text={mainPrompt} copied={copied === 'main'} onCopy={() => copy('main', mainPrompt)} />
                    </div>
                    <div className="msh-step">
                        <div className="msh-row"><b>2. Character sheet prompt</b>
                            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy || waiting('prompt-sheet')} onClick={() => portraitInput.current?.click()}>{waiting('prompt-sheet') ? 'Writing…' : 'Choose the medium shot picture…'}</button></div>
                        <p className="text-muted text-sm">Give it the studio picture you made in step 1: ChatGPT writes the three-panel sheet prompt from it.</p>
                        {sheet.studio_portraits.length > 0 && !busy && !waiting('prompt-sheet') && <div className="msh-row msh-portraits">
                            <span className="text-muted text-sm">Or use one from before:</span>
                            {sheet.studio_portraits.map(p => <button key={p.asset_id} type="button" className="msh-portrait" title="Write the sheet prompt from this picture" onClick={() => writeSheetFrom(p.asset_id)}><img src={src(p.image_url)} alt="studio picture" /></button>)}
                        </div>}
                        <input ref={portraitInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={writeSheet} aria-label="Medium shot studio picture" />
                        {waiting('prompt-sheet') && <div role="status" className="msh-busy">ChatGPT is writing the character sheet prompt from the picture… <Elapsed since={sinceOf('sheet')} /> · you can close the sheet: it shows here when done</div>}
                        {failed('sheet') && <p className="msh-err" role="alert">The last try failed: {failed('sheet')}</p>}
                        <PromptBox label="Character sheet prompt" text={sheetPromptText} copied={copied === 'sheet'} onCopy={() => copy('sheet', sheetPromptText)} />
                    </div>
                    <div className="msh-step">
                        <div className="msh-row"><b>3. Finished character sheet</b>
                            <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => sheetInput.current?.click()}>{waiting('upload') ? 'Uploading…' : 'Upload the sheet…'}</button></div>
                        <p className="text-muted text-sm">{sheet.main ? 'It joins the variations; click it to make it the main picture.' : 'It becomes the main picture.'}</p>
                        <input ref={sheetInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={upload} aria-label="Finished character sheet" />
                    </div>
                </div>
                {error && <p className="msh-err" role="alert">{error}</p>}
            </section>
        </div>
    );
}
