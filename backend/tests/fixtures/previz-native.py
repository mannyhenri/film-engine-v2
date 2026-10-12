"""Disposable CPU fixture. No provider, user scene, or interactive Blender session."""
import bpy, os, sys
from mathutils import Vector

root = sys.argv[sys.argv.index('--') + 1]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1
bpy.ops.mesh.primitive_plane_add(size=12)
floor = bpy.context.object
floor.name = 'GROUND floor fixture'
image = bpy.data.images.new('Relative texture fixture', width=2, height=2)
image.pixels = [0.2, 0.5, 0.2, 1] * 4
os.makedirs(os.path.join(root, 'textures'), exist_ok=True)
image.filepath_raw = os.path.join(root, 'textures', 'floor.png')
image.file_format = 'PNG'
image.save()
image.filepath = '//textures/floor.png'
material = bpy.data.materials.new('Relative texture material')
material.use_nodes = True
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = image
material.node_tree.links.new(texture.outputs['Color'], material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'])
floor.data.materials.append(material)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.5))
bpy.context.object.name = 'Fixture prop'
light = bpy.data.lights.new('Fixture sun', 'SUN')
light.energy = 3
sun = bpy.data.objects.new('Fixture sun', light)
scene.collection.objects.link(sun)
sun.rotation_euler = (0.4, 0.2, 0)
cam = bpy.data.objects.new('Fixture room viewpoint', bpy.data.cameras.new('Fixture room viewpoint'))
scene.collection.objects.link(cam)
cam.location = (0, -4, 2)
cam.rotation_euler = (Vector((0, 0, .5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(root, 'fixture.blend'))
