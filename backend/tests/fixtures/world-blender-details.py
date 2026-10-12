"""Tiny disposable native fixture: real mesh, curve, text, surface and cameras."""
import bpy, hashlib, json, math, os, sys
from mathutils import Vector

root = sys.argv[sys.argv.index('--') + 1]
os.makedirs(root, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
scene.unit_settings.length_unit = 'METERS'
scene.render.resolution_x = 160
scene.render.resolution_y = 90

material = bpy.data.materials.new('Detail brass')
material.use_nodes = True
material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (.7, .3, .1, 1)
material.node_tree.nodes.get('Principled BSDF').inputs['Metallic'].default_value = .4

image = bpy.data.images.new('Detail texture', width=2, height=2)
image.pixels = [.2, .4, .7, 1, .8, .1, .3, 1] * 2
texture_path = os.path.join(root, 'detail.png')
image.filepath_raw = texture_path
image.file_format = 'PNG'
image.save()
image.filepath = '//detail.png'
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])

bpy.ops.mesh.primitive_cube_add(size=1, location=(-2, .5, .5))
bpy.context.object.name = 'Original mesh'
bpy.context.object.data.materials.append(material)

# Mirrors the mansion's extra omitted shim: explicitly disabled for viewport
# and native renders. Restoring authored details must not force this visible.
bpy.ops.mesh.primitive_cube_add(size=.1, location=(0, 0, 10))
bpy.context.object.name = 'Native hidden support shim'
bpy.context.object.hide_viewport = True
bpy.context.object.hide_render = True

parent = bpy.data.objects.new('Transformed detail parent', None)
scene.collection.objects.link(parent)
parent.location = (1, 2, .4)
parent.rotation_euler = (.2, -.1, .3)
curve = bpy.data.curves.new('Scrollwork source', 'CURVE')
curve.dimensions = '3D'
curve.resolution_u = 4
curve.bevel_depth = .07
curve.bevel_resolution = 2
curve.use_fill_caps = True
spline = curve.splines.new('BEZIER')
spline.bezier_points.add(2)
for p, co in zip(spline.bezier_points, [(0, 0, 0), (.4, .3, .8), (1, 0, 1.2)]):
    p.co = co
    p.handle_left_type = p.handle_right_type = 'AUTO'
scroll = bpy.data.objects.new('Curve scrollwork', curve)
scene.collection.objects.link(scroll)
scroll.parent = parent
scroll.scale = (1.2, .8, 1.1)
scroll.data.materials.append(material)

font = bpy.data.curves.new('Sign source', 'FONT')
font.body = 'Hi'
font.size = .8
font.extrude = .03
font.bevel_depth = .01
font.bevel_resolution = 1
sign = bpy.data.objects.new('Font facade sign', font)
scene.collection.objects.link(sign)
sign.location = (.3, -.7, 1)
sign.rotation_euler = (math.pi / 2, 0, .1)
sign.data.materials.append(material)

bpy.ops.surface.primitive_nurbs_surface_surface_add(location=(0, -2, .2))
surface = bpy.context.object
surface.name = 'Surface decorative panel'
surface.data.resolution_u = 3
surface.data.resolution_v = 3
surface.data.materials.append(material)

for name, kind, position in [('Perspective room', 'PERSP', (3, -5, 2)), ('Orthographic plan', 'ORTHO', (0, 0, 8))]:
    data = bpy.data.cameras.new(name)
    data.type = kind
    data.lens = 42
    data.sensor_width = 36
    data.ortho_scale = 8
    data.clip_start = .02
    data.clip_end = 250
    camera = bpy.data.objects.new(name, data)
    scene.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = (Vector((0, 0, 1)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    if kind == 'PERSP':
        scene.camera = camera

blend = os.path.join(root, 'details.blend')
bpy.ops.wm.save_as_mainfile(filepath=blend)

# Independent source measurements use Blender's evaluated data without changing
# object types or writing the source again. The glTF coordinate basis is metres,
# Y up: native (x, y, z) becomes (x, z, -y).
expected = {'objects': {}, 'source_types': {o.name: o.type for o in scene.objects}}
depsgraph = bpy.context.evaluated_depsgraph_get()
for obj in scene.objects:
    if obj.type not in ('MESH', 'CURVE', 'FONT', 'SURFACE') or obj.hide_viewport or obj.hide_render:
        continue
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh(preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.calc_loop_triangles()
    triangles = []
    for tri in mesh.loop_triangles:
        vertices = [obj.matrix_world @ mesh.vertices[i].co for i in tri.vertices]
        triangles.append([[v.x, v.z, -v.y] for v in vertices])
    expected['objects'][obj.name] = {'type': obj.type, 'triangles': triangles}
    evaluated.to_mesh_clear()
expected['texture_sha256'] = hashlib.sha256(open(texture_path, 'rb').read()).hexdigest()
with open(os.path.join(root, 'expected.json'), 'w') as out:
    json.dump(expected, out)

# Control export includes all scene objects. Unlike the worker under test it has
# no type-selection policy, so it also proves unchanged cameras and materials.
bpy.ops.export_scene.gltf(filepath=os.path.join(root, 'control.glb'), export_format='GLB', use_selection=False,
                          export_yup=True, export_apply=True, export_cameras=True, export_lights=True,
                          export_extras=True, export_draco_mesh_compression_enable=False)
print('DETAIL-FIXTURE-DONE')
