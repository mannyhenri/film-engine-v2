import DrawnListControls from '../../lib/drawn-list.jsx';
import * as E from './engine.js';
import SURFACE from './list-surface.js';

// The sound library the music engine draws (renderSoundLibrary, into #soundLibGrid), from its own SOUND_LIB. Each card
// carries its file's id (data-sound), so a card is matched to its row by id, inside whichever kind chip is on.
export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="soundLibGrid" item=":scope > .snd-card" rows={() => E.SOUND_LIB.sounds}
        keys={{ row: r => r.id, el: n => n.getAttribute('data-sound') }} />;
}
