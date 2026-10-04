import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import LegacyElement from './LegacyElement.jsx';

/*
 * Dialogs held as the source's own markup, moved verbatim into *.markup.js modules, rendered once at boot (hidden;
 * showModal opens one by id) and never re-rendered: LegacyElement creates each element once and then leaves it to
 * the code that opens, fills and closes it. Each goes where the source put it: <body>, or inside .main (`inMain`),
 * which the shell renders in the same commit, so that one is placed by a layout effect once .main exists.
 *
 * dialogs: [{ html, inMain? }]. src/components/dialogs.test.jsx holds every dialog to the reference element.
 */
export default function VerbatimDialogs({ dialogs }) {
    const [main, setMain] = useState(null);
    useLayoutEffect(() => { if (dialogs.some(d => d.inMain)) setMain(document.querySelector('.main')); }, [dialogs]);
    // Rendered to static HTML (tools/assemble-page.js, no document): inline, where they would be portaled.
    if (typeof document === 'undefined') return <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: dialogs.map(d => d.html).join('\n') }} />;
    const at = (inMain) => dialogs.map((d, i) => [d, i]).filter(([d]) => !!d.inMain === inMain).map(([d, i]) => <LegacyElement key={i} html={d.html} />);
    return (
        <>
            {createPortal(<>{at(false)}</>, document.body)}
            {main && createPortal(<>{at(true)}</>, main)}
        </>
    );
}
