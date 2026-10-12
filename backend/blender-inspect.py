"""
Open a .blend and report what it is, headless (the 'inspect' worker, GRD-4665).

    Blender -b --factory-startup --disable-autoexec --python backend/blender-inspect.py -- <job.json>

The job names the .blend and an out_dir. --disable-autoexec means no Python stored in the file runs.
The result reports the scene's units and axes, the Blender and add-on versions, every object's
transform, linked libraries and images (and whether each exists), materials using nodes the stage
cannot reproduce, and a GLB export of the scene geometry for the stage to stand in. It changes nothing in
the .blend.
"""
import bpy, json, math, os, sys, addon_utils

job = json.load(open(sys.argv[sys.argv.index('--') + 1]))
OUT = job['out_dir']
os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=job['blend'], load_ui=False)
sc = bpy.context.scene
us = sc.unit_settings

# Node types the glTF export (and so the stage) cannot carry.
UNSUPPORTED = {'ShaderNodeScript', 'ShaderNodeVolumePrincipled', 'ShaderNodeVolumeScatter', 'ShaderNodeVolumeAbsorption',
               'ShaderNodeHoldout', 'ShaderNodeBsdfHair', 'ShaderNodeBsdfHairPrincipled', 'ShaderNodeSubsurfaceScattering'}


def exists(path):
    try:
        return os.path.exists(bpy.path.abspath(path))
    except Exception:
        return False


addons = []
for mod in addon_utils.modules():
    enabled, _loaded = addon_utils.check(mod.__name__)
    if enabled:
        addons.append({'name': mod.__name__, 'version': '.'.join(str(x) for x in mod.bl_info.get('version', ()))})

result = {
    'units': {'system': us.system, 'scale_length': round(us.scale_length, 6), 'length_unit': us.length_unit},
    'axes': {'up': 'Z', 'forward': 'Y', 'handedness': 'right'},
    'renderer': {'name': 'blender', 'version': bpy.app.version_string},
    'addons': sorted(addons, key=lambda a: a['name']),
    'objects': [{'name': o.name, 'location': [round(v, 6) for v in o.location],
                 'rotation': [round(math.degrees(v), 4) for v in o.rotation_euler],
                 'scale': [round(v, 6) for v in o.scale]} for o in sc.objects],
    'libraries': [{'path': lib.filepath, 'resolved_path': bpy.path.abspath(lib.filepath), 'exists': exists(lib.filepath)} for lib in bpy.data.libraries],
    'images': [{'path': im.filepath or im.name, 'source': im.source, 'resolved_path': bpy.path.abspath(im.filepath), 'packed': bool(im.packed_file), 'exists': bool(im.packed_file) or exists(im.filepath)} for im in bpy.data.images if im.source in ('FILE', 'TILED', 'MOVIE', 'SEQUENCE')],
    'materials': [{'name': m.name, 'unsupported': sorted({n.bl_idname for n in m.node_tree.nodes if n.bl_idname in UNSUPPORTED})}
                  for m in bpy.data.materials if m.use_nodes and m.node_tree],
}
glb = os.path.join(OUT, 'inspect.glb')
bpy.ops.object.select_all(action='DESELECT')
for o in sc.objects:
    # The glTF exporter evaluates curves, surfaces and text to temporary meshes
    # and clears them afterwards. Selecting only MESH silently discarded real
    # scrollwork, rugs, signage and other authored detail from the preview.
    # Keep the source object types and the saved native file intact.
    o.select_set(o.type in ('MESH', 'CURVE', 'SURFACE', 'FONT', 'CAMERA', 'LIGHT'))
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_cameras=True, export_lights=True, export_extras=True, export_draco_mesh_compression_enable=False)
result['glb'] = glb
with open(os.path.join(OUT, 'result_inspect.json'), 'w') as f:
    json.dump(result, f)
print('SET-BUILD-DONE')
