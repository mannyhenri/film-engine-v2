import VerbatimDialogs from '../VerbatimDialogs.jsx';
import soundGenModal from './soundGenModal.markup.js';

/*
 * The Music & Sound page's dialog: generating a sound. Its handlers are the music engine's functions (src/pages/music provides soundGenPreview, runSoundGenerate) and core's.
 *
 * Each is the source's own markup, moved verbatim, rendered once at boot (hidden) where the source put it, and never
 * re-rendered (VerbatimDialogs.jsx). src/components/dialogs.test.jsx holds each to the reference element.
 */
const DIALOGS = [
    { html: soundGenModal, inMain: true },
];

export default function MusicDialogs() {
    return <VerbatimDialogs dialogs={DIALOGS} />;
}
