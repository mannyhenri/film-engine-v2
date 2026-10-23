import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { useListControls, ListControlsBar, ListNoMatch } from '../../lib/list-controls.jsx';
import SURFACES from './list-surface.js';
import ModelViewer from './ModelViewer.jsx';
import './models-studio.css';

/*
 * 3D Models: every character, location and prop of the film, each with its model.
 *
 *   Characters → Meshy (image to 3D, from the character's approved front reference). Sent through Meshy's API after
 *     the final review's Approve & send (manual-generation SENT: the user's ruling); the model comes back here.
 *   Locations and props → Blender, guided by Codex's Astra model (GPT-6-Astra or newer): it reads the reference
 *     pictures, writes the build, checks Blender's renders against the pictures and corrects it, round by round, in a
 *     locked-down background Blender (backend/lib/astra-build.js). Free: the user's ChatGPT plan and this Mac.
 *     A second pass takes "Add details" and builds on the last version.
 *   A finished location is a Previz set (a world version); characters and props are on Previz's "Stage in this shot".
 */
const api = (p, o) => legacy.api(p, o);
const KINDS = [
    { kind: 'character', title: 'Characters', plural: 'characters', how: 'Meshy, from the approved front reference picture' },
    { kind: 'location', title: 'Locations', plural: 'locations', how: 'Built in Blender by Astra from the reference pictures; becomes a Previz set' },
    { kind: 'prop', title: 'Props', plural: 'props', how: 'Built in Blender by Astra from the reference pictures' },
];
const POLL_MS = 3000;
const activeBuild = b => b && (b.status === 'queued' || b.status === 'running');
const fileUrl = id => `${legacy.API_BASE}/film/models/${id}/file`;
const metaOf = m => m.metadata || {};
const subjectOfModel = m => {
    const md = metaOf(m);
    return md.subject_id || md.character_id || md.prop_id || md.location_id || null;
};
const madeBy = m => metaOf(m).source === 'astra-blender' ? 'Blender · Astra' : metaOf(m).subject_kind === 'imported' ? 'imported' : 'Meshy';

