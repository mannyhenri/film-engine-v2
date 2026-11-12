import { useCallback, useLayoutEffect, useState } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { legacy } from '../../lib/legacy.js';
import * as E from './engine.js';
import Lists from './lists.jsx';
import './production-lineage.css';
import StoryboardPrint from '../../components/StoryboardPrint/StoryboardPrint.jsx';
import DepthWorkbench from '../../components/DepthWorkbench/DepthWorkbench.jsx';
import CompositeWorkbench from '../../components/CompositeWorkbench/CompositeWorkbench.jsx';
import ProductionStudio from './studio/ProductionStudio.jsx';

/*
 * The Production graph, as React: the page's frame is rendered once, and the engine (engine.js, moved verbatim
 * from public/legacy/production-graph.js) draws the graph into it by id: the header's meta, legend and scene
 * chips, the canvas world, the minimap, the queue strip, playback under the graph, the drawer and the menu.
 * Nothing here re-renders while the graph is used.
 *
 * Every engine function is also put on window at mount, as the legacy script had them: the engine draws HTML
 * with inline handlers (nodes, the drawer, menus, the queue) that call them by name, and core's flag and side
 * panel call some of them too (those are react.json "provides", registered by name below as well).
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function ProductionGraphPage() {
    // Generate and Cut are the page now. The old graph has no tab (the user removed it); its markup stays mounted and
    // hidden, because its engine draws by id, loads the graph both tabs read, and core calls into it.
    const [view, setView] = useState('generate');
    /*
     * ONE read of the production graph feeds both: the engine's load (deduplicated per film, guarded against a
     * film switch) and then the studio, which is handed the graph the engine just accepted. A second fetch here
     * would double every page open and race the engine's own project-switch guard.
     */
    const [graph, setGraph] = useState(null);
    const load = useCallback(async (...args) => {
        const out = await E.loadProductionGraph(...args);
        const g = legacy.PG && legacy.PG.graph;
        const pid = legacy.state.currentProject && legacy.state.currentProject.id;
        if (g && Array.isArray(g.nodes) && (!g.project_id || g.project_id === pid)) setGraph(g);
        return out;
    }, []);
    const reload = useCallback(() => load(true), [load]);
    // Switching tab re-reads what the engine holds, so a change made through it since is picked up.
    const changeView = useCallback((id) => {
        setView(id);
        const g = legacy.PG && legacy.PG.graph;
        if (g && Array.isArray(g.nodes)) setGraph(g);
    }, []);
    usePageLoader('loadProductionGraph', load);
    // The graph's side panel (shot outline, node palette; pgEnsureSide puts it in the app's phase list) belonged to
    // the classic graph only: studio.css hides it unless this says "graph", which no tab does any more.
    useLayoutEffect(() => { document.documentElement.dataset.pgView = view; }, [view]);
    useLayoutEffect(() => () => { delete document.documentElement.dataset.pgView; }, []);
    // What core calls by name (react.json provides): the side panel and the in-between modals.
    usePageLoader('pgNode', E.pgNode);
    usePageLoader('pgShots', E.pgShots);
    usePageLoader('pgVisible', E.pgVisible);
    usePageLoader('pgCollapsedOf', E.pgCollapsedOf);
    usePageLoader('ibCloseSetup', E.ibCloseSetup);
    usePageLoader('ibCloseDirect', E.ibCloseDirect);
    usePageLoader('pgEnsureSide', E.pgEnsureSide);
    usePageLoader('pgSideClick', E.pgSideClick);
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { if (name === 'loadProductionGraph') continue; prior[name] = window[name]; window[name] = fn; } // the loader is the page's (above)
        return () => {
            // A remount before the legacy core has run (boot, App.boot.test.jsx) has no PG to dispose; throwing here
            // would take the page's boundary down with it.
            try { E.pgDispose(); } catch (_) { /* nothing was mounted against a core */ }
            for (const [name] of ENGINE) { if (name === 'loadProductionGraph') continue; if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    return (
        <div className="page" id="page-productiongraph">
            <ProductionStudio graph={graph} reload={reload} onTabChange={changeView} />
            <div className="pg-classic" hidden>
            <Lists />
            <div className="pg-header">
                <h2>Graph</h2>
                <span className="pg-meta" id="pgMeta"></span>
                <span className="pg-legend" id="pgLegend"></span>
                <div className="pg-chips" id="pgScenes"></div>
                <div style={{ flexGrow: 1 }}></div>
                <StoryboardPrint className="pg-hbtn" />
                <DepthWorkbench />
                <CompositeWorkbench />
                <button className="pg-hbtn" title="Re-place the nodes you haven't moved" onClick={() => E.pgTidy()}>Tidy layout</button>
                <button className="pg-hbtn" id="pgArrange" title="Stack all scenes and their workflows vertically. Previous manual placements can be restored with Undo." onClick={() => E.pgArrange()}>Arrange vertically</button>
                <button className="pg-hbtn" id="pgUndoArrange" hidden onClick={() => E.pgArrange(true)}>Undo arrangement</button>
                <button className="pg-hbtn" id="pgLockBtn" title="Nothing that replaces a frame runs while the board is locked" onClick={() => E.pgToggleLock()}>Lock board</button>
                <button className="pg-hbtn" id="pgRunChangedBtn" title="Redo only what is behind, in order, after one confirmation" onClick={() => E.pgRunChanged()}>Run what changed</button>
                <button className="pg-hbtn primary" id="pgRunBtn" onClick={() => E.pgRunPending()}>Run pending</button>
            </div>
            <div className="pg-body" id="pgBody">
                <div className="pg-canvas" id="pgCanvas">
                    <div className="pg-world" id="pgWorld"></div>
                    <div className="pg-empty">Loading the graph&hellip;</div>
                    <div className="pg-furniture">
                        <button className="pg-zbtn" aria-label="Zoom out" onClick={() => E.pgZoomBy(1 / 1.15)}>&minus;</button>
                        <span className="pg-zoom" id="pgZoom">90%</span>
                        <button className="pg-zbtn" aria-label="Zoom in" onClick={() => E.pgZoomBy(1.15)}>+</button>
                        <button className="pg-sbtn" style={{ height: 24 }} title="Focus the selected shot or sequence work area" onClick={() => E.pgFocusWorkspace()}>Focus</button>
                        <button className="pg-sbtn" style={{ height: 24 }} title="Fit all scenes and versions" onClick={() => E.pgFit()}>Fit</button>
                        <span style={{ width: 1, height: 16, background: '#2c2c34', margin: '0 2px' }}></span>
                        <span className="pg-legend">
                            <span><i style={{ background: '#c07ce0' }}></i>image</span><span><i style={{ background: '#e2c15a' }}></i>video</span>
                            <span><i style={{ background: '#57c98a' }}></i>audio</span><span><i style={{ background: '#8a8aff' }}></i>Sound</span>
                            <span><i style={{ background: '#56c8d8' }}></i>plates</span>
                        </span>
                    </div>
                    <div className="pg-minimap" id="pgMinimap" title="Click to move the view"></div>
                </div>
                <div className="pg-queue" id="pgQueue"></div>
                <div className="pg-playback" id="pgPlayback"></div>
                <aside className="pg-drawer" id="pgDrawer" aria-label="Inspector">
                    <div className="pg-dscroll" id="pgDrawerBody"></div>
                    <div className="pg-dfoot" id="pgDrawerFoot"></div>
                </aside>
            </div>
            <div className="pg-menu" id="pgMenu" hidden></div>
            </div>
        </div>
    );
}
