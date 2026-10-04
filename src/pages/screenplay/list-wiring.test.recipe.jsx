// How screenplay's list (the scene navigator) is mounted for src/pages/list-wiring.test.jsx.
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.heading,
    async open() {
        installLegacy();
        window.escapeHtml = (t) => String(t); // the fake core's returns nothing, and the navigator draws through it
        Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {});
        const Page = (await import('./ScreenplayPage.jsx')).default;
        const E = await import('./engine.js');
        render(<Page />);
        const editor = document.getElementById('screenplayEditor');
        const block = (type, text) => `<div class="sp-block" data-element-type="${type}">${text}</div>`;
        editor.innerHTML = [
            block('scene-heading', 'INT. DINER - NIGHT'), block('character', 'RAY'), block('dialogue', 'Coffee.'),
            block('scene-heading', 'EXT. STREET - DAY'), block('character', 'JUNE'), block('dialogue', 'Run.'),
            block('scene-heading', 'INT. ROOF - DUSK'), block('character', 'MAYA'), block('dialogue', 'Look.'),
        ].join('');
        await act(async () => { E.updateSceneNavigator(); await new Promise(r => setTimeout(r, 0)); });
        const rows = E.parseSceneOutline(editor).map(s => ({ ...s, cast: s.characters.join(', ') }));
        const items = () => [...document.querySelectorAll('#sceneNavList > .scene-nav-item')];
        const heading = (n) => n.querySelector('.scene-nav-title').textContent;
        return {
            rows,
            keys: () => items().filter(n => !n.classList.contains('list-hidden')).map(heading),
            marked: () => items().filter(n => n.classList.contains('list-find-match')).map(heading),
            found: () => { const n = items().find(x => x.classList.contains('current')); return n && heading(n); },
        };
    },
};
