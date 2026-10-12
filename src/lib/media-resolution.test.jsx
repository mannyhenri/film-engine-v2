import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { resolutionInfo, bindVideoResolution } from './media-resolution.js';
import ResolutionBadge from '../components/ResolutionBadge/ResolutionBadge.jsx';

afterEach(() => vi.useRealTimers());

describe('measured pixel tiers', () => {
    it.each([
        [1920, 1080, null], [1080, 1920, null], [2047, 1152, null],
        [2048, 1152, '2K'], [2048, 858, '2K'], [858, 2048, '2K'],
        [3839, 2160, '2K'], [3840, 2160, '4K'], [4096, 1716, '4K'],
        [2160, 3840, '4K'], [8192, 4320, '4K'],
    ])('%i × %i has tier %s', (width, height, label) => {
        expect(resolutionInfo({ width, height }).label).toBe(label);
    });
    it.each([null, {}, { width: 4096 }, { width: 4096, height: 0 },
        { width: NaN, height: 2160 }, { width: Infinity, height: 2160 },
        { width: '4096', height: 2160 }, { width: 4096.5, height: 2160 }])('leaves invalid dimensions unknown: %j', pixels => {
        expect(resolutionInfo(pixels)).toBeNull();
    });
    it('provides exact size and known upscale origin without claiming native detail', () => {
        render(<ResolutionBadge pixels={{ width: 4096, height: 1716 }} upscaled />);
        const badge = screen.getByText('4K');
        expect(badge.title).toContain('4096 × 1716 px · 4K long-edge tier · Upscaled');
        expect(badge.getAttribute('aria-label')).toBe(badge.title);
        expect(badge.title).toContain('native detail and delivery quality are not verified');
    });
});

function drawer(root, source = 'version.mp4') {
    root.innerHTML = `<span data-video-resolution-badge hidden></span><video data-resolution-video src="${source}"></video><span data-video-resolution-detail></span>`;
    const player = root.querySelector('video');
    let width = 0, height = 0, ready = 0;
    Object.defineProperties(player, {
        videoWidth: { get: () => width }, videoHeight: { get: () => height }, readyState: { get: () => ready },
    });
    const dispose = bindVideoResolution(root);
    return { player, badge: root.querySelector('[data-video-resolution-badge]'), detail: root.querySelector('[data-video-resolution-detail]'), dispose,
        metadata(w, h, event = 'loadedmetadata') { width = w; height = h; ready = 1; player.dispatchEvent(new Event(event)); } };
}

describe('decoder dimension lifecycle', () => {
    it('has no badge while pending; uses decoded display dimensions and responds to resize', () => {
        const root = document.body.appendChild(document.createElement('div'));
        const d = drawer(root);
        expect(d.badge.hidden).toBe(true); expect(d.detail.textContent).toBe('Loading…');
        d.metadata(2160, 3840); // a decoder's rotated portrait display
        expect(d.badge.textContent).toBe('4K'); expect(d.badge.hidden).toBe(false);
        expect(d.detail.textContent).toBe('2160 × 3840 px · display pixels');
        d.metadata(1920, 1080, 'resize');
        expect(d.badge.hidden).toBe(true); expect(d.detail.textContent).toContain('1920 × 1080');
        d.dispose(); root.remove();
    });
    it('ignores stale A → B → A metadata, errors and pending timeout callbacks', () => {
        vi.useFakeTimers();
        const root = document.body.appendChild(document.createElement('div'));
        const firstA = drawer(root, 'a.mp4');
        const b = drawer(root, 'b.mp4');
        const secondA = drawer(root, 'a.mp4');
        secondA.metadata(2048, 858);
        firstA.metadata(4096, 2160); b.metadata(4096, 2160);
        firstA.player.dispatchEvent(new Event('error'));
        vi.advanceTimersByTime(8000);
        expect(secondA.badge.textContent).toBe('2K'); expect(secondA.badge.hidden).toBe(false);
        expect(secondA.detail.textContent).toContain('2048 × 858');
        for (const d of [firstA, b, secondA]) d.dispose(); root.remove();
    });
    it('clears dimensions on empty/error/zero metadata and bounds the pending wait', () => {
        vi.useFakeTimers();
        const root = document.body.appendChild(document.createElement('div'));
        const d = drawer(root);
        vi.advanceTimersByTime(8000);
        expect(d.detail.textContent).toBe('Unavailable');
        d.metadata(4096, 1716); expect(d.badge.hidden).toBe(false);
        d.player.dispatchEvent(new Event('emptied')); expect(d.badge.hidden).toBe(true);
        d.metadata(0, 0); expect(d.detail.textContent).toBe('Unavailable');
        d.metadata(4096, 1716); d.player.dispatchEvent(new Event('error'));
        expect(d.badge.hidden).toBe(true); expect(d.detail.textContent).toBe('Unavailable');
        d.dispose(); root.remove();
    });
});
