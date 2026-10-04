import { useLayoutEffect } from 'react';
import * as E from './engine.js';

/*
 * A shared module of core, as a component (react.json): mounted once at boot, it renders nothing and puts every name
 * its engine exports on window (functions and values), so every page's and component's bridge, the inline handlers in
 * the HTML they draw, and core callers that stay all reach them by name, exactly as they reached core's.
 * It provides exactly what it replaces (tools/tests/react-pages.test.js).
 */
export const EXPORTS = Object.entries(E);

export default function VideoPipeline() {
    useLayoutEffect(() => {
        const prior = {};
        for (const [name, v] of EXPORTS) { prior[name] = window[name]; window[name] = v; }
        return () => { for (const [name] of EXPORTS) { if (prior[name] === undefined) delete window[name]; else window[name] = prior[name]; } };
    }, []);
    return null;
}
