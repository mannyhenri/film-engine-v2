# Editable Blender worlds and camera-blocked previz (GRD-4665)

**The editable world is the .blend.** A world version imported from a `.blend` (`POST
/film/worlds/:id/versions/import-blend`, MCP `world_import_blend`), or built by the set builder,
keeps its own copy of the `.blend` and records:

- the file's sha256;
- the files it links;
- units and axes;
- the Blender and add-on versions;
- a hash of every object transform.

`POST /film/world-versions/:id/reopen` reopens the saved file in Blender and reports any
difference. The import report lists missing assets, unsupported materials, scale changes and
substitutions. A version with only preview images (panorama, thumbnail) is never the editable world
and cannot be approved.

**Blender workers.** Blender runs only as one of three allowlisted workers (`inspect`, `set_build`,
`previz`). Each is a fixed script in `backend/`, launched with `-b --factory-startup
--disable-autoexec`, so Python stored in an imported `.blend` never runs. Blender still runs as the
server's user: there is no OS-level sandbox.

**Camera framing.** A shot's camera saves its sensor fit, aspect ratio, safe areas and target along
with its position, rotation, lens and sensor. It also saves a range (in and out points) and markers.

**Previz renders.** Renders are flat colour by default, textured when asked. Stills and motion both
use the shot range and the same saved world and camera versions, which each render records. A
subject with no model is drawn as a box, and the render says so. The same saved state always gives
the same render job.

**The locked workflow.** A shot pinned to a world can be locked (`POST
/film/shots/:id/previs/workflow`). A locked shot cannot generate a board, through the storyboard,
flows or the flow apply plan, until two things are true:

- a person has approved the exact world version (`POST /film/world-versions/:id/approve` with its
  fingerprint);
- the camera approval is current.

For a pinned shot, the camera approval and the keyframe and video fingerprints include the world
version and the aspect ratio. So changing the camera, the world or the aspect ratio makes them stale.
`GET /film/shots/:id/previs` returns `board_gate` with the reasons.
