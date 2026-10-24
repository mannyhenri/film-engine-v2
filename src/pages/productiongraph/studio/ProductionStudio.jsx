import { useCallback, useEffect, useState } from 'react';
import { legacy } from '../../../lib/legacy.js';
import DirectStudio from './DirectStudio.jsx';
import CutTab from './CutTab.jsx';
import GeneratorsTab from './GeneratorsTab.jsx';
import './studio.css';

/*
 * Production, as three tabs:
 *   Generate — the Direct studio: pick shots (group two or more as a sequence),
 *              direct acting, camera, dialogue, sound and light on a timeline,
 *              watch the prompt rebuild beat by beat, check it against the
 *              Higgsfield model, send.
 *   Cut      — the rough edit, footage or not: picked shots in order, sound
 *              wired to them, sent to DaVinci Resolve as a timeline.
 *   Generators — local AI tools on any dropped video: slow motion (a marked section), upscale (the
 *              whole file), depth, rotoscope, stems, subtitles; results to drag into Resolve.
 * The old node graph has no tab any more (the user removed it); the page still
 * mounts its engine out of sight, because it loads the graph both tabs read and
 * hosts features not yet moved (in-betweens, depth, compositing, version picks).
 *
 * The page hands both tabs the graph the engine loaded (one read per film).
 */
const TABS = [['generate', 'Generate'], ['cut', 'Cut'], ['generators', 'Generators']];

export default function ProductionStudio({ graph, reload, onTabChange }) {
    const [tab, setTab] = useState('generate');
    const [catalog, setCatalog] = useState({ models: [], connected: false });
    // Read when the graph arrives, never during the first render: App mounts before the legacy core exists.
    const pid = graph ? (graph.project_id || legacy.state.currentProject?.id) : null;

    const reloadCatalog = useCallback(async () => {
        try { const r = await legacy.api('/production-studio/higgsfield-models'); setCatalog({ connected: !!r?.connected, models: Array.isArray(r?.models) ? r.models : [],
            website_models:Array.isArray(r?.website_models)?r.website_models:[],api_modes:Array.isArray(r?.api_modes)?r.api_modes:[] }); }
        catch (err) { legacy.setStatus('Higgsfield models: ' + err.message); }
    }, []);

    const ready = !!graph;
    useEffect(() => {
        if (!ready) return;
        reloadCatalog();
    }, [ready, reloadCatalog]);

    const choose = (id) => { setTab(id); onTabChange && onTabChange(id); };

    return (
        <div className="ps">
            <div className="ps-bar">
                <h2>Production</h2>
                <div className="ps-tabs" role="tablist" aria-label="Production views">
                    {TABS.map(([id, label]) => (
                        <button key={id} role="tab" type="button" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => choose(id)}>{label}</button>
                    ))}
                </div>
                {tab === 'generate' && graph && <span className="ps-mono">{legacy.state.currentProject?.name || ''}</span>}
                <div style={{ flex: 1 }} />
                {tab === 'generate' && <span className="ds-pill live">Prompt rebuilds as you direct</span>}
                {/* API keys are Settings' alone (Settings › API keys): Production shows no key status. */}
            </div>
            {tab === 'generate' && <DirectStudio pid={pid} graph={graph} catalog={catalog} reload={reload} />}
            {tab === 'cut' && <CutTab pid={pid} graph={graph} />}
            {tab === 'generators' && <GeneratorsTab />}
        </div>
    );
}
