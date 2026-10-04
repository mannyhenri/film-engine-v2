import { createPortal } from 'react-dom';
import LegacyElement from '../LegacyElement.jsx';
import sceneCardModal from './sceneCardModal.markup.js';
import newSceneCardModal from './newSceneCardModal.markup.js';
import textConvertModal from './textConvertModal.markup.js';
import suggestionsModal from './suggestionsModal.markup.js';
import versionDiffModal from './versionDiffModal.markup.js';
import titlePageModal from './titlePageModal.markup.js';
import importScriptModal from './importScriptModal.markup.js';

/*
 * The Screenplay's seven dialogs, as one React component: an index card, a new card, text conversion, entity
 * suggestions, a version diff, the title page and script import. Each is the source's own markup, moved verbatim into
 * a *.markup.js module, rendered once at boot (hidden; showModal opens it by id) and never re-rendered.
 *
 * Their handlers are unchanged inline calls: the Screenplay engine's functions (the Screenplay page puts every one
 * on window while mounted, and it is always mounted) and core's editor functions (index cards, versions, title page).
 * Which dialogs are the Screenplay's is derived, not typed: ScreenplayDialogs.test.jsx holds this list to the dialogs
 * the Screenplay page reaches, by handler or by what opens them.
 */
export const DIALOGS = [sceneCardModal, newSceneCardModal, textConvertModal, suggestionsModal, versionDiffModal, titlePageModal, importScriptModal];

export default function ScreenplayDialogs() {
    // Rendered to static HTML (tools/assemble-page.js, no document): inline, where they would be portaled.
    if (typeof document === 'undefined') return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: DIALOGS.join('\n') }} />;
    return createPortal(<>{DIALOGS.map((html, i) => <LegacyElement key={i} html={html} />)}</>, document.body);
}
