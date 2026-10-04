import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * __fePages.ensure(page) loads what a page's code needs before its loader runs: a React page's declared vendors
 * (three.js for the 3D pages, which have no chunk now), else a chunk's dependencies and the chunk.
 */
vi.mock('../pages/registry.js', () => ({
    PAGES: [{ id: 'stagey', chunk: null, react: true, vendors: ['three'] }, { id: 'plain', chunk: null, react: true }],
    CHUNKS: {},
    VENDORS: { three: ['vendor/three.min.js', 'vendor/gltf-loader.js'] },
}));
vi.mock('./project-epoch.js', () => ({ noteOpenProject: () => {} }));
const { installPageLoader } = await import('./pages.js');

let added;
beforeEach(() => {
    added = [];
    vi.spyOn(document.head, 'appendChild').mockImplementation((s) => { added.push(s.src.replace(/^.*\/legacy\//, '')); setTimeout(() => s.onload(), 0); return s; });
    installPageLoader();
});

describe('__fePages.ensure', () => {
    it('loads a React page\'s declared vendors, in order, before resolving', async () => {
        await window.__fePages.ensure('stagey');
        expect(added).toEqual(['vendor/three.min.js', 'vendor/gltf-loader.js']);
    });
    it('loads nothing for a React page that declares none', async () => {
        await window.__fePages.ensure('plain');
        expect(added).toEqual([]);
    });
});
