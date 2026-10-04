// How threed's two lists are mounted for src/pages/list-wiring.test.jsx: open('threed-subjects') or open('threed-models').
import { render, act } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';

export default {
    rowKey: r => r.name || r.file_name,
    async open(id) {
        installLegacy({ routes: {
            'GET /projects/p1/characters': { characters: [{ id: 'c1', name: 'RAY' }, { id: 'c2', name: 'JUNE' }] },
            'GET /projects/p1/props': { props: [{ id: 'p1', name: 'SEDAN' }] },
            'GET /projects/p1/models': { models: [
                { asset_id: 'm1', file_name: 'ray.glb', format: 'glb', metadata: { kind: 'model_rigged' } },
                { asset_id: 'm2', file_name: 'sedan.fbx', format: 'fbx', metadata: { kind: 'model_3d' } },
                { asset_id: 'm3', file_name: 'dragon.obj', format: 'obj', metadata: { kind: 'model_animated' } },
            ] },
        } });
        window.esc = (t) => String(t);
        const Page = (await import('./ThreeDPage.jsx')).default;
        render(<Page />);
        await act(async () => { await window.loadThreeD(); await new Promise(r => setTimeout(r, 0)); });
        const grid = id === 'threed-subjects' ? 'threedSubjects' : 'threedModels';
        const all = () => [...document.querySelectorAll(`#${grid} > .entity-card`)];
        const rows = id === 'threed-subjects'
            ? [{ order: 0, name: 'RAY', kind: 'character' }, { order: 1, name: 'JUNE', kind: 'character' }, { order: 2, name: 'SEDAN', kind: 'prop' }]
            : [{ order: 0, file_name: 'ray.glb', kind: 'model_rigged', format: 'glb' }, { order: 1, file_name: 'sedan.fbx', kind: 'model_3d', format: 'fbx' },
               { order: 2, file_name: 'dragon.obj', kind: 'model_animated', format: 'obj' }];
        return { rows, keys: () => all().filter(n => !n.classList.contains('list-hidden')).map(n => n.querySelector('h3').textContent) };
    },
};
