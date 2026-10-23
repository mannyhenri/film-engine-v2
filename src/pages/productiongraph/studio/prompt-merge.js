/*
 * Direction keeps reaching a prompt the director has edited by hand.
 *
 * The prompt is rebuilt from the controls; once the director edits the text, the rebuilt text and theirs diverge.
 * A sound added at the playhead, music switched on, a new line: each changes the rebuilt text in one place. This
 * applies that same change to the edited text (a three-way merge, word by word): BASE is the rebuilt text the edit
 * started from, MINE the edited text, THEIRS the new rebuilt text. Where only the controls changed, the change goes
 * in; where only the director changed, their words stay; where both changed the same words, the director's words
 * stay and it is counted as a conflict, so the page can say what did not go in.
 */

const tokens = text => String(text || '').split(/(\s+)/).filter(t => t !== '');

/** Index pairs of a longest common subsequence of two token lists. */
function lcs(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    for (let i = 0, j = 0; i < n && j < m;) {
        if (a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
    }
    return out;
}

const same = (x, y) => x.length === y.length && x.every((t, i) => t === y[i]);

/** { text, conflicts }: THEIRS's changes from BASE applied to MINE. */
export function mergePrompt(base, mine, theirs) {
    if (theirs === base) return { text: mine, conflicts: 0 };
    if (mine === base) return { text: theirs, conflicts: 0 };
    const o = tokens(base), a = tokens(mine), b = tokens(theirs);
    const ma = new Map(lcs(o, a)), mb = new Map(lcs(o, b));
    // Stable points: base tokens kept by both sides, in order on both.
    const stable = [];
    let la = -1, lb = -1;
    for (let i = 0; i < o.length; i++) {
        if (ma.has(i) && mb.has(i) && ma.get(i) > la && mb.get(i) > lb) { stable.push([i, ma.get(i), mb.get(i)]); la = ma.get(i); lb = mb.get(i); }
    }
    stable.push([o.length, a.length, b.length]);
    const out = [];
    let conflicts = 0, io = 0, ia = 0, ib = 0;
    for (const [so, sa, sb] of stable) {
        const co = o.slice(io, so), ca = a.slice(ia, sa), cb = b.slice(ib, sb);
        if (same(ca, co)) out.push(...cb);
        else if (same(cb, co) || same(ca, cb)) out.push(...ca);
        else { out.push(...ca); conflicts++; }
        if (so < o.length) out.push(o[so]);
        io = so + 1; ia = sa + 1; ib = sb + 1;
    }
    return { text: out.join(''), conflicts };
}
