import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import Lists from './lists.jsx';

/*
 * Music & Sound, as React: the sound library and the cue sheet. This page OWNS the music engine (engine.js, the legacy music chunk moved), shared with Music Cues and the Score: it registers every engine function on window while mounted, because the engine draws HTML with inline handlers that call them by name, and core calls the DAW panel's and the score's functions by name (react.json provides).
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function MusicPage() {
    usePageLoader('loadMusic', E.loadMusic);
    // What legacy code calls by name (react.json provides).
    usePageLoader('mwSave', E.mwSave);
    usePageLoader('dawRefresh', E.dawRefresh);
    usePageLoader('dawReadSession', E.dawReadSession);
    usePageLoader('dawPlanPush', E.dawPlanPush);
    usePageLoader('dawPush', E.dawPush);
    usePageLoader('dawPlanPull', E.dawPlanPull);
    usePageLoader('dawPull', E.dawPull);
    usePageLoader('dawTransport', E.dawTransport);
    usePageLoader('dawExportPackage', E.dawExportPackage);
    usePageLoader('dawImportPackage', E.dawImportPackage);
    usePageLoader('mwTogglePlay', E.mwTogglePlay);
    usePageLoader('cueClearSections', E.cueClearSections);
    usePageLoader('soundGenPreview', E.soundGenPreview);
    usePageLoader('cueAddSection', E.cueAddSection);
    usePageLoader('createMusicCue', E.createMusicCue);
    usePageLoader('runSoundGenerate', E.runSoundGenerate);

    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => {
            for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; }
        };
    }, []);
    return (
        <>
            <Lists />
        <div className="page" id="page-music">
            {' '}
            <div className="flex-between mb-16">
                {' '}
                <h2>
                    {"Music & Sound"}
                </h2>
                {' '}
                <button className="btn btn-primary" onClick={(event) => E.generateAllMusic()}>
                    Generate All (score + ambient)
                </button>
                {' '}
            </div>
            {' '}
            <div id="musicProgress" style={{ "display": "none" }} className="mb-16">
                {' '}
                <div className="text-sm text-muted mb-8" id="musicProgressLabel">
                    Starting...
                </div>
                {' '}
                <div style={{ "background": "var(--gl-bg-surface)", "borderRadius": "var(--gl-radius-md)", "height": "10px", "overflow": "hidden" }}>
                    {' '}
                    <div id="musicProgressBar" style={{ "height": "100%", "width": "0%", "background": "var(--gl-accent,#6366f1)", "transition": "width .2s" }}></div>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
            {/*
                THE LIBRARY. Every audio file in the project, one card each.
                The cue sheet below is about INTENTIONS — music somebody wrote
                a brief for. This is about files that exist, which is a
                different list and, on a real project, a far longer one:
                dialogue is not a cue, so a cue-shaped page could never show
                86 of the 95 sounds in the film.
            */}
            {' '}
            <div className="flex-between mb-8" style={{ "alignItems": "flex-end" }}>
                {' '}
                <div>
                    {' '}
                    <h3 style={{ "margin": "0" }}>
                        Sound library
                    </h3>
                    {' '}
                    <p className="text-sm text-muted" style={{ "margin": "2px 0 0" }} id="soundLibCount">
                        {"\u00a0"}
                    </p>
                    {' '}
                </div>
                {' '}
                <div style={{ "display": "flex", "gap": "8px", "alignItems": "center" }}>
                    {' '}
                    <div id="soundLibFilters" style={{ "display": "flex", "gap": "6px" }}></div>
                    {' '}
                    <button className="btn btn-primary" onClick={(event) => E.openSoundGenerator()}>
                        + Generate sound
                    </button>
                    {' '}
                </div>
                {' '}
            </div>
            {' '}
            <div className="entity-grid" id="soundLibGrid" style={{ "gridTemplateColumns": "repeat(auto-fill,minmax(280px,1fr))", "marginBottom": "28px" }}></div>
            {' '}
            <h3 style={{ "margin": "0 0 2px" }}>
                Cues
            </h3>
            {' '}
            <p className="text-sm text-muted" style={{ "margin": "0 0 10px" }}>
                What the music should be, per scene — the brief a score is generated from.
            </p>
            {' '}
            <div className="entity-grid" id="musicGrid" style={{ "gridTemplateColumns": "repeat(auto-fill,minmax(300px,1fr))" }}></div>
            {' '}
        </div>
        </>
    );
}
