// How previs's list (the shot list in the side panel) is mounted for src/pages/list-wiring.test.jsx.
import { onTestFinished } from 'vitest';
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.id,
    // The console layout puts the list in the app's side panel (the default); without it, the console's own rail.
    variants: ['panel', 'rail'],
    async open(_, variant) {
        const rows = [
            { id: 'a', shot_code: '1A', location: 'DINER', scene_number: 1 },
            { id: 'b', shot_code: '2A', location: 'STREET', scene_number: 2 },
            { id: 'c', shot_code: '3A', location: 'ROOF', scene_number: 3 },
        ];
        const flags = { world_engine: '1', previs_console: variant === 'panel' ? '1' : '0' };
        const { fake } = installLegacy({ routes: { 'GET /settings': { settings: flags } } });
        fake.WORLD.shots = rows;
        const panel = document.createElement('div');
        panel.className = 'fe-panel';
        document.body.appendChild(panel); // the app's side panel, which the page does not render itself
        onTestFinished(() => panel.remove());
        const Page = (await import('./PrevisPage.jsx')).default;
        const E = await import('./engine.js');
        render(<Page />);
        Object.keys(E.WORLD_FLAGS || {}).forEach(k => { E.WORLD_FLAGS[k] = flags[k]; }); // cached once per module
        await act(async () => {
            await E.worldLoadFlags();
            Object.assign(E.WORLD_FLAGS, flags);
            if (variant === 'panel') E.worldSyncPanelShots('previs');
            else {
                // The console's own rail, drawn by the engine (worldRailHtml) into #worldConsole where worldConsoleRender
                // puts it; the rest of the console paints a canvas, which the test DOM does not have.
                const page = document.getElementById('page-previs');
                const host = document.getElementById('worldConsole') || page.insertBefore(Object.assign(document.createElement('div'), { id: 'worldConsole' }), page.firstChild);
                host.innerHTML = E.worldRailHtml();
            }
            await new Promise(r => setTimeout(r, 0));
        });
        const sel = variant === 'panel' ? '#fePanelShots button.pv-shot[onclick^="worldRailSelect"]' : '#worldConsole button.we-shot[onclick^="worldRailSelect"]';
        const id = (n) => n.getAttribute('onclick').match(/'([^']+)'/)[1];
        return { rows, keys: () => [...document.querySelectorAll(sel)].filter(n => !n.classList.contains('list-hidden')).map(id) };
    },
};
