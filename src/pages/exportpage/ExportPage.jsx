import { useState } from 'react';
import { legacy } from '../../lib/legacy.js';
import { usePageLoader } from '../../lib/usePageLoader.js';

/*
 * Export, as React. Replaces the legacy functions listed in react.json: the same
 * routes, bodies, markup and status lines. The format downloads (downloadExport)
 * and the bundle import (importBundle) are shared with other pages and stay in
 * core; this page calls them.
 */
const s = (n, one, many = one + 's') => (n === 1 ? one : many);
const FORMATS = [
    { id: 'fcpxml', icon: '📄', title: 'FCPXML', what: 'Final Cut Pro timeline' },
    { id: 'edl', icon: '📝', title: 'EDL', what: 'Edit Decision List (CMX 3600)' },
    { id: 'premiere', icon: '🎬', title: 'Premiere XML', what: 'Adobe Premiere Pro / DaVinci Resolve' },
];
const LATER = [
    { id: 'srt', icon: '🔈', title: 'SRT Subtitles', what: 'Subtitle file from dialogue' },
    { id: 'fdx', icon: '📑', title: 'FDX', what: 'Final Draft XML screenplay' },
];
const CARD = { textAlign: 'center', padding: 30 };
const ICON = { fontSize: 32, marginBottom: 8 };
const RESULT = { marginTop: 8, textAlign: 'left' };

function Download({ f }) {
    return (
        <div className="card" style={CARD}>
            <div style={ICON}>{f.icon}</div>
            <h3>{f.title}</h3>
            <p className="text-sm text-muted mb-8">{f.what}</p>
            <button className="btn btn-primary btn-sm" onClick={() => legacy.downloadExport(f.id)}>Download</button>
        </div>
    );
}

function DeliveryCheck({ check, onMeasure }) {
    if (!check) return null;
    if (check.measuring) return <div className="text-sm text-muted">Measuring the selected clips…</div>;
    if (check.error) return <div className="text-sm" style={{ color: 'var(--danger,#c00)' }}>Could not measure: {check.error}</div>;
    const shots = check.shots || [];
    const bad = shots.filter(x => x.status !== 'ok');
    return (
        <>
            <div className="flex-between"><strong>Delivery check</strong>
                <button className="btn btn-sm" onClick={onMeasure}>Measure again</button></div>
            <div className="text-sm text-muted" style={{ margin: '4px 0 8px' }}>Delivers {check.asked || 'no size set'} &middot;
                {' '}{shots.length - bad.length} of {shots.length} shot{shots.length === 1 ? '' : 's'} at full size</div>
            {bad.length ? (
                <table className="text-sm" style={{ width: '100%' }}><tbody>{bad.map((x, i) => (
                    <tr key={i}>
                        <td><strong>{x.shot_code}</strong></td>
                        <td>{x.status === 'below' ? 'below delivery' : x.status === 'no_clip' ? 'no clip' : 'unreadable'}</td>
                        <td>{x.measured || ''}</td>
                        <td className="text-muted">{x.fix || ''}</td>
                    </tr>
                ))}</tbody></table>
            ) : <div className="text-sm">Every selected clip is at the delivery size.</div>}
        </>
    );
}

