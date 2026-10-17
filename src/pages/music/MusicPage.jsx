import { useLayoutEffect } from 'react';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import Lists from './lists.jsx';

/*
 * Music & Sound, as React: the sound library, and each scene's ambient bed and imported music. This page OWNS the music engine (engine.js, the legacy music chunk moved): it registers every engine function on window while mounted, because the engine draws HTML with inline handlers that call them by name, and the sound dialog calls its preview and generate by name (react.json provides). Music-making (Music Cues, the Score, score generation) was retired by the user (tools/split-lib.js RETIRED).
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function MusicPage() {
    usePageLoader('loadMusic', E.loadMusic);
    // What legacy code calls by name (react.json provides).
    usePageLoader('soundGenPreview', E.soundGenPreview);
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
                Scenes
            </h3>
            {' '}
            <p className="text-sm text-muted" style={{ "margin": "0 0 10px" }}>
                Each scene’s ambient bed, the music you bring in for it, and its direction.
            </p>
            {' '}
            <div className="entity-grid" id="musicGrid" style={{ "gridTemplateColumns": "repeat(auto-fill,minmax(300px,1fr))" }}></div>
            {' '}
        </div>
        </>
    );
}
