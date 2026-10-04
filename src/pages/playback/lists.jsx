import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';

// The playlist the player draws (renderPlaylist, into #pbPlaylist), one row per timeline entry in running order.
// Enter goes to the shot found, as clicking its row does.
export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="pbPlaylist" item=":scope > .pb-playlist-item"
        rows={() => (legacy.pb.timeline && legacy.pb.timeline.entries) || []} onFind={(e) => window.pbGoTo(e.index)} />;
}
