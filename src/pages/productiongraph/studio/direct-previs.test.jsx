/*
 * Previz → Generate, keeping the director's edits (direct-model.js applyPrevis).
 *
 * Set-based over PREVIS_CAM_FIELDS, the camera fields Previz decides: for EVERY one, a field still as inherited
 * follows Previz, and a field changed in Generate stays (only what it is measured against moves). Then the move
 * and the staging reach the prompt, can be switched off, and a later Previz change is told apart.
 */
import { describe, it, expect } from 'vitest';
import { seedShot, applyPrevis, previsBehind, previsCam, PREVIS_CAM_FIELDS, compile, compileText, checks, blankMove } from './direct-model.js';

const CARD = { description: 'Maya at the bench.', camera: { shot_type: 'wide', lens: '24mm', angle: 'eye level' }, duration_s: 4 };
const PV = { applied: true, sig: 'a1', framing: 'close-up', angle: 'High', facing: 'Back', lens: 85,
    move: 'Over 4 seconds the camera dollies in 1.5 m and pans 30° left, easing out.', staging: ['MAYA stands frame left, in the middle distance, facing the camera.'] };
// A value for each field that is neither the card's nor Previz's: what the director picked in Generate.
const MINE = { framing: 'MCU', angle: 'Low', facing: 'Profile', lens: 50 };
const prompt = (s) => compileText(compile({ codes: ['1A'], shots: { '1A': s }, one: true, bracket: false, nameOf: (k) => k, refOf: () => '', ageOf: () => '' }));

describe('applyPrevis keeps edits made in Generate', () => {
    it('covers every field Previz decides (not blind)', () => {
        expect(PREVIS_CAM_FIELDS).toEqual(['framing', 'angle', 'facing', 'lens']);
        expect(Object.keys(previsCam(PV)).sort()).toEqual([...PREVIS_CAM_FIELDS].sort());
        for (const f of PREVIS_CAM_FIELDS) expect(MINE[f]).toBeDefined();
    });

    for (const f of PREVIS_CAM_FIELDS) {
        it(`${f}: untouched follows Previz; changed in Generate stays, and still reads as changed`, () => {
            const seeded = seedShot(CARD, 4);
            const followed = applyPrevis(seeded, PV);
            expect(followed.cam[f]).toBe(previsCam(PV)[f]);
            expect(followed.inh[f]).toBe(previsCam(PV)[f]);

            const edited = { ...seeded, cam: { ...seeded.cam, [f]: MINE[f] } };
            const kept = applyPrevis(edited, PV);
            expect(kept.cam[f]).toBe(MINE[f]);
            expect(kept.inh[f]).toBe(previsCam(PV)[f]);          // so "Changed here" still names it
            for (const g of PREVIS_CAM_FIELDS.filter(x => x !== f)) expect(kept.cam[g]).toBe(previsCam(PV)[g]);
        });
    }

    it('an unapplied Previz changes nothing', () => {
        const s = seedShot(CARD, 4);
        expect(applyPrevis(s, { ...PV, applied: false })).toBe(s);
    });
});

describe('the prompt carries the move and the staging', () => {
    it('in the shot\'s first beat, after the framing, and only while switched on', () => {
        const s = applyPrevis(seedShot(CARD, 4), PV);
        const text = prompt(s);
        expect(text).toContain(PV.move);
        expect(text).toContain(PV.staging[0]);
        expect(text.indexOf('Framing:')).toBeLessThan(text.indexOf(PV.staging[0]));
        const off = { ...s, pvz: { ...s.pvz, on: false } };
        expect(prompt(off)).not.toContain(PV.move);
        expect(prompt(off)).not.toContain(PV.staging[0]);
    });

    it('a later Previz change is told apart, and Update keeps the switch and the edits', () => {
        const s = applyPrevis({ ...seedShot(CARD, 4), cam: { ...seedShot(CARD, 4).cam, lens: 50 } }, PV);
        expect(previsBehind(s, PV)).toBe(false);
        const later = { ...PV, sig: 'b2', lens: 100, move: 'Over 4 seconds the camera trucks right 2 m.' };
        expect(previsBehind(s, later)).toBe(true);
        const off = { ...s, pvz: { ...s.pvz, on: false } };
        const updated = applyPrevis(off, later);
        expect(updated.cam.lens).toBe(50);
        expect(updated.pvz.move).toBe(later.move);
        expect(updated.pvz.on).toBe(false);
    });

    it('a "Static shot" added in Generate against a Previz move is flagged before paying', () => {
        const s = applyPrevis(seedShot(CARD, 4), PV);
        s.moves = [blankMove('static', 0, 4)];
        const out = checks({ units: [{ ids: ['1A'], dur: 4, label: '1A' }], one: true, shots: { '1A': s } });
        expect(out.some(c => c.k === 'warn' && /Previz moves the camera/.test(c.text))).toBe(true);
    });
});
