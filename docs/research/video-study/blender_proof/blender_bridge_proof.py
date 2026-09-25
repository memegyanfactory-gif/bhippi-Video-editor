"""Proof of the Bhippi <-> Blender headless bridge.

blender -b --factory-startup -P blender_bridge_proof.py -- request.json

The request is the kind of JSON the Bhippi AI would write: objects from primitives, extruded text,
material presets, lights, and a camera whose keyframes carry CSS-style cubic-bezier eases (the
motion engine's own `Ease` form). Prints `{"progress", "message"}` JSON lines like every Bhippi
worker, renders PNG RGBA frames, and writes camera.json (per-frame camera for 2D compositing) plus
result.json.
"""
import json
import math
import os
import sys
import time

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
req = json.load(open(argv[0], encoding="utf-8"))
out = req["out"]
os.makedirs(out, exist_ok=True)


def say(progress, message):
    print(json.dumps({"progress": round(progress, 4), "message": message}), flush=True)


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # sRGB -> linear, Blender colour inputs are linear
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, a)


# ------------------------------------------------------------------ scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
fps = req.get("fps", 30)
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = max(1, round(req["duration"] * fps))
scene.render.resolution_x, scene.render.resolution_y = req["width"], req["height"]
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = req.get("view_transform", "AgX")


# ------------------------------------------------------------------ materials
def material(name, spec):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    preset = spec.get("preset", "plastic")
    col = hex_rgba(spec.get("color", "#8899ff"))
    bsdf.inputs["Base Color"].default_value = col
    if preset == "glass":
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.04)
        bsdf.inputs["IOR"].default_value = 1.45
        # iridescent rim like the aflow orbs
        bsdf.inputs["Thin Film Thickness"].default_value = spec.get("thinFilm", 380.0)
    elif preset == "metal":
        bsdf.inputs["Metallic"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.22)
    elif preset == "emission":
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = spec.get("strength", 6.0)
    else:  # glossy plastic
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.3)
        bsdf.inputs["Coat Weight"].default_value = spec.get("coat", 0.6)
    return m


# ------------------------------------------------------------------ easing -> F-curve handles
def keyframe(obj, path, keys, index_count):
    """keys: [{t, v, ease}] where ease is [x1,y1,x2,y2] for the segment that STARTS at the key
    (the motion engine's convention). A CSS cubic-bezier is a 2D bezier in (time, value) space,
    exactly what a Blender bezier F-curve segment is, so handles map 1:1."""
    for k in keys:
        frame = 1 + k["t"] * fps
        setattr(obj, path, k["v"]) if index_count == 1 else setattr(obj, path, Vector(k["v"]))
        obj.keyframe_insert(data_path=path, frame=frame)
    ad = obj.animation_data
    for fc in ad.action.fcurves if hasattr(ad.action, "fcurves") else _layered_fcurves(ad):
        if fc.data_path != path:
            continue
        pts = fc.keyframe_points
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ease = keys[i].get("ease") or [0.33, 0.0, 0.67, 1.0]  # a null ease means AE's Easy Ease
            x1, y1, x2, y2 = ease
            dt = b.co.x - a.co.x
            dv = b.co.y - a.co.y
            a.interpolation = "BEZIER"
            a.handle_right_type = "FREE"
            b.handle_left_type = "FREE"
            a.handle_right = (a.co.x + x1 * dt, a.co.y + y1 * dv)
            b.handle_left = (a.co.x + x2 * dt, a.co.y + y2 * dv)


def _layered_fcurves(ad):
    # Blender 4.4+ slotted/layered actions
    act = ad.action
    slot = ad.action_slot
    for layer in act.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot)
            if bag:
                yield from bag.fcurves


# ------------------------------------------------------------------ objects
built = {}
for o in req["objects"]:
    kind = o["kind"]
    if kind == "box":
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.active_object
        ob.scale = o.get("size", [1, 1, 1])
        bpy.ops.object.transform_apply(scale=True)
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = o.get("radius", 0.12)
        bev.segments = 8
        bpy.ops.object.shade_smooth()
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=o.get("radius", 0.5), segments=64, ring_count=32)
        ob = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=o.get("major", 0.6), minor_radius=o.get("minor", 0.18), major_segments=96, minor_segments=32)
        ob = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    elif kind == "text":
        cu = bpy.data.curves.new(o["id"], "FONT")
        cu.body = o["text"]
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.extrude = o.get("extrude", 0.08)
        cu.bevel_depth = o.get("bevel", 0.015)
        cu.bevel_resolution = 4
        cu.size = o.get("size", 0.6)
        ob = bpy.data.objects.new(o["id"], cu)
        scene.collection.objects.link(ob)
    elif kind == "floor":
        bpy.ops.mesh.primitive_plane_add(size=40)
        ob = bpy.context.active_object
        ob.is_shadow_catcher = True  # Cycles: only the shadow survives on transparent film
    else:
        raise ValueError(f"unknown kind {kind}")
    ob.name = o["id"]
    ob.location = o.get("position", [0, 0, 0])
    ob.rotation_euler = [math.radians(a) for a in o.get("rotation", [0, 0, 0])]
    if "material" in o:
        ob.data.materials.append(material(o["id"] + "-mat", o["material"]))
    if "rotationKeys" in o:
        keys = [{"t": k["t"], "v": [math.radians(a) for a in k["v"]], "ease": k.get("ease")} for k in o["rotationKeys"]]
        keyframe(ob, "rotation_euler", keys, 3)
    built[o["id"]] = ob

