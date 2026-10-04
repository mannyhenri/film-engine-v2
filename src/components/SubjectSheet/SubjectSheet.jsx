import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import LegacyElement from '../LegacyElement.jsx';
import frame from './frame.markup.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';

/*
 * The location and prop sheet, as React: the modal's frame (frame.markup.js, its markup moved verbatim) is rendered once
 * (always, hidden, so showModal finds it by id), and the engine (engine.js, moved verbatim from the app by tools/extract-engine.js) draws the sheet
 * into it by id: #ssName, #ssChips, #ssBody, as before. Nothing here re-renders while a sheet is open.
 *
 * Every engine function is put on window at mount, as the app had them: the sheet's HTML carries inline handlers
 * that call them by name. What core calls by name is react.json "provides" (registered by name below too): the
 * Locations and Props cards open a sheet, and core's plate and view tools repaint it when their work lands.
 */
export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function SubjectSheet() {
    usePageLoader('openSubjectSheet', E.openSubjectSheet);
    usePageLoader('renderSubjectSheet', E.renderSubjectSheet);
    // Named in an onclick of core's renderLocationViews (the inspector's views panel), which stays core: dead in the app,
    // kept because backend tests read it (tools/split-lib.js KEPT_FOR_TESTS).
    usePageLoader('sweepLocationCompass', E.sweepLocationCompass);
    // The music engine draws a scene's sound sheet with the same section block.
    usePageLoader('ssSection', E.ssSection);
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => { for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; } };
    }, []);
    // The frame is the app's own markup, moved verbatim (frame.markup.js): its header's inline handlers (generateSheetPlate,
    // toggleSheetMode, exportSubjectSheet) are what the backend's layout checks read, and are on window as before.
    // Rendered to static HTML (tools/assemble-page.js, no document): inline, where it would be portaled.
    return typeof document === 'undefined'
        ? <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: frame }} />
        : createPortal(<LegacyElement html={frame} />, document.body);
}
