'use strict';
/*
 * A REFERENCE IS NOT A KEYFRAME.
 *
 * `first-last-frame` is the one Seedance workflow where the POSITION of a
 * picture is its meaning: images_list[1] is the frame the clip ends on. The
 * workflow used to be chosen by counting every picture attached, keyframes and
 * reference plates together, so an ordinary shot -- one storyboard keyframe
 * plus the location plate -- selected it and the plate became the ending frame.
 *
 * Caught by a human reading a preview on Northline 1B, at $4.25 a clip. These
 * tests are the reason it does not need catching again.
 */
const test = require('node:test');
const assert = require('node:assert');
const { buildVideoRequest } = require('../lib/providers/seedance');

const base = { motion_prompt: 'the man walks toward the light', target_resolution: '1920x1080' };

test('one keyframe plus reference plates requires choosing a workflow that carries both', () => {
    assert.throws(() => buildVideoRequest({ ...base, init_image: 'data:kf', reference_images: ['data:plate'] }), /image|reference/i);
});

test('many references never displace a single keyframe', () => {
    assert.throws(() => buildVideoRequest({ ...base, init_image: 'kf', reference_images: ['r1', 'r2', 'r3'] }), /image|reference/i);
});

test('two real keyframes still select first-last-frame, in order', () => {
    const r = buildVideoRequest({ ...base, init_image: 'first', last_frame: 'last' });
    assert.equal(r.workflow, 'first-last-frame');
    assert.deepEqual(r.body.images_list, ['first', 'last']);
});

test('references with no keyframe are references', () => {
    const r = buildVideoRequest({ ...base, reference_images: ['r1', 'r2'] });
    assert.equal(r.workflow, 'omni-reference');
    assert.deepEqual(r.body.images_list, ['r1', 'r2']);
});

test('omni-reference remains available by explicit ask', () => {
    const r = buildVideoRequest({ ...base, workflow: 'omni-reference', init_image: 'kf', reference_images: ['r1'] });
    assert.equal(r.workflow, 'omni-reference');
    assert.deepEqual(r.body.images_list, ['kf', 'r1'], 'the director opted in; both travel');
});

test('nothing attached is text-to-video', () => {
    assert.equal(buildVideoRequest({ ...base }).workflow, 'text-to-video');
});
