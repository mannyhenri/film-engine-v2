import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import Lists from './lists.jsx';

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
    usePageLoader('loadProductionGraph', E.loadProductionGraph);
    // What core calls by name (react.json provides): the side panel the flag draws, Flows' way back, the in-between modals.
    usePageLoader('pgNode', E.pgNode);
    usePageLoader('pgShots', E.pgShots);
    usePageLoader('pgVisible', E.pgVisible);
    usePageLoader('pgCollapsedOf', E.pgCollapsedOf);
    usePageLoader('flowBackToGraph', E.flowBackToGraph);
    usePageLoader('ibCloseSetup', E.ibCloseSetup);
    usePageLoader('ibCloseDirect', E.ibCloseDirect);
    usePageLoader('pgEnsureSide', E.pgEnsureSide);
    usePageLoader('pgSideClick', E.pgSideClick);
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    return (
        <div className="page" id="page-productiongraph">
            <Lists />
            <div className="pg-header">
                <h2>Production</h2>
                <span className="pg-meta" id="pgMeta"></span>
                <span className="pg-legend" id="pgLegend"></span>
                <div className="pg-chips" id="pgScenes"></div>
                <div style={{ flexGrow: 1 }}></div>
                <button className="pg-hbtn" title="Re-place the nodes you haven't moved" onClick={() => E.pgTidy()}>Tidy layout</button>
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
                        <button className="pg-sbtn" style={{ height: 24 }} onClick={() => E.pgFit()}>Fit</button>
                        <span style={{ width: 1, height: 16, background: '#2c2c34', margin: '0 2px' }}></span>
                        <span className="pg-legend">
                            <span><i style={{ background: '#c07ce0' }}></i>image</span><span><i style={{ background: '#e2c15a' }}></i>video</span>
                            <span><i style={{ background: '#57c98a' }}></i>audio</span><span><i style={{ background: '#8a8aff' }}></i>scene</span>
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
    );
}
