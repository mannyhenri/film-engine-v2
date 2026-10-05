# Reference packages and composition drift (GRD-4666)

**A reference package** is the approved picture of a shot, frozen. It is rendered from one scene,
camera and frame by the previz worker (Cycles CPU for passes):

| Pass | File | Units and convention | Invalid values |
|---|---|---|---|
| beauty | PNG, 8-bit sRGB | the frame as rendered | none |
| depth | EXR, 32-bit float | metres along the camera view axis (Blender Z) | background and anything past clip end read 1e10 or more |
| normal | EXR, 32-bit float | world-space unit vectors, Blender axes (x east, y north, z up) | background is (0, 0, 0) |
| object_mask | EXR, 32-bit float of whole numbers | 0 is the set; subjects are 1, 2, 3 in staging order (`subject_index` gives each name) | none |

Each package also records:

- each pass file's sha256;
- the world and blocking versions it was rendered from;
- the full camera (lens, sensor, fit, aspect, size, frame);
- the composition intent, with landmarks, subject bounds, the horizon and eyelines projected into
  the frame.

The database refuses updates to a package. A person approves it, and a shot pins one approved
package. Board jobs then read the package's camera, never the stage's latest camera. Changing the
camera, aspect or world marks the package and its boards stale. Earlier packages and boards are
kept.

**Negotiation.** A provider declares the reference controls it takes (`referenceControls`). Without
that declaration it gets only `reference_image`, when it supports reference images. Every other
control is named as omitted, with a warning that camera and geometry may drift. Generating in that
weakened mode needs a person's approval for that exact negotiation, and the pre-spend envelope
warns `reference_controls_omitted`. No adapter declares depth, normal, mask or camera-pose control
today, so every provider is in a weakened mode until one does. An exact-geometry shot can instead
take the package's own beauty render as its board (`rendered-board`), with no generation.

**Drift review** (the Reference compare panel). The board is shown over the package with an opacity
slider, and landmarks, subject bounds, the horizon and eyelines are drawn on top:

- Framing is measured from the board image.
- Everything else is compared at the marks a person places.
- An unmarked check is "unverified" and sends the board to a person. Nothing is guessed from pixels.

A person disposes of the board (accept, accept with named deviations, redo or reject). Only an
accepted board can be pinned for video. The pin records the start frame, the end frame, the camera
trajectory, what the video adapters can take, and the approved deviations. The deviations are
carried into the separate motion review.

**Copying a shot** makes a new shot with its own editable card and previs setup, recording which
shot it came from. Approvals, pinned packages and the locked workflow stay with the original.