export default function ExportPage() {
    const [count, setCount] = useState(null); // null: not loaded (the markup's 0 / 0s)
    const [check, setCheck] = useState(null);
    const [premiere, setPremiere] = useState(null); // { text } | { result }
    const [resolve, setResolve] = useState(null);

    /* THE DELIVERY CHECK: every shot's selected clip, measured from the file, against the delivery size. Free. */
    async function loadDeliveryCheck() {
        if (!legacy.state.currentProject) return;
        setCheck({ measuring: true });
        try { setCheck(await legacy.api('/projects/' + legacy.state.currentProject.id + '/delivery-check')); }
        catch (err) { setCheck({ error: err.message }); }
    }

    async function loadExportPage() {
        if (!legacy.state.currentProject) return;
        try {
            const data = await legacy.api('/projects/' + legacy.state.currentProject.id + '/shotlist');
            const shots = data.shots || [];
            setCount({ shots: shots.length, ms: shots.reduce((sum, x) => sum + (x.duration_ms || 0), 0) });
        } catch (err) { legacy.setStatus('Error: ' + err.message); }
        loadDeliveryCheck();
    }
    usePageLoader('loadExportPage', loadExportPage);

    /* PREMIERE, ONE FOLDER PER SCENE: the plan first (free), so the question names what is copied and missing. */
    async function exportPremiereScenes() {
        if (!legacy.state.currentProject) return;
        const url = '/projects/' + legacy.state.currentProject.id + '/export/premiere-scenes';
        try {
            const plan = await legacy.api(url);
            const clips = (plan.scenes || []).reduce((n, x) => n + x.shots.filter(y => y.asset_id).length, 0);
            const miss = (plan.missing || []).length;
            const scenes = (plan.scenes || []).length;
            if (!window.confirm(`Copy ${plan.file_count} ${s(plan.file_count, 'file')} (${clips} ${s(clips, 'clip')}) into ${scenes} scene ${s(scenes, 'folder')}?`
                + (miss ? `\n${miss} ${s(miss, 'item is', 'items are')} missing and will be named in the READ ME.` : ''))) return;
            setPremiere({ text: 'Copying…' });
            setPremiere({ result: await legacy.api(url, { method: 'POST', body: '{}' }) });
        } catch (err) { setPremiere({ text: 'Could not make the folders: ' + err.message }); }
    }

    /* DAVINCI RESOLVE: the plan first (free), so the question says what the first edit holds. */
    async function exportResolve() {
        if (!legacy.state.currentProject) return;
        const url = '/projects/' + legacy.state.currentProject.id + '/export/resolve';
        try {
            const plan = await legacy.api(url);
            const c = plan.counts || {};
            const miss = (plan.missing || []).length;
            if ((plan.blocking || []).length) {
                setResolve({ text: 'Resolve package blocked: ' + plan.blocking.map(x => x.message || x.code).join('; ') });
                return;
            }
            if (!window.confirm(`Create a Resolve export package: ${c.shots} shots (${c.clips} with footage, ${c.storyboard_frames} on their storyboard frame${c.gaps ? `, ${c.gaps} ${s(c.gaps, 'gap')}` : ''}), `
                + `${c.dialogue_lines} dialogue ${s(c.dialogue_lines, 'line')}, ${c.beds} music/ambience ${s(c.beds, 'bed')}; ${plan.file_count} files copied.`
                + (c.timeline_audio_tracks ? `\n${c.timeline_audio_tracks} independent sound ${s(c.timeline_audio_tracks, 'edit')}, with original files and explicit trim/offset/gain/mute.` : '')
                + (miss ? `\n${miss} ${s(miss, 'item is', 'items are')} missing and will be named in the READ ME.` : '')
                + ((plan.warnings || []).length ? '\n' + plan.warnings.map(w => w.message).join('\n') : '')
                + '\nImport this package in Resolve separately.')) return;
            setResolve({ text: 'Copying…' });
            setResolve({ result: await legacy.api(url, { method: 'POST', body: '{}' }) });
        } catch (err) { setResolve({ text: 'Could not create the Resolve package: ' + err.message }); }
    }

    function downloadBundle() {
        if (!legacy.state.currentProject) return;
        window.open(legacy.API_BASE + '/film/projects/' + legacy.state.currentProject.id + '/bundle', '_blank');
        legacy.setStatus('Downloading project bundle...');
    }

    const missingLine = (r) => r.missing && r.missing.length ? <><br /><span className="text-muted">{r.missing.length} missing, listed in READ ME.txt</span></> : null;

    return (
        <div className="page" id="page-exportpage">
            <div className="page-header"><h2>Export</h2></div>
            <div id="exportInfo" className="card mb-16">
                <div className="flex-between">
                    <div><span id="exportShotCount">{count ? count.shots : 0}</span> shots &middot; <span id="exportDuration">{count ? (count.ms / 1000).toFixed(1) + 's' : '0s'}</span> estimated</div>
                </div>
            </div>
            <div id="exportDeliveryCheck" className="card mb-16"><DeliveryCheck check={check} onMeasure={loadDeliveryCheck} /></div>
            <div className="entity-grid" id="exportGrid">
                {FORMATS.map(f => <Download key={f.id} f={f} />)}
                <div className="card" style={CARD}>
                    <div style={ICON}>📁</div>
                    <h3>Premiere, by scene</h3>
                    <p className="text-sm text-muted mb-8">A folder per scene with its selected clips and sound, and an XML with a bin per scene. Free.</p>
                    <button className="btn btn-primary btn-sm" onClick={exportPremiereScenes}>Make the folders</button>
                    <div id="premiereScenesResult" className="text-sm" style={RESULT}>
                        {premiere?.text}
                        {premiere?.result && <>Written to <code>{premiere.result.dest}</code><br />{premiere.result.copied} files, {premiere.result.xml}{missingLine(premiere.result)}</>}
                    </div>
                </div>
                <div className="card" style={CARD}>
                    <div style={ICON}>🎞</div>
                    <h3>DaVinci Resolve</h3>
                    <p className="text-sm text-muted mb-8">A Resolve interchange package with selected footage, five-second images, independent shot/sequence sound edits, a narrative rough cut, and shot markers/metadata. Full source files are copied. Import in Resolve separately. Free.</p>
                    <button className="btn btn-primary btn-sm" onClick={exportResolve}>Create Resolve package</button>
                    <div id="resolveExportResult" className="text-sm" style={RESULT}>
                        {resolve?.text}
                        {resolve?.result && <>Package written to <code>{resolve.result.dest}</code><br />{resolve.result.copied} files, {resolve.result.xml}, {resolve.result.metadata}
                            <br />Not imported into Resolve. Use File &gt; Import &gt; Timeline, or the optional <strong>{resolve.result.script}</strong> after opening Resolve. READ ME.txt explains import, timebase and relinking.{missingLine(resolve.result)}</>}
                    </div>
                </div>
                {LATER.map(f => <Download key={f.id} f={f} />)}
            </div>
            <h3 className="mb-8" style={{ marginTop: 24 }}>Project Bundle</h3>
            <p className="text-sm text-muted mb-8">Export the entire project (data + assets) as a portable archive, or import a bundle from another machine.</p>
            <div className="entity-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                <div className="card" style={CARD}>
                    <div style={ICON}>📦</div>
                    <h3>Export Bundle</h3>
                    <p className="text-sm text-muted mb-8">Download .tar.gz with all project data and assets</p>
                    <button className="btn btn-primary btn-sm" onClick={downloadBundle}>Download Bundle</button>
                </div>
                <div className="card" style={CARD}>
                    <div style={ICON}>📥</div>
                    <h3>Import Bundle</h3>
                    <p className="text-sm text-muted mb-8">Import a project bundle from another machine</p>
                    <input type="file" id="bundleFileInput" accept=".tar.gz,.tgz" style={{ display: 'none' }} onChange={e => legacy.importBundle(e.target)} />
                    <button className="btn btn-secondary btn-sm" onClick={() => document.getElementById('bundleFileInput').click()}>Choose File...</button>
                    {/* importBundle (core) writes this element's text and display itself; React never sets either again. */}
                    <div id="importStatus" className="text-sm mt-8" style={{ display: 'none' }} />
                </div>
            </div>
        </div>
    );
}
