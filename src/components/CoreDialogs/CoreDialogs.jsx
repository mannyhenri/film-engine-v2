import { useLayoutEffect } from 'react';
import VerbatimDialogs from '../VerbatimDialogs.jsx';
import { usePageLoader } from '../../lib/usePageLoader.js';
import * as E from './engine.js';
import frameViewerModal from './frameViewerModal.markup.js';
import frameVersionsModal from './frameVersionsModal.markup.js';
import backgroundPickerModal from './backgroundPickerModal.markup.js';
import confirmGenModal from './confirmGenModal.markup.js';
import shotCardModal from './shotCardModal.markup.js';
import entityInspectModal from './entityInspectModal.markup.js';
import newProjectModal from './newProjectModal.markup.js';
import folderPickerModal from './folderPickerModal.markup.js';
import plateViewerModal from './plateViewerModal.markup.js';
import glossaryModal from './glossaryModal.markup.js';
import productionGuideModal from './productionGuideModal.markup.js';
import projectOnboardingModal from './projectOnboardingModal.markup.js';

/*
 * The dialogs core opens and drives itself: the frame viewer and its versions, the background picker, the paid confirmation, the shot card, the entity inspector, a new project, the folder picker, the plate viewer, the glossary, the production guide and project onboarding. Their handlers are core's own functions (and what React pages provide by name).
 *
 * Each is the source's own markup, moved verbatim, rendered once at boot (hidden) where the source put it, and never
 * re-rendered (VerbatimDialogs.jsx). src/components/dialogs.test.jsx holds each to the reference element.
 */
const DIALOGS = [
    { html: frameViewerModal },
    { html: frameVersionsModal },
    { html: backgroundPickerModal },
    { html: confirmGenModal },
    { html: shotCardModal },
    { html: entityInspectModal },
    { html: newProjectModal },
    { html: folderPickerModal },
    { html: plateViewerModal },
    { html: glossaryModal },
    { html: productionGuideModal },
    { html: projectOnboardingModal },
];

export const ENGINE = Object.entries(E).filter(([, v]) => typeof v === 'function');

export default function CoreDialogs() {
    // Onboarding, which core starts by name: the project list's "Show me around", openProject on a first open, and its
    // Escape handler.
    usePageLoader('startProjectOnboarding', E.startProjectOnboarding);
    usePageLoader('maybeShowProjectOnboarding', E.maybeShowProjectOnboarding);
    usePageLoader('dismissProjectOnboarding', E.dismissProjectOnboarding);
    // Core's production guide shows which onboarding steps are done.
    usePageLoader('getOnboardingState', E.getOnboardingState);
    // What only these dialogs call (engine.js): on window while mounted, as the dialogs' inline handlers call it by name.
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, fn] of ENGINE) { prior[name] = window[name]; window[name] = fn; }
        return () => { for (const [name] of ENGINE) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; } };
    }, []);
    return <VerbatimDialogs dialogs={DIALOGS} />;
}
