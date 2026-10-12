# Resolution badges

Film Engine uses the same **long-edge pixel size tiers** for Storyboard pictures
and Production video version details: `2K` for at least 2048 pixels on the longer
edge; `4K` for at least 3840 pixels. The highest of these two qualifying tiers
is shown. Lower or unknown sizes have no badge. This product rule is independent
of orientation and supports 16:9, 2.39:1 and portrait assets. Thus 1920×1080 and
1080×1920 have no badge, 2048×858 has 2K, and 3840×2160, 4096×1716 and
2160×3840 have 4K. Larger assets still show the requested highest tier, 4K.

These labels are size classes, **not** DCI raster certification, UHD conformance,
creative quality, broadcast readiness or evidence of native detail. UHD and DCI
use different rasters; the tooltip explicitly identifies the product's long-edge
tier and always provides the measured width×height. Known image upscale origin
is disclosed. No origin is inferred from a filename, provider or size.

Storyboard reads exactly 33 bytes of the current PNG picture's header, including
its IHDR, from a regular file. Its original asset id/version travels with the
dimensions; thumbnail loads cannot change them. Unsupported headers and missing
files produce unknown dimensions without a full decode or process probe.
Version and project changes remount the image card, clearing pending load/error
and aspect state even on A→B→A transitions.
Board reads also carry an instance request sequence invalidated on page cleanup,
so an old page cannot overwrite shared viewer/annotation state after a project
switch remounts the pages and returns to the same film.

Production measures the already-opened video's intrinsic display dimensions
(`videoWidth`/`videoHeight`) after metadata is decoded, and updates on `resize`.
The browser applies its display/rotation interpretation; encoded storage columns
and requested generation sizes are never substituted. Details identify these as
display pixels. Pending, error, emptied, missing or zero-dimension media have no
badge; a bounded wait shows unavailable after eight seconds while still allowing
late valid metadata to populate it. Each callback captures its actual player and
detail elements and verifies they remain connected in the drawer, so events from
a superseded version cannot update a later version even when the asset id matches.
