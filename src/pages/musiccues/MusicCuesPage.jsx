import { usePageLoader } from '../../lib/usePageLoader.js';
import { legacy } from '../../lib/legacy.js';
import * as E from '../music/engine.js';
import Lists from './lists.jsx';

/*
 * Music Cues, as React: the cue list. Its loader is the music engine's (src/pages/music/engine.js, owned by the Music & Sound page, which registers the engine on window).
 *
 * The frame is GENERATED from the legacy markup by tools/make-react-page.js (tools/html-to-jsx.js); its test holds it
 * to the reference markup element by element. Regenerate it rather than editing the frame by hand.
 */
export default function MusicCuesPage() {
    usePageLoader('loadMusicCues', E.loadMusicCues);

    return (
        <>
            <Lists />
        <div className="page" id="page-musiccues">
            {' '}
            <div className="flex-between mb-16">
                {' '}
                <h2>
                    Music Cues
                </h2>
                {' '}
                <button className="btn btn-primary" onClick={(event) => legacy.showModal('musicCueModal')}>
                    + Music Cue
                </button>
                {' '}
            </div>
            {' '}
            <div id="musicCueList"></div>
            {' '}
        </div>
        </>
    );
}
