"""Trusted native snapshot renderer, invoked only by the allowlisted previz worker."""
import bpy, hashlib, json, math, os, struct
from mathutils import Vector, Quaternion, Matrix


def render_snapshot(job):
    if not bpy.app.background:
        raise ValueError('Native snapshot renders require a separate headless Blender process')
    s = job['native_snapshot']
    source = job['blend']
    with open(source, 'rb') as f:
        if hashlib.sha256(f.read()).hexdigest() != job['source_sha256']:
            raise ValueError('Native source hash changed')
    if any(a.get('kind') == 'library' for a in s['world']['linked_assets']):
        raise ValueError('Linked Blender libraries require a verified native reload')
    bpy.ops.wm.open_mainfile(filepath=source, load_ui=False)
    # Rebind recorded external textures before rendering the disposable copy.
    dependencies = {a['path']: a for a in s['world']['linked_assets'] if not a.get('packed')}
    for collection in (bpy.data.images, bpy.data.libraries):
        for item in collection:
            dep = dependencies.get(item.filepath)
            if dep:
                evidence = dep.get('evidence')
                if not evidence:
                    raise ValueError('Native dependency is missing: ' + item.filepath)
                with open(evidence['path'], 'rb') as f:
                    dependency_bytes = f.read()
                if hashlib.sha256(dependency_bytes).hexdigest() != evidence['sha256']:
                    raise ValueError('Native dependency changed: ' + item.filepath)
                pinned = os.path.join(job['out_dir'], 'dep_' + evidence['sha256'] + os.path.splitext(evidence['path'])[1])
                with open(pinned, 'wb') as f:
                    f.write(dependency_bytes)
                item.filepath = pinned
    sc = bpy.context.scene
    if abs(sc.unit_settings.scale_length - 1) > 1e-6:
        raise ValueError('The native scene is not in metres')
    for image in bpy.data.images:
        if image.source not in ('FILE', 'GENERATED', 'VIEWER'):
            raise ValueError('Native texture source requires a verified manifest: ' + image.source)
        if image.source == 'FILE' and image.filepath and not image.packed_file and not os.path.isfile(bpy.path.abspath(image.filepath)):
            raise ValueError('Missing native texture: ' + image.filepath)
    for library in bpy.data.libraries:
        if not os.path.isfile(bpy.path.abspath(library.filepath)):
            raise ValueError('Missing native library: ' + library.filepath)
    # Every scene and compositor output is confined to the disposable job directory.
    for scene in bpy.data.scenes:
        scene.render.filepath = os.path.join(job['out_dir'], 'unused')
        scene.render.use_compositing = False
        scene.render.use_sequencer = False
    c = s['camera']; p = c['position']; x, y, z, w = c['quaternion']; k = math.sqrt(.5)
    data = bpy.data.cameras.new('FE approved snapshot')
    cam = bpy.data.objects.new('FE approved snapshot', data)
    sc.collection.objects.link(cam)
    cam.location = (p[0], -p[2], p[1])
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = Quaternion(((w-x)*k, (w+x)*k, (y-z)*k, (y+z)*k)).normalized()
    data.type = 'PERSP'; data.sensor_fit = 'VERTICAL'
    data.lens = c['lens_mm']; data.sensor_width = c['sensor_width_mm']
    data.sensor_height = 2 * data.lens * math.tan(math.radians(c['verticalFovDegrees']) / 2)
    data.shift_x = data.shift_y = 0
    data.clip_start = c['near']; data.clip_end = c['far']; data.dof.use_dof = False
    sc.camera = cam
    frame = s['frame']; sc.render.resolution_x = frame['width']; sc.render.resolution_y = frame['height']
    sc.render.resolution_percentage = 100; sc.render.pixel_aspect_x = sc.render.pixel_aspect_y = 1
    sc.render.use_border = False; sc.render.use_crop_to_border = False; sc.render.use_multiview = False
    sc.view_layers[0].update()
    projection = cam.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(), x=frame['width'], y=frame['height'], scale_x=1, scale_y=1)
    expected = c['projectionMatrix']
    projection_error = max(abs(projection[r][col] - expected[col*4+r]) for r in range(4) for col in range(4))
    if projection_error > 1e-5:
        raise ValueError('Approved camera projection does not match native rendering: ' + str(projection_error))
    for i, subject in enumerate(s['subjects']):
        asset = subject.get('asset')
        if not asset:
            raise ValueError('A subject model is missing')
        with open(asset['path'], 'rb') as f:
            asset_bytes = f.read()
        if hashlib.sha256(asset_bytes).hexdigest() != asset['sha256']:
            raise ValueError('A subject asset changed')
        pinned_asset = os.path.join(job['out_dir'], 'subject_' + str(i) + '.glb')
        with open(pinned_asset, 'wb') as f:
            f.write(asset_bytes)
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=pinned_asset)
        objects = [o for o in bpy.data.objects if o not in before]
        meshes = [o for o in objects if o.type == 'MESH']
        if not meshes:
            raise ValueError('A staged asset contains no mesh')
        if any(o.type in ('LIGHT', 'CAMERA') for o in objects):
            raise ValueError('A subject asset includes unsupported embedded lights or cameras')
        coords = [o.matrix_world @ Vector(corner) for o in meshes for corner in o.bound_box]
        lo = Vector(tuple(min(v[a] for v in coords) for a in range(3)))
        hi = Vector(tuple(max(v[a] for v in coords) for a in range(3)))
        dims = hi-lo; want = subject['sizeM']; scale = (want[0]/max(dims.x,1e-6), want[2]/max(dims.y,1e-6), want[1]/max(dims.z,1e-6))
        if subject.get('fitToModel'):
            scale = (want[1]/max(dims.z,1e-6),)*3
        holder = bpy.data.objects.new('FE subject '+str(i), None); sc.collection.objects.link(holder)
        centre = Vector(((lo.x+hi.x)/2, (lo.y+hi.y)/2, lo.z))
        # Preserve the imported hierarchy, armature and authored materials.
        for obj in objects:
            if obj.parent not in objects:
                obj.matrix_world = Matrix.Diagonal((*scale,1)) @ Matrix.Translation(-centre) @ obj.matrix_world
                obj.parent = holder
        p = subject['position']; holder.location = (p[0],-p[2],p[1])
        if any(abs(v)>1e-6 for j,v in enumerate(subject['rotationDeg']) if j != 1):
            raise ValueError('Subject tilt/roll has no supported native mapping')
        holder.rotation_euler = (0,0,math.radians(subject['rotationDeg'][1]))
    lights = s['lights']
    if lights.get('mode') == 'rig':
        for obj in list(sc.objects):
            if lights.get('rig') and obj.type == 'LIGHT':
                bpy.data.objects.remove(obj, do_unlink=True)
        for i, light in enumerate(lights.get('rig', [])):
            data = bpy.data.lights.new('FE rig '+str(i), 'SUN')
            data.energy = 1.7 * light.get('ratio', 1)
            colour = light.get('colour', '#ffffff').lstrip('#')
            data.color = tuple(int(colour[j:j+2],16)/255 for j in (0,2,4))
            data.angle = .01 + .2 * light.get('soft',0)
            obj = bpy.data.objects.new(data.name, data); sc.collection.objects.link(obj)
            p=light['position']; t=light['target']; obj.location=(p[0],-p[2],p[1])
            obj.rotation_euler=(Vector((t[0],-t[2],t[1]))-obj.location).to_track_quat('-Z','Y').to_euler()
        # The exact authored mood is retained, with a documented diffuse world approximation.
        if lights.get('mood'):
            sc.world = bpy.data.worlds.new('FE approved mood'); sc.world.use_nodes=True
            bg=sc.world.node_tree.nodes.get('Background'); bg.inputs['Strength'].default_value=.25+1.1*lights['mood'].get('ambient',0)
            colour = lights['mood']['colour'].lstrip('#')
            srgb = [int(colour[j:j+2],16)/255 for j in (0,2,4)]
            # r149 preview lights use raw authored RGB fractions (legacy ColorManagement).
            bg.inputs['Color'].default_value = tuple(srgb) + (1,)
    sc.render.engine='CYCLES'; sc.cycles.device='CPU'; sc.cycles.samples=32; sc.cycles.use_denoising=True
    sc.render.threads_mode='FIXED'; sc.render.threads=2
    sc.render.image_settings.file_format='PNG'; sc.render.image_settings.color_mode='RGBA'; sc.render.image_settings.color_depth='8'
    sc.render.film_transparent=False
    output=os.path.join(job['out_dir'],'snapshot.png'); sc.render.filepath=output
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(job['out_dir'],'working.blend'))
    bpy.ops.render.render(write_still=True)
    # Blender writes DPI-only eXIf metadata, which the shared PNG decoder sends
    # to an external orientation decoder. Remove only these resolution tags;
    # leave the generated pixel stream untouched and refuse orientation tags.
    with open(output, 'rb') as f:
        png = f.read()
    chunks = [png[:8]]
    offset = 8
    while offset + 12 <= len(png):
        length = struct.unpack('>I', png[offset:offset+4])[0]
        kind = png[offset+4:offset+8]
        chunk = png[offset:offset+length+12]
        if kind == b'eXIf':
            exif = png[offset+8:offset+8+length]
            endian = '>' if exif[:2] == b'MM' else '<'
            ifd = struct.unpack(endian+'I', exif[4:8])[0]
            count = struct.unpack(endian+'H', exif[ifd:ifd+2])[0]
            tags = [struct.unpack(endian+'H', exif[ifd+2+i*12:ifd+4+i*12])[0] for i in range(count)]
            if any(tag not in (0x011a, 0x011b, 0x0128) for tag in tags):
                raise ValueError('Unexpected native PNG orientation metadata')
        else:
            chunks.append(chunk)
        offset += length + 12
    with open(output, 'wb') as f:
        f.write(b''.join(chunks))
    # Match Node's canonical representation; the caller sends its own trusted digest.
    result={'mode':'previz','image':output,'renderer':'cycles-cpu','snapshot_hash':job['snapshot_hash'],
            'projection_max_abs_error':projection_error,'native_position':list(cam.location),
            'native_quaternion_wxyz':list(cam.rotation_quaternion),'lens_mm':c['lens_mm'],
            'source_sha256':job['source_sha256'],'samples':32}
    with open(os.path.join(job['out_dir'],'result_previz.json'),'w') as f:
        json.dump(result,f)
    print('SET-BUILD-DONE',flush=True)
