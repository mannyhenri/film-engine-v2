// Structural walking adapted from the approved walkthrough's support/slide rules.
// Bounds stay per floor tile and stair tread so stairwells remain open.
export function nearestSupport(nav, x, z, ceiling, minimum = -100) {
    let best = null;
    for (const b of nav.supports) {
        if (x >= b.min[0] - .005 && x <= b.max[0] + .005
            && z >= b.min[2] - .005 && z <= b.max[2] + .005
            && b.max[1] <= ceiling + .001 && b.max[1] >= minimum) {
            best = Math.max(best ?? -Infinity, b.max[1]);
        }
    }
    return best;
}
export function blocked(nav, x, z, foot) {
    const radius = .22;
    return nav.blockers.some(b => b.max[1] >= foot + .28 && b.min[1] <= foot + 1.65
        && x + radius > b.min[0] && x - radius < b.max[0]
        && z + radius > b.min[2] && z - radius < b.max[2]);
}
export function walkStep(nav, position, dx, dz, foot) {
    const next = position.slice();
    // Bound large key/wheel steps to avoid tunnelling through narrow walls.
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .1));
    for (let n = 0; n < steps; n++) {
        for (const [axis, delta] of [[0, dx / steps], [2, dz / steps]]) {
            const candidate = next.slice(); candidate[axis] += delta;
            const support = nearestSupport(nav, candidate[0], candidate[2], foot + .225, foot - .32);
            if (support == null || blocked(nav, candidate[0], candidate[2], support)) continue;
            next[axis] = candidate[axis]; foot = support;
        }
    }
    return { position: next, foot };
}
