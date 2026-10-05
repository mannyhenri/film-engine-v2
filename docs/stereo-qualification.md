# Qualifying the first stereo adapter, worker and playback profile (GRD-4667)

This is a feasibility gate, before any stereo implementation. Its output is a **build, reuse or
no-go decision** made by a person from measurements and from viewing on the target device.
**No fixed VRAM figure, speed, or universal comfort is promised.**

## Candidates

- **flat_sbs** (always enabled, the fallback). Both eyes get the same picture, packed and labelled
  per the profile. It has no depth, so it adds no disparity and no comfort risk. It is also what
  stays in use after a no-go.
- **StereoCrafter** (disabled). It is a depth, warp and inpainting candidate. It stays disabled
  until four things are true:
  1. Evidence is recorded. That means a pinned code commit, weights with sha256, a dependency lock
     hash, and licence terms checked separately for code, weights and dependencies (commercial use
     stated as allowed, not allowed or unclear, by a named person, with a source link). It also
     means the worker's hardware and software, and the allowed use.
  2. A benchmark on the hard-case reel ran on that worker.
  3. A person viewed the result on the first profile.
  4. A person decided build or reuse, and commercial use is confirmed for every component.

A no-go keeps the candidate disabled and must name its fallback, or name the next decision.

## The hard-case reel

The reel uses owned footage only, with its owner and rights confirmed. It must cover every case:
camera_movement, occlusion, cut, dissolve, glass, hair and mist. Each clip is hashed.

## Diagnostics, per clip

throughput_fps, peak_memory_mb, cost_per_minute, temporal_depth_stability (1 minus the mean relative
frame-to-frame depth change), occlusion_fill and edge_artifacts.

Each value is measured on the worker or recorded as "not measured", with the reason; nothing is
estimated. Reviewers add notes per clip.

## The first playback profile

The profile names:

- the device, the player and its version, and the test date;
- packing (full_sbs: each eye at source size, packed 2x wide; half_sbs: each eye squeezed to half
  width, packed at source size) and eye order;
- the codec, colour, audio and caption handling;
- the dissolve and cut policy (convergence_ramp, cut_to_flat or per_eye_dissolve);
- the crop policy: pad (letterbox or pillarbox, and the output says so) or refuse. **Never a silent
  crop.**

It also records the comfort and disparity criteria the review will use (maximum positive and
negative disparity as a percentage of width, maximum disparity change per second, and viewing
minutes). These are review criteria, not a comfort promise.

## Still to do (by people, on the worker)

1. Choose the stress footage and the device and player.
2. Install StereoCrafter on the intended worker and record its evidence.
3. Run the benchmark there.
4. View the result on the device.
5. Decide.
