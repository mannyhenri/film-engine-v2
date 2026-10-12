import { it, expect, vi, afterEach } from 'vitest';
import { render, act, fireEvent } from '@testing-library/react';
import { installLegacy } from '../../test/setup.js';
import ProductionGraphPage from './ProductionGraphPage.jsx';
import { pgDrawerVersion } from './engine.js';

afterEach(() => vi.restoreAllMocks());

it('Production details label the opened video version, ignoring requested resolution and other versions', async () => {
    const legacy = installLegacy({ project: { id: 'p' } });
    legacy.fake.api = vi.fn(async () => ({}));
    render(<ProductionGraphPage />);
    const body = document.getElementById('pgDrawerBody'), foot = document.getElementById('pgDrawerFoot');
    const n = { key: 'ver:a', asset_id: 'a', type: 'video', url: '/a.mp4', version: 1, selected: true, width: 4096, height: 2160, resolution: '4K' };
    act(() => pgDrawerVersion(n, body, foot, ''));
    let player = body.querySelector('video'), badge = body.querySelector('[data-video-resolution-badge]');
    expect(badge.hidden).toBe(true);
    Object.defineProperties(player, { readyState: { value: 1 }, videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
    fireEvent.loadedMetadata(player);
    expect(badge.hidden).toBe(true); expect(body.textContent).toContain('1920 × 1080 px');
    const oldPlayer = player;
    act(() => pgDrawerVersion({ ...n, asset_id: 'b', key: 'ver:b', version: 2, url: '/b.mp4', selected: false }, body, foot, ''));
    player = body.querySelector('video'); badge = body.querySelector('[data-video-resolution-badge]');
    Object.defineProperties(player, { readyState: { value: 1 }, videoWidth: { value: 4096 }, videoHeight: { value: 1716 } });
    fireEvent.loadedMetadata(player); fireEvent.error(oldPlayer);
    expect(badge.textContent).toBe('4K'); expect(badge.hidden).toBe(false); expect(badge.title).toContain('4096 × 1716');
    expect(body.textContent).toContain('Not selected — playback uses another');
    await act(async () => {});
});

it('missing video files and audio version drawers never get a guessed badge', () => {
    installLegacy({ project: { id: 'p' } });
    render(<ProductionGraphPage />);
    const body = document.getElementById('pgDrawerBody'), foot = document.getElementById('pgDrawerFoot');
    act(() => pgDrawerVersion({ type: 'video', version: 1, width: 4096, height: 2160 }, body, foot, ''));
    expect(body.querySelector('[data-video-resolution-badge]').hidden).toBe(true);
    expect(body.querySelector('[data-video-resolution-detail]').textContent).toBe('Unavailable');
    act(() => pgDrawerVersion({ type: 'audio', version: 1, url: '/a.wav' }, body, foot, ''));
    expect(body.querySelector('[data-video-resolution-badge]')).toBeNull();
});
