import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';

// The cue list the music engine draws (loadMusicCues, into #musicCueList), from core's state.musicCues.
export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="musicCueList" item=":scope > .cue-card" rows={() => legacy.state.musicCues} />;
}
