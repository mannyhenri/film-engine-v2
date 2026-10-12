/** Film Engine pixel tiers, independent of generation settings and filenames.
 * These are long-edge size classes, not DCI/UHD conformance or native detail.
 */
export function resolutionInfo(pixels, { upscaled = false } = {}) {
    const width = pixels?.width, height = pixels?.height;
    if (![width, height].every(n => Number.isSafeInteger(n) && n > 0)) return null;
    const edge = Math.max(width, height);
    const label = edge >= 3840 ? '4K' : edge >= 2048 ? '2K' : null;
    const dimensions = `${width} × ${height} px`;
    const title = `${dimensions}${label ? ` · ${label} long-edge tier` : ''}${upscaled ? ' · Upscaled' : ''}. Pixel size only; native detail and delivery quality are not verified.`;
    return { width, height, label, dimensions, title };
}

/** Measure the video already in the drawer. Intrinsic display dimensions let
 * the decoder account for rotation/pixel aspect; CSS size is never measured.
 * Capture elements, not reusable ids: even A → B → A creates new elements.
 */
export function bindVideoResolution(root) {
    const player = root.querySelector('video[data-resolution-video]');
    const badge = root.querySelector('[data-video-resolution-badge]');
    const detail = root.querySelector('[data-video-resolution-detail]');
    if (!player || !badge || !detail) return () => {};
    const source = player.getAttribute('src');
    const current = () => root.isConnected && root.contains(player) && root.contains(badge)
        && root.contains(detail) && player.getAttribute('src') === source;
    let timeout;
    const clear = (text) => {
        if (!current()) return;
        badge.hidden = true;
        badge.textContent = '';
        badge.removeAttribute('title');
        badge.removeAttribute('aria-label');
        detail.textContent = text;
        detail.removeAttribute('title');
    };
    const unavailable = () => { clearTimeout(timeout); clear('Unavailable'); };
    const pending = () => {
        clearTimeout(timeout);
        clear('Loading…');
        timeout = setTimeout(unavailable, 8000);
    };
    const measure = () => {
        if (!current()) return;
        const info = player.readyState >= 1 && resolutionInfo({ width: player.videoWidth, height: player.videoHeight });
        if (!info) return unavailable();
        clearTimeout(timeout);
        badge.textContent = info.label || '';
        badge.hidden = !info.label;
        badge.title = info.title;
        badge.setAttribute('aria-label', info.title);
        detail.textContent = `${info.dimensions} · display pixels`;
        detail.title = info.title;
    };
    player.addEventListener('loadedmetadata', measure);
    player.addEventListener('resize', measure);
    player.addEventListener('emptied', pending);
    player.addEventListener('error', unavailable);
    if (player.readyState >= 1) measure(); else pending();
    return () => {
        clearTimeout(timeout);
        player.removeEventListener('loadedmetadata', measure);
        player.removeEventListener('resize', measure);
        player.removeEventListener('emptied', pending);
        player.removeEventListener('error', unavailable);
    };
}
