const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
    buildSFXPrompts, buildAmbientPrompt,
    LOCATION_TO_AMBIENT, TIME_AMBIENT_MODIFIER,
} = require('../lib/music-prompt');

describe('music-prompt', () => {
    describe('LOCATION_TO_AMBIENT', () => {
        it('has entries for common locations', () => {
            const locations = ['office', 'street', 'forest', 'beach', 'restaurant', 'hospital'];
            for (const loc of locations) {
                assert.ok(LOCATION_TO_AMBIENT[loc], `Missing location: ${loc}`);
                assert.ok(typeof LOCATION_TO_AMBIENT[loc] === 'string');
            }
        });
    });

    describe('buildSFXPrompts', () => {
        it('extracts SFX from scene card', () => {
            const card = {
                sfx_cues: [
                    { description: 'Door slam', duration_s: 1.5, category: 'foley' },
                    { sound: 'Gunshot', duration_s: 0.5 },
                ],
            };
            const result = buildSFXPrompts(card, {});
            assert.equal(result.length, 2);
            assert.equal(result[0].type, 'sfx');
            assert.equal(result[0].prompt, 'Door slam');
            assert.equal(result[0].duration_s, 1.5);
            assert.equal(result[1].prompt, 'Gunshot');
        });

        it('returns empty when no sfx_cues', () => {
            assert.deepEqual(buildSFXPrompts({}, {}), []);
            assert.deepEqual(buildSFXPrompts({ sfx_cues: [] }, {}), []);
        });
    });

    describe('buildAmbientPrompt', () => {
        it('matches known location', () => {
            const scene = { location: 'Downtown Office', int_ext: 'INT', time_of_day: 'day' };
            const payload = buildAmbientPrompt(scene, null);
            assert.equal(payload.type, 'ambient');
            assert.ok(payload.prompt.includes('office'));
            assert.equal(payload.loopable, true);
        });

        it('uses location description when no match', () => {
            const scene = { location: 'Alien spaceship' };
            const location = { description: 'vast metallic corridor with humming engines' };
            const payload = buildAmbientPrompt(scene, location);
            assert.ok(payload.prompt.includes('vast metallic corridor'));
        });

        it('adds outdoor modifier for EXT scenes', () => {
            const scene = { location: 'Park', int_ext: 'EXT', time_of_day: 'day' };
            const payload = buildAmbientPrompt(scene, null);
            assert.ok(payload.prompt.includes('outdoor'));
        });

        it('adds time of day modifier', () => {
            const scene = { location: 'Street', time_of_day: 'night' };
            const payload = buildAmbientPrompt(scene, null);
            assert.ok(payload.prompt.includes('nighttime'));
        });

        it('defaults to quiet room for missing location', () => {
            const payload = buildAmbientPrompt({}, null);
            assert.ok(payload.prompt.includes('quiet room'));
        });

        it('asks for a loopable bed, not a full-length render', () => {
            // Ambient is tiled to length at mix time, so duration_s is the LOOP
            // length. bed_duration_s is what the loop has to cover.
            const payload = buildAmbientPrompt({ location: 'Street', estimated_duration: 180000 }, null);
            assert.equal(payload.loopable, true);
            assert.equal(payload.bed_duration_s, 180);
            assert.ok(payload.duration_s <= 30, `loop length ${payload.duration_s}s exceeds the 30s ceiling`);
        });

        it('keeps the loop length inside provider limits for any scene length', () => {
            // Set-based: sweep scene durations rather than spot-checking one.
            for (const ms of [0, 1000, 5000, 12000, 30000, 60000, 600000, 3600000]) {
                const payload = buildAmbientPrompt({ location: 'Street', estimated_duration: ms }, null);
                assert.ok(payload.duration_s >= 0.5 && payload.duration_s <= 30,
                    `scene ${ms}ms produced an out-of-range loop of ${payload.duration_s}s`);
                assert.ok(payload.bed_duration_s > 0, `scene ${ms}ms produced no bed length`);
                assert.ok(payload.bed_duration_s >= payload.duration_s,
                    `scene ${ms}ms: bed ${payload.bed_duration_s}s shorter than its own loop`);
            }
        });
    });
});
