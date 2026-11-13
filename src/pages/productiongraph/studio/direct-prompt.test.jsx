/*
 * The Direct studio's working prompt (direct-model.js seedShot + compile): the audit's three fixes and the
 * fattening. Direction is ADDED on top of the screenplay, not used instead of it; a character the card bills
 * is named and tagged even when silent; the shot's props, how the environment moves, and the project look all
 * reach the prompt (none of them was carried before, and no still carries environment motion).
 */
import { describe, it, expect } from 'vitest';
import { seedShot, compile, compileText } from './direct-model.js';

const canon = (n) => String(n || '').toUpperCase();
const cap = (k) => String(k || '').trim().split(/\s+/)[0].replace(/^./, c => c.toUpperCase()).replace(/(?<=.)./g, c => c.toLowerCase());
const render = (shot, ctx = {}) => compileText(compile({
    codes: ['1A'], shots: { '1A': shot }, one: true, bracket: false,
    nameOf: (k) => cap(k), refOf: () => '', ageOf: () => '', ...ctx,
}));

describe('direction no longer replaces the description', () => {
    it('carries both the screenplay action and the added direction', () => {
        const s = seedShot({ description: 'A folded page lies on the counter.', direction: 'Ray stops.', duration_s: 4, camera: {} }, 4, canon);
        expect(s.start).toContain('A folded page lies on the counter.');
        expect(s.start).toContain('Ray stops.');
    });

    it('keeps the description even when it runs past the old 260-char first-sentence cap', () => {
        const long = 'A'.repeat(300) + '. The folded page is the subject of the shot.';
        const s = seedShot({ description: long, duration_s: 4, camera: {} }, 4, canon);
        expect(s.start).toContain('The folded page is the subject of the shot.');
    });
});

describe('a silent character on the card is still named and tagged', () => {
    it('names and references someone who has no lines', () => {
        const card = { description: 'Ray reads; June watches.', characters: ['RAY MERCER', 'JUNE'],
            dialogue: [{ character: 'RAY MERCER', line: 'Hm.' }], duration_s: 4, camera: {} };
        const s = seedShot(card, 4, canon);
        expect(s.cast).toContain('JUNE');
        const text = render(s, { refOf: (k) => (canon(k) === 'JUNE' ? '@image2' : '') });
        expect(text).toContain('June (@image2)');   // named and tagged though silent
    });
});

describe('props, environment motion and the project look reach the prompt', () => {
    it('names props (no plate is guaranteed to carry them)', () => {
        const s = seedShot({ description: 'The counter.', props: ['SALT SHAKER', { name: 'FOLDED PAGE' }], duration_s: 4, camera: {} }, 4, canon);
        expect(render(s)).toContain('In shot: SALT SHAKER, FOLDED PAGE.');
    });

    it('states how the environment moves (no still can carry motion)', () => {
        const s = seedShot({ description: 'The counter.', environment_motion: 'Steam drifts across the window.', duration_s: 4, camera: {} }, 4, canon);
        expect(render(s)).toContain('Throughout: Steam drifts across the window.');
    });

    it('carries the project look as a short trimmed line', () => {
        const s = seedShot({ description: 'The counter.', duration_s: 3, camera: {} }, 3, canon);
        expect(render(s, { look: 'Muted teal-and-amber palette, anamorphic bloom.' }))
            .toContain('Style: Muted teal-and-amber palette, anamorphic bloom.');
    });
});
