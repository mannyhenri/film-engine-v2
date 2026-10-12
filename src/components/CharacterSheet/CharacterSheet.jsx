import { useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import LegacyElement from '../LegacyElement.jsx';
import frame from './frame.markup.js';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import {customizeExpression, selectExpressionVersion, uploadExpression, chooseExpressionReference, generateExpression} from './expressions.jsx';

/*
 * The character sheet, as React: the modal's frame (frame.markup.js, its markup moved verbatim) is rendered once
 * (always, hidden, so showModal finds it by id), and the engine (engine.js, moved verbatim from the app by
 * tools/extract-engine.js) draws the sheet into it by id: #csName, #csChips, #csBody, as before.
 *
 * Every engine function is put on window at mount, as the app had them: the sheet's HTML carries inline handlers
 * that call them by name. What other code calls by name is react.json "provides" (registered by name below too): the
 * Characters cards and core's inspector open the sheet and repaint it, and the location and prop sheet shares the
 * sheet mode (toggleSheetMode, sheetEditable) and slotUpload with it.
 */
export const ENGINE = Object.entries({...E,customizeExpression,selectExpressionVersion,uploadExpression,chooseExpressionReference,generateExpression}).filter(([, v]) => typeof v === 'function');

export default function CharacterSheet() {
    usePageLoader('openCharacterSheet', E.openCharacterSheet);
    usePageLoader('renderCharacterSheet', E.renderCharacterSheet);
    usePageLoader('toggleSheetMode', E.toggleSheetMode);
    usePageLoader('sheetEditable', E.sheetEditable);
    usePageLoader('slotUpload', E.slotUpload);
    // Named in an onclick of core's characterViewsHtml (the turnaround panel), which stays core.
    usePageLoader('deleteCharacterView', E.deleteCharacterView);
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => { for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; } };
    }, []);
    // The frame is the app's own markup, moved verbatim (frame.markup.js): its header's inline handlers are what the
    // backend's layout checks read, and are on window as before.
    // Rendered to static HTML (tools/assemble-page.js, no document): inline, where it would be portaled.
    return typeof document === 'undefined'
        ? <div style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: frame }} />
        : createPortal(<LegacyElement html={frame} />, document.body);
}
