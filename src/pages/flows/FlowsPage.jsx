import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import { legacy } from '../../lib/legacy.js';
import * as E from './engine.js';
import bindOnMount from './canvas-pointer.js';

/*
 * Flows, as React: the page's frame is rendered once and the engine (engine.js, the graph chunk moved verbatim by tools/extract-engine.js) draws the node palette, the canvas and the inspector into it by id. FLOW, the canvas state, stays in core: the router and the Production graph read it.
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function FlowsPage() {
    usePageLoader('loadFlowsPage', E.loadFlowsPage);

    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    // What the legacy code bound at load (./canvas-pointer.js): bound while the page is mounted.
    useLayoutEffect(() => bindOnMount(), []);
    return (
        <>
        <div className="page" id="page-flows">
            {' '}
            <div className="flex-between mb-16">
                {' '}
                <div style={{ "display": "flex", "gap": "10px", "alignItems": "center" }}>
                    {' '}
                    <button className="btn btn-secondary btn-sm" id="flowBackToGraph" hidden onClick={(event) => legacy.flowBackToGraph()} title="Return to the Production graph you opened this flow from">
                        ← Back to the graph
                    </button>
                    {' '}
                    <h2>
                        Flows
                    </h2>
                    {' '}
                </div>
                {' '}
                <div style={{ "display": "flex", "gap": "8px", "alignItems": "center" }}>
                    {' '}
                    <select id="flowSelect" style={{ "minWidth": "260px" }} onChange={(event) => E.flowCanvasOpen(event.currentTarget.value)}></select>
                    {' '}
                    <button className="btn btn-secondary" onClick={(event) => E.flowCanvasNew()}>
                        New flow
                    </button>
                    {' '}
                    <button className="btn btn-secondary" onClick={(event) => E.flowCanvasFromTemplate()}>
                        From template
                    </button>
                    {' '}
                    <button className="btn btn-secondary" onClick={(event) => E.flowCanvasDuplicate()}>
                        Duplicate
                    </button>
                    {' '}
                    <button className="btn btn-secondary" onClick={(event) => E.flowCanvasSave()} id="flowSaveBtn">
                        Save
                    </button>
                    {' '}
                    <button className="btn btn-primary" onClick={(event) => E.flowCanvasRun()} id="flowRunBtn">
                        Run flow
                    </button>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
            <div className="flow-workspace">
                {' '}
                <aside className="flow-palette" id="flowPalette"></aside>
                {' '}
                <div className="flow-canvas-wrap">
                    {' '}
                    <svg id="flowCanvas" className="flow-canvas" onMouseDown={(event) => E.flowCanvasBackgroundDown(event.nativeEvent)}></svg>
                    {' '}
                    <div className="flow-toolbar">
                        {' '}
                        <button className="btn btn-sm" onClick={(event) => E.flowCanvasZoom(-0.15)}>
                            −
                        </button>
                        {' '}
                        <span id="flowZoomLabel" className="text-sm text-muted">
                            100%
                        </span>
                        {' '}
                        <button className="btn btn-sm" onClick={(event) => E.flowCanvasZoom(0.15)}>
                            +
                        </button>
                        {' '}
                        <button className="btn btn-sm" onClick={(event) => E.flowCanvasFit()}>
                            Fit
                        </button>
                        {' '}
                        <button className="btn btn-sm" onClick={(event) => E.flowCanvasDeleteSelected()}>
                            Delete
                        </button>
                        {' '}
                        <span className="flow-status" id="flowStatus"></span>
                        {' '}
                    </div>
                    {' '}
                </div>
                {' '}
                <aside className="flow-inspector" id="flowInspector">
                    {' '}
                    <p className="text-sm text-muted">
                        Select a node to edit it.
                    </p>
                    {' '}
                </aside>
                {' '}
            </div>
            {' '}
            <div className="card mt-16" id="flowRunPanel" style={{ "display": "none" }}>
                {' '}
                <h3 className="mb-8">
                    Run
                </h3>
                {' '}
                <div id="flowRunOutput" className="text-sm"></div>
                {' '}
            </div>
            {' '}
        </div>
        </>
    );
}
