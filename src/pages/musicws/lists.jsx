import DrawnListControls from '../../lib/drawn-list.jsx';
import { legacy } from '../../lib/legacy.js';
import SURFACE from './list-surface.js';

// The lanes the music engine draws (mwRender, into #mwRoot), from core's MW.model.tracks. Each lane is a
// .mw-track-wrap whose lane carries its track's id (data-track); hiding one hides its head, its clips and its details.
export default function Lists() {
    return <DrawnListControls surface={SURFACE} container="mwRoot" item=".mw-track-wrap" rows={() => (legacy.MW.model && legacy.MW.model.tracks) || []}
        keys={{ row: r => r.id, el: n => n.querySelector('[data-track]').getAttribute('data-track') }} />;
}
