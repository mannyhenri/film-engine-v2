import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import bindOnMount from './mount.js';
import Lists from './lists.jsx';

/*
 * Previs, as React: the frame the World Engine console is drawn into. This page OWNS the 3D stage engine (engine.js, the legacy stage3d chunk moved), shared with the 3D models page: it registers every engine function on window while mounted (the engine draws HTML with inline handlers that call them by name), and binds what the chunk bound at load (mount.js: the scrub and camera gestures, the walk and plan keys, the resize repaint, the iPhone scan callback). Both pages declare three.js (react.json vendors), which __fePages.ensure loads before the loader.
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function PrevisPage() {
    usePageLoader('loadPrevisPage', E.loadPrevisPage);
    // What legacy code calls by name (react.json provides).
    usePageLoader('worldSyncPanelShots', E.worldSyncPanelShots);

    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    // What the legacy code bound at load (./mount.js): bound while the page is mounted.
    useLayoutEffect(() => bindOnMount(), []);
    return (
        <>
            <Lists />
        <div className="page" id="page-previs">
            {' '}
            {/*
              The Previs page is the World Engine console, rendered in here by
              worldConsoleRender(). The old stage (inspector, grey-box canvas,
              twelve-button toolbar) was removed; its blocking is still what
              generation reads, and the console edits it.
            */}
            {' '}
            <div className="card" id="previsConsoleOff" style={{ "display": "none", "maxWidth": "560px" }}>
                {' '}
                <h3 className="mb-8">
                    Previs is the World Engine console
                </h3>
                {' '}
                <p className="text-sm text-muted" style={{ "lineHeight": "1.5" }}>
                    {" It is switched off on this machine (the "}
                    <code>
                        world_engine
                    </code>
                    {" setting), so there is nothing to show here. Blocking a shot still reaches generation from the scene card and from an agent over MCP. "}
                </p>
                {' '}
            </div>
            {' '}
        </div>
        </>
    );
}
