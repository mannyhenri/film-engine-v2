"""
Astra's build, run in background Blender (lib/astra-build.js launches it, sandboxed).

  blender -b --factory-startup --disable-autoexec --python blender-astra.py -- <job.json>

job.json: { script, out_dir, kind: 'prop'|'location', views: [...], width, height, engine? }

1. An empty scene. The build script Astra wrote is checked (astra_check.py) and refused whole on any
   problem; then it runs with a reduced set of builtins and an import hook that only finds bpy, bmesh,
   mathutils, math and random. The OS sandbox around this process is the outer wall: no network, and
   writes only in the job folder and the user's temp.
2. Whatever cameras the script made are removed (the runner frames its own); if it lit nothing, a
   neutral key / fill / world light is added so the review renders show its shapes and materials.
3. Review renders, one PNG per view: front, three-quarter left and right, top, and for a location an
   eye-level view from inside. Eevee; engine 'CYCLES' is the fallback the backend asks for when Eevee's
   Metal backend aborts in background mode.
4. A GLB (+Y up, modifiers applied, no cameras: the Previs stage's convention, as blender-set.py) and the
   .blend, then result.json with the stats: objects, triangles, bounds in metres, materials, lights.

A script that raises still gets a result.json, with the traceback against its own line numbers, so the
next round can be told exactly what broke.
"""
import bpy
import json
import math
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import astra_check  # noqa: E402

JOB = json.load(open(sys.argv[sys.argv.index('--') + 1]))
OUT = JOB['out_dir']
result = {'ok': False, 'renders': [], 'stats': {}, 'error': None}


def done():
    with open(os.path.join(OUT, 'result.json'), 'w') as f:
        json.dump(result, f, indent=1)
    print('ASTRA-DONE')
    sys.stdout.flush()


SAFE_BUILTINS = {k: __builtins__[k] if isinstance(__builtins__, dict) else getattr(__builtins__, k) for k in (
    'abs', 'all', 'any', 'bool', 'dict', 'divmod', 'enumerate', 'filter', 'float', 'frozenset', 'int', 'isinstance',
    'len', 'list', 'map', 'max', 'min', 'pow', 'print', 'range', 'reversed', 'round', 'set', 'slice', 'sorted',
    'str', 'sum', 'tuple', 'zip', 'hasattr', 'iter', 'next', 'Exception', 'ValueError', 'TypeError', 'KeyError',
    'IndexError', 'RuntimeError', 'ZeroDivisionError', 'AttributeError', 'StopIteration', 'True', 'False', 'None')
    if (k in __builtins__ if isinstance(__builtins__, dict) else hasattr(__builtins__, k))}
_real_import = __import__


def _guarded_import(name, globals=None, locals=None, fromlist=(), level=0):
    if level or name.split('.')[0] not in astra_check.ALLOWED_IMPORTS:
        raise ImportError(f'import {name} is not allowed in a build script')
    return _real_import(name, globals, locals, fromlist, level)


SAFE_BUILTINS['__import__'] = _guarded_import


def run_script():
    src = open(JOB['script'], encoding='utf-8').read()
    problems = astra_check.check(src)
    if problems:
        result['error'] = 'The build script was refused before running:\n' + '\n'.join(problems)
        result['refused'] = problems
        return False
    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        exec(compile(src, 'build.py', 'exec'), {'__name__': '__astra__', '__builtins__': SAFE_BUILTINS})
    except Exception:
        tb = traceback.format_exc()
        # Only the frames in the build script: the runner's own are noise to the model reading it.
        lines = [l for l in tb.splitlines() if 'blender-astra.py' not in l]
        result['error'] = 'The build script raised an error:\n' + '\n'.join(lines[-14:])
        return False
    return True