export default function ModelsStudio() {
    const [data, setData] = useState(null);   // { subjects, models, jobs, builds }
    const [status, setStatus] = useState(null);   // the Astra builder: codex, model, blender
    const [error, setError] = useState('');
    const [sending, setSending] = useState({});   // subject id -> true while its Meshy request is open
    const [viewing, setViewing] = useState(null);
    const pidRef = useRef(null);

    const load = useCallback(async () => {
        const pid = legacy.state?.currentProject?.id;
        pidRef.current = pid;
        if (!pid) { setData(null); return; }
        try {
            const [c, l, p, m, b] = await Promise.all([
                api(`/projects/${pid}/characters`).catch(() => ({ characters: [] })),
                api(`/projects/${pid}/locations`).catch(() => ({ locations: [] })),
                api(`/projects/${pid}/props`).catch(() => ({ props: [] })),
                api(`/projects/${pid}/models`).catch(() => ({ models: [], jobs: [] })),
                api(`/projects/${pid}/astra-builds`).catch(() => ({ builds: [] })),
            ]);
            if (pidRef.current !== pid) return;
            const list = (r, k) => (Array.isArray(r) ? r : r?.[k]) || [];
            const subjects = [
                ...list(c, 'characters').map(x => ({ kind: 'character', id: x.id, name: x.name })),
                ...list(l, 'locations').map(x => ({ kind: 'location', id: x.id, name: x.name })),
                ...list(p, 'props').map(x => ({ kind: 'prop', id: x.id, name: x.name })),
            ].map((s, order) => ({ ...s, order }));
            setData({ subjects, models: m?.models || [], jobs: m?.jobs || [], builds: b?.builds || [] });
            setError('');
        } catch (err) { setError(err.message); }
    }, []);
    usePageLoader('loadThreeD', load);
    useEffect(() => { load(); api('/astra-builds/status').then(setStatus).catch(() => setStatus(null)); }, [load]);

    // Poll while anything is being made, so a model appears here the moment it lands.
    const busy = !!data && (data.builds.some(activeBuild) || data.jobs.some(j => j.status === 'generating') || Object.values(sending).some(Boolean));
    useEffect(() => {
        if (!busy) return undefined;
        const t = setTimeout(load, POLL_MS);
        return () => clearTimeout(t);
    }, [busy, data, load]);

    const meshy = async s => {
        setSending(x => ({ ...x, [s.id]: true })); setError('');
        try {
            // The request wrapper opens the final review (cost, the exact picture and options); Approve & send sends it.
            await api(`/${s.kind}s/${s.id}/model/from-image`, { method: 'POST', body: JSON.stringify({}) });
        } catch (err) { if (err.code !== 'FINAL_REQUEST_CANCELLED') setError(`${s.name}: ${err.message}`); }
        finally { setSending(x => ({ ...x, [s.id]: false })); load(); }
    };
    const build = async (s, extra = {}) => {
        setError('');
        try {
            await api(`/projects/${pidRef.current}/astra-builds`, { method: 'POST', refresh: false,
                body: JSON.stringify({ subject_kind: s.kind, subject_id: s.id, ...extra }) });
            load();
        } catch (err) { setError(`${s.name}: ${err.message}`); }
    };
    const cancel = async b => { try { await api(`/astra-builds/${b.id}/cancel`, { method: 'POST', refresh: false }); load(); } catch (err) { setError(err.message); } };
    const importGlb = async e => {
        const file = e.target.files?.[0]; e.target.value = '';
        if (!file || !pidRef.current) return;
        try {
            const dataUrl = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => bad(new Error('The file could not be read.')); r.readAsDataURL(file); });
            await api(`/projects/${pidRef.current}/models/import`, { method: 'POST',
                body: JSON.stringify({ name: file.name, data: String(dataUrl).replace(/^data:[^;]*;base64,/, 'data:model/gltf-binary;base64,') }) });
            load();
        } catch (err) { setError(`${file.name}: ${err.message}`); }
    };

    const subjects = useListControls(SURFACES[0], data ? data.subjects : null);
    const modelRows = useMemo(() => (data?.models || []).map((m, order) => ({ ...m, order, kind: metaOf(m).kind || 'model_3d', file_name: m.file_name || 'model', format: m.format || 'glb' })), [data]);
    const models = useListControls(SURFACES[1], data ? modelRows : null);

    // No window when rendered to static markup (tools/assemble-page.js): the page before its loader runs.
    if (typeof window === 'undefined' || !legacy.state?.currentProject) return <div className="md"><p className="text-muted">Open a project to see its 3D models.</p></div>;
    return (
        <div className="md">
            <div className="flex-between mb-16">
                <h2>3D Models</h2>
                <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>Import GLB
                    <input type="file" accept=".glb,model/gltf-binary" hidden onChange={importGlb} />
                </label>
            </div>
            {status && (!status.codex?.found || !status.model || !status.blender?.found) && (
                <p className="md-warn" role="note">
                    Building locations and props needs {[!status.codex?.found && 'the Codex app signed in to ChatGPT', status.codex?.found && !status.model && 'an Astra 6 or newer model in Codex', !status.blender?.found && 'Blender'].filter(Boolean).join(' and ')}.
                </p>
            )}
            {error && <p className="md-warn" role="alert">{error}</p>}
            {!data && <div className="loading-spinner" />}
            {data && <>
                <ListControlsBar list={subjects} />
                <div id="threedSubjects">
                    {subjects.shown && !subjects.shown.length && data.subjects.length > 0 && <ListNoMatch list={subjects} />}
                    {!data.subjects.length && <div className="empty-state"><h3>No characters, locations or props yet</h3><p>Add them in Write &amp; Design first.</p></div>}
                    {/* Grouped by kind in the as-read order (which is characters, locations, props); another sort is one list. */}
                    {(subjects.sort === 'as-read' ? KINDS : [{ kind: '*', title: 'All subjects', how: 'sorted by name' }]).map(k => {
                        const list = (subjects.shown || []).filter(s => k.kind === '*' || s.kind === k.kind);
                        if (!list.length) return null;
                        return (
                            <section key={k.kind} className="md-kind" aria-label={k.title}>
                                <h3 className="md-kind-title">{k.title} <span className="text-muted">{k.how}</span></h3>
                                <div className="md-grid">
                                    {list.map(s => (
                                        <SubjectCard key={s.id} s={s} kindInfo={KINDS.find(x => x.kind === s.kind)}
                                            models={data.models.filter(m => subjectOfModel(m) === s.id)}
                                            builds={data.builds.filter(b => b.subject_id === s.id)}
                                            meshyRunning={!!sending[s.id] || data.jobs.some(j => j.status === 'generating' && (j.character_id === s.id || j.prop_id === s.id))}
                                            astraReady={!!(status?.codex?.found && status?.model && status?.blender?.found)}
                                            onMeshy={() => meshy(s)} onBuild={extra => build(s, extra)} onCancel={cancel}
                                            onView={m => setViewing({ url: fileUrl(m.asset_id), name: s.name })} onDeleted={load} />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <h3 className="md-kind-title md-all">All models <span className="text-muted">every version made or imported, newest first</span></h3>
                <ListControlsBar list={models} />
                <div className="md-grid" id="threedModels">
                    {models.shown && !models.shown.length && modelRows.length > 0 && <ListNoMatch list={models} />}
                    {!modelRows.length && <div className="empty-state"><h3>No models yet</h3><p>Generate one above, or import a .glb.</p></div>}
                    {(models.shown || []).map(m => (
                        <div key={m.asset_id} className="entity-card md-model">
                            <h3>{m.file_name}</h3>
                            <p className="text-sm text-muted">{m.kind}</p>
                            <div className="md-tags"><span className="tag">{m.format}</span><span className="tag">{madeBy(m)}</span>{metaOf(m).subject_name && <span className="tag">{metaOf(m).subject_name}</span>}</div>
                            <div className="md-actions">
                                {/^glb$/i.test(m.format) && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setViewing({ url: fileUrl(m.asset_id), name: metaOf(m).subject_name || m.file_name })}>View 3D</button>}
                                <a className="btn btn-secondary btn-sm" href={fileUrl(m.asset_id)} download={m.file_name}>Download</a>
                                <DeleteModel m={m} onDone={load} />
                            </div>
                        </div>
                    ))}
                </div>
            </>}
            {viewing && <ModelViewer url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />}
        </div>
    );
}

/*
 * Delete a model: first where it is used (GET /models/:id/uses), said plainly; then it goes with what would break
 * without it: a Previz set version built from it (its shots unpinned, their blocking kept) and the copies placed in
 * shots. A model not in use goes at the second click.
 */
function DeleteModel({ m, onDone }) {
    const [ask, setAsk] = useState(null);   // null | 'reading' | uses
    const [err, setErr] = useState('');
    const open = async () => {
        setErr(''); setAsk('reading');
        try { setAsk(await api(`/models/${m.asset_id}/uses`)); } catch (e) { setAsk(null); setErr(e.message); }
    };
    const go = async () => {
        try { await api(`/models/${m.asset_id}${ask && ask.in_use ? '?confirm=1' : ''}`, { method: 'DELETE', refresh: false }); setAsk(null); onDone(); }
        catch (e) { setErr(e.message); }
    };
    if (!ask) return <>
        <button type="button" className="btn btn-secondary btn-sm md-del" onClick={open}>Delete</button>
        {err && <span className="md-err text-sm" role="alert">{err}</span>}
    </>;
    if (ask === 'reading') return <span className="text-sm text-muted">Checking where it is used…</span>;
    const sets = ask.previz_sets || [], staged = ask.staged_in || [];
    return <div className="md-confirm" role="alertdialog" aria-label={`Delete ${m.file_name || 'model'}`}>
        <b>Delete {ask.subject_name ? `${ask.subject_name}'s model` : ask.file_name}?</b>
        {ask.depth_layers > 0 && <span className="md-err">Depth layers were made from it: delete those first.</span>}
        {sets.map(v => <span key={v.id}>It is the Previz set {v.location_name || v.world_name} v{v.version}: that set version goes{v.pinned_shots.length ? `, and ${v.pinned_shots.join(', ')} ${v.pinned_shots.length === 1 ? 'is' : 'are'} unpinned (their blocking is kept)` : ''}.</span>)}
        {staged.length > 0 && <span>It is placed in {staged.map(x => `${x.shot_code}${x.count > 1 ? ` (${x.count}×)` : ''}`).join(', ')}: taken out of those shots.</span>}
        {!ask.in_use && !ask.depth_layers && <span className="text-muted">Not used anywhere. The file is deleted too.</span>}
        <div className="md-actions">
            <button type="button" className="btn btn-danger btn-sm" disabled={ask.depth_layers > 0} onClick={go}>Delete</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAsk(null)}>Keep it</button>
        </div>
        {err && <span className="md-err text-sm" role="alert">{err}</span>}
    </div>;
}

function SubjectCard({ s, kindInfo, models, builds, meshyRunning, astraReady, onMeshy, onBuild, onCancel, onView, onDeleted }) {
    const [ref, setRef] = useState(undefined);   // the approved reference picture (undefined while reading)
    const [details, setDetails] = useState('');
    useEffect(() => {
        let live = true;
        api(`/${kindInfo.plural}/${s.id}/gallery`).then(g => live && setRef((g?.references || [])[0] || null)).catch(() => live && setRef(null));
        return () => { live = false; };
    }, [s.id, kindInfo.plural]);
    const model = models[0] || null;
    const running = builds.find(activeBuild) || null;
    const lastDone = builds.find(b => b.status === 'done') || null;
    const lastFailed = !running && builds[0] && ['failed', 'interrupted'].includes(builds[0].status) ? builds[0] : null;
    // A build's renders are its last good round's views ({ view, url, round }); the first is the front.
    const latestRender = b => { const r = (b?.renders || [])[0]; return r?.url ? (/^https?:/.test(r.url) ? r.url : legacy.API_BASE + r.url) : null; };
    // A stored file's URL is a path on the API (/film/...); a gathered one can be a full web address.
    const refSrc = ref?.image_url ? (/^https?:/.test(ref.image_url) ? ref.image_url : legacy.API_BASE + ref.image_url) : null;
    const picture = (running && latestRender(running)) || (lastDone && latestRender(lastDone)) || refSrc;
    const noRef = ref === null;
    const isChar = s.kind === 'character';
    return (
        <div className="entity-card md-card" data-subject={s.id}>
            <div className="md-thumb">{picture ? <img src={picture} alt="" /> : <span className="text-muted text-sm">{ref === undefined ? '' : 'No reference picture'}</span>}
                {model && <span className="md-badge">3D</span>}</div>
            <h3>{s.name || 'Untitled'}</h3>
            <p className="text-sm text-muted">{s.kind}</p>
            <div className="md-state text-sm" role="status">
                {isChar && meshyRunning && 'Modelling on Meshy… it appears here when done (a few minutes).'}
                {running && <>{running.status === 'queued' ? 'Waiting for Blender…' : `${running.stage || 'Building'} · round ${running.round || 1} of ${running.rounds || 3}`}</>}
                {!running && !(isChar && meshyRunning) && model && `Model ready · ${madeBy(model)}${s.kind === 'location' && (lastDone?.world_version_id || metaOf(model).world_version_id) ? ' · a Previz set' : ''}`}
                {!running && !model && !meshyRunning && (noRef ? 'Add a reference picture first.' : 'No model yet.')}
                {lastFailed && <span className="md-err"> Last build {lastFailed.status}: {lastFailed.error || 'no reason given'}</span>}
            </div>
            {running && <div className="md-bar" role="progressbar" aria-label={`${s.name} build`} aria-valuemin={0} aria-valuemax={running.rounds || 3} aria-valuenow={running.round || 0}><span style={{ width: `${Math.round(100 * (running.round || 0) / (running.rounds || 3))}%` }} /></div>}
            <div className="md-actions">
                {isChar
                    ? <button type="button" className="btn btn-primary btn-sm" disabled={meshyRunning || noRef} title={noRef ? 'Meshy builds from the approved front reference picture' : 'Opens the review with the cost; Approve & send to generate'}
                        onClick={onMeshy}>{meshyRunning ? 'Modelling…' : model ? 'Regenerate on Meshy' : 'Generate on Meshy'}</button>
                    : running
                        ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => onCancel(running)}>Cancel build</button>
                        : <button type="button" className="btn btn-primary btn-sm" disabled={noRef || !astraReady} title={!astraReady ? 'Needs Codex (Astra 6+) and Blender' : 'Free: Astra guides a background Blender'}
                            onClick={() => onBuild({})}>{lastDone ? 'Rebuild in Blender' : 'Build in Blender'}</button>}
                {model && /^glb$/i.test(model.format || 'glb') && <button type="button" className="btn btn-secondary btn-sm" onClick={() => onView(model)}>View 3D</button>}
                {model && <DeleteModel m={model} onDone={onDeleted} />}
            </div>
            {!isChar && lastDone && !running && (
                <div className="md-pass">
                    <label htmlFor={`md-details-${s.id}`} className="text-sm">Add details (second pass)</label>
                    <textarea id={`md-details-${s.id}`} rows={2} value={details} placeholder={s.kind === 'location' ? 'e.g. wear on the counter, napkin holders, menus on the tables' : 'e.g. engraved pattern on the lid, a dented side'}
                        onChange={e => setDetails(e.target.value)} />
                    <button type="button" className="btn btn-secondary btn-sm" disabled={!details.trim() || !astraReady}
                        onClick={() => { onBuild({ from_build_id: lastDone.id, details: details.trim() }); setDetails(''); }}>Run second pass</button>
                </div>
            )}
        </div>
    );
}
