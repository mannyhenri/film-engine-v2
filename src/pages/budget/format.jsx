/*
 * The Budget page's small formatters, shared by its tabs. `money` and `usd` are core's (other pages print
 * money too, so there is one rule for it) and are reached through `legacy`; these are the page's own.
 */
export const CAP_COLOR = {
    image: '#2196f3', video: '#9c27b0', voice: '#ff9800', music: '#4caf50',
    sfx: '#00bcd4', ambient: '#009688', llm: '#e91e63', model3d: '#795548',
    lipsync: '#3f51b5', post: '#607d8b',
};
export const capColor = (c) => CAP_COLOR[c] || '#9e9e9e';

/** 1234567 → "1.23M", 1234 → "1.2k": a credit balance read at a glance. */
export function qty(n) {
    const v = Number(n) || 0;
    if (v >= 1000000) return (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
}

export const plural = (n, word) => n === 1 ? word : word + 's';
/** A green, amber or red bar: under 70%, under 90%, past it. */
export const barColor = (pct) => (pct > 90 ? 'var(--gl-error)' : pct > 70 ? 'var(--gl-warning)' : 'var(--gl-success)');

export function Bar({ pct, height = 8 }) {
    return (
        <div style={{ background: 'var(--gl-border-subtle)', borderRadius: 4, height, overflow: 'hidden' }}>
            <div style={{ background: barColor(pct), height: '100%', width: `${Math.min(100, pct)}%`, borderRadius: 4, transition: 'width .3s' }}></div>
        </div>
    );
}