def mesh_objects():
    return [o for o in bpy.context.scene.objects if o.type in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT')]


def stats():
    dg = bpy.context.evaluated_depsgraph_get()
    tris, lo, hi = 0, [1e9] * 3, [-1e9] * 3
    mats = set()
    for o in mesh_objects():
        ev = o.evaluated_get(dg)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        for v in me.vertices:
            w = ev.matrix_world @ v.co
            for i in range(3):
                lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
        for m in me.materials:
            if m:
                mats.add(m.name)
        ev.to_mesh_clear()
    if tris == 0:
        lo, hi = [0, 0, 0], [0, 0, 0]
    return {'objects': len(mesh_objects()), 'triangles': tris, 'materials': len(mats),
            'lights': len([o for o in bpy.context.scene.objects if o.type == 'LIGHT']),
            'bounds_min_m': [round(x, 3) for x in lo], 'bounds_max_m': [round(x, 3) for x in hi],
            'size_m': [round(hi[i] - lo[i], 3) for i in range(3)]}


def light_if_dark():
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new('World')
    sc.world.use_nodes = True
    bg = next((n for n in sc.world.node_tree.nodes if n.type == 'BACKGROUND'), None)
    if bg and not any(o.type == 'LIGHT' for o in sc.objects):
        # A soft studio sky, light above and darker below, so metal and glass have something to reflect.
        nt = sc.world.node_tree
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mapn = nt.nodes.new('ShaderNodeMapping')
        mapn.inputs['Rotation'].default_value = (0, math.radians(-90), 0)
        grad = nt.nodes.new('ShaderNodeTexGradient')
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (0.05, 0.05, 0.055, 1)
        ramp.color_ramp.elements[1].color = (0.9, 0.9, 0.92, 1)
        nt.links.new(coord.outputs['Generated'], mapn.inputs['Vector'])
        nt.links.new(mapn.outputs['Vector'], grad.inputs['Vector'])
        nt.links.new(grad.outputs['Fac'], ramp.inputs['Fac'])
        nt.links.new(ramp.outputs['Color'], bg.inputs[0])
        bg.inputs[1].default_value = 0.9
    elif bg:
        bg.inputs[1].default_value = max(0.15, bg.inputs[1].default_value)
    if any(o.type == 'LIGHT' for o in sc.objects):
        return False
    for name, rot, energy in (('Review key', (math.radians(50), 0, math.radians(35)), 3.5),
                              ('Review fill', (math.radians(65), 0, math.radians(-140)), 1.2)):
        sun = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        sun.data.energy = energy
        sun.rotation_euler = rot
        sun['astra_review_light'] = True
        sc.collection.objects.link(sun)
    return True


def review_floor(st):
    """A prop is reviewed standing on a mid-grey floor, so its contact and scale read. Never exported."""
    if JOB.get('kind') != 'prop':
        return
    size = max(st['size_m']) * 12 or 1
    me = bpy.data.meshes.new('Review floor')
    z = st['bounds_min_m'][2] - 0.0005
    me.from_pydata([(-size, -size, z), (size, -size, z), (size, size, z), (-size, size, z)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new('Review floor', me)
    m = bpy.data.materials.new('Review floor'); m.use_nodes = True
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (0.32, 0.32, 0.33, 1)
    me.materials.append(m)
    ob['astra_review_light'] = True
    bpy.context.scene.collection.objects.link(ob)


def look_at(cam, target):
    from mathutils import Vector
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def views(st):
    from mathutils import Vector
    lo, hi = Vector(st['bounds_min_m']), Vector(st['bounds_max_m'])
    c = (lo + hi) / 2
    size = max(0.05, (hi - lo).length)
    kind = JOB.get('kind', 'prop')
    dist = size * (1.35 if kind == 'prop' else 1.0)
    h = c.z + size * 0.35
    out = {
        'front': (Vector((c.x, c.y - dist, h)), c),
        'three_quarter_left': (Vector((c.x - dist * 0.72, c.y - dist * 0.72, h)), c),
        'three_quarter_right': (Vector((c.x + dist * 0.72, c.y - dist * 0.72, h)), c),
        'top': (Vector((c.x, c.y - 0.001, c.z + dist * 1.1)), c),
    }
    if kind == 'location':
        eye = Vector((c.x, lo.y + (hi.y - lo.y) * 0.15, min(hi.z - 0.1, lo.z + 1.6)))
        out['interior_eye_level'] = (eye, Vector((c.x, hi.y, eye.z - 0.1)))
    return {k: v for k, v in out.items() if k in JOB.get('views', list(out))}


def render_views(st):
    sc = bpy.context.scene
    for o in [o for o in sc.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o, do_unlink=True)
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    if JOB.get('engine') == 'CYCLES':
        sc.render.engine = 'CYCLES'
        sc.cycles.device = 'CPU'
        sc.cycles.samples = 24
    else:
        sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
        # Glass and chrome only read as glass and chrome with ray-traced refraction and reflections on.
        for attr, val in (('use_raytracing', True), ('use_shadows', True), ('taa_render_samples', 32)):
            if hasattr(sc.eevee, attr):
                setattr(sc.eevee, attr, val)
    sc.render.resolution_x = int(JOB.get('width', 960))
    sc.render.resolution_y = int(JOB.get('height', 540))
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = 'PNG'
    try:
        sc.view_settings.view_transform = 'AgX'
    except TypeError:
        pass
    cam = bpy.data.objects.new('Review camera', bpy.data.cameras.new('Review camera'))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.clip_start = 0.01
    cam.data.clip_end = 5000
    for name, (pos, target) in views(st).items():
        cam.location = pos
        cam.data.lens = 24 if name == 'interior_eye_level' else 35
        look_at(cam, target)
        path = os.path.join(OUT, f'{name}.png')
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        result['renders'].append({'view': name, 'path': path})
    bpy.data.objects.remove(cam, do_unlink=True)


def export():
    for o in bpy.context.scene.objects:
        o.select_set(o.type in ('MESH', 'CURVE', 'SURFACE', 'META', 'FONT', 'LIGHT', 'EMPTY')
                     and not o.get('astra_review_light'))
    glb = os.path.join(OUT, 'model.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=True,
                              export_draco_mesh_compression_enable=False)
    result['glb'] = glb
    blend = os.path.join(OUT, 'model.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    result['blend'] = blend


try:
    if run_script():
        st = stats()
        result['stats'] = st
        if st['triangles'] == 0:
            result['error'] = 'The build script ran but made no geometry (0 triangles).'
        else:
            result['lit_by_runner'] = light_if_dark()
            review_floor(st)
            render_views(st)
            export()
            result['ok'] = True
except Exception:
    result['error'] = 'The runner failed after the script ran:\n' + traceback.format_exc()[-1500:]
done()