# ------------------------------------------------------------------ lights (studio preset)
for L in req.get("lights", []):
    ld = bpy.data.lights.new(L["id"], "AREA")
    ld.energy = L.get("power", 400)
    ld.size = L.get("size", 3)
    ld.color = hex_rgba(L.get("color", "#ffffff"))[:3]
    lo = bpy.data.objects.new(L["id"], ld)
    scene.collection.objects.link(lo)
    lo.location = L["position"]
    direction = Vector(L.get("target", [0, 0, 0])) - lo.location
    lo.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

world = bpy.data.worlds.new("world")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = hex_rgba(req.get("world", "#20223a"))
world.node_tree.nodes["Background"].inputs[1].default_value = req.get("worldStrength", 0.6)
scene.world = world

# ------------------------------------------------------------------ camera (two-node: position + target)
cam_spec = req["camera"]
cd = bpy.data.cameras.new("cam")
cd.lens = cam_spec.get("lens", 50)
cd.sensor_fit = "HORIZONTAL"
cd.sensor_width = cam_spec.get("sensor", 36)
if cam_spec.get("fstop"):
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = cam_spec["fstop"]
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("cam-target", None)
scene.collection.objects.link(target)
target.location = cam_spec.get("target", [0, 0, 0])
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
if cam_spec.get("fstop"):
    cd.dof.focus_object = target
keyframe(cam, "location", cam_spec["positionKeys"], 3)

# ------------------------------------------------------------------ engine
engine = req.get("engine", "eevee")
if engine == "cycles":
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == "OPTIX"
    scene.cycles.device = "GPU"
    scene.cycles.samples = req.get("samples", 64)
    scene.cycles.use_denoising = True
    scene.cycles.denoiser = "OPTIX"
    scene.cycles.use_adaptive_sampling = True
else:
    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    ee.taa_render_samples = req.get("samples", 32)
    if hasattr(ee, "use_raytracing"):
        ee.use_raytracing = True
scene.render.use_motion_blur = req.get("motionBlur", True)

# ------------------------------------------------------------------ camera export for the 2D compositor
# Motion-engine camera: pixels, +y down, +z away from the viewer, `zoom` = distance (px) at which one
# px of a layer equals one px of the frame = lens / sensorWidth * compWidth (AE's formula).
PX_PER_M = req.get("pxPerMetre", 1000)
frames_out = []
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    mw = cam.matrix_world
    loc = mw.to_translation()
    tgt = target.matrix_world.to_translation()
    # Blender: Z up, and the front camera looks along +Y ("into the screen"). Motion engine / AE: +y down,
    # +z away from the viewer, camera in front at negative z. So x -> x, z -> -y, y -> +z.
    to_px = lambda v: [v.x * PX_PER_M + req["width"] / 2, -v.z * PX_PER_M + req["height"] / 2, v.y * PX_PER_M]  # noqa: E731
    frames_out.append({
        "frame": f, "t": round((f - 1) / fps, 5),
        "position": [round(x, 3) for x in to_px(loc)],
        "pointOfInterest": [round(x, 3) for x in to_px(tgt)],
        "zoom": round(cd.lens / cd.sensor_width * req["width"], 3),
        "lens_mm": cd.lens,
    })
json.dump({"fps": fps, "width": req["width"], "height": req["height"], "pxPerMetre": PX_PER_M, "frames": frames_out},
          open(os.path.join(out, "camera.json"), "w"), indent=1)

# ------------------------------------------------------------------ render the requested frames
frames = req.get("frames") or list(range(scene.frame_start, scene.frame_end + 1))
timings = []
t_all = time.time()
for i, f in enumerate(frames):
    scene.frame_set(f)
    scene.render.filepath = os.path.join(out, f"{f:05d}.png")
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    timings.append(round(time.time() - t0, 3))
    say((i + 1) / len(frames), f"frame {f} in {timings[-1]} s")

json.dump({"ok": True, "engine": engine, "frames": frames, "seconds_per_frame": timings,
           "total_s": round(time.time() - t_all, 2), "dir": out, "camera": "camera.json"},
          open(os.path.join(out, "result.json"), "w"), indent=1)
say(1.0, "done")
