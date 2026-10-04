import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from '../music/engine.js';

/*
 * The Score workstation, as React: the frame the score session is drawn into. The lanes, ruler, piano roll, mixer, takes, AI actions and DAW panel are drawn by the music engine (src/pages/music/engine.js, owned by the Music & Sound page, which registers the engine on window).
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export default function MusicWorkstationPage() {
    usePageLoader('loadMusicWorkstation', E.loadMusicWorkstation);

    return (
        <>
        <div className="page" id="page-musicws">
            {' '}
            <div className="flex-between mb-16">
                {' '}
                <h2>
                    Score
                </h2>
                {' '}
                <span className="text-sm text-muted">
                    One ruler for the picture, the emotion and the music. Everything here saves as you change it.
                </span>
                {' '}
            </div>
            {' '}
            <div id="mwRoot">
                <p className="text-muted">
                    Loading the score session...
                </p>
            </div>
            {' '}
        </div>
        </>
    );
}
