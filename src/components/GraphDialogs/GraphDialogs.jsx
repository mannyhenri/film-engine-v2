import VerbatimDialogs from '../VerbatimDialogs.jsx';
import ibSetupModal from './ibSetupModal.markup.js';
import ibDirectModal from './ibDirectModal.markup.js';

/*
 * The Production graph's two in-between dialogs: setting up the shots between two key shots, and directing them. Their handlers are the graph engine's (src/pages/productiongraph provides ibCloseSetup, ibCloseDirect) and core's.
 *
 * Each is the source's own markup, moved verbatim, rendered once at boot (hidden) where the source put it, and never
 * re-rendered (VerbatimDialogs.jsx). src/components/dialogs.test.jsx holds each to the reference element.
 */
const DIALOGS = [
    { html: ibSetupModal },
    { html: ibDirectModal },
];

export default function GraphDialogs() {
    return <VerbatimDialogs dialogs={DIALOGS} />;
}
