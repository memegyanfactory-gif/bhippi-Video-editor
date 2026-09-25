# SPDX-License-Identifier: GPL-2.0-or-later
# Helios <-> Blender bridge. This file uses Blender's Python API (bpy) and is licensed under the
# GPL; it runs inside the user's own, unmodified Blender as a separate program:
#
#   blender -b --factory-startup --python-exit-code 1 -P blender_bridge.py -- request.json
#
# The request is a small 3D scene the Helios AI writes (objects, material presets, a studio or
# gradient-lit world, a camera with keyframes). Keys carry CSS-style cubic-bezier eases, the motion
# engine's own `Ease`; a CSS cubic-bezier is exactly a bezier F-curve segment in (time, value), so
# the handles map 1:1. Output, in request["out"]:
#   00001.png …      frames with alpha (film transparent), numbered in render order
#   camera.json      per frame: position, point of interest, zoom (motion-engine axes and pixels)
#   objects2d.json   per frame: each object's screen centre and box (2D glints and callouts track them)
#   result.json      frames, fps, size, timings
# Progress is printed as {"progress": p, "message": m} JSON lines (Helios' worker protocol).
# Measured on this design (docs/REFERENCE-FILMS-PLAN.md §5): EEVEE 0.6–0.7 s and Cycles 2.2–3.5 s
# per 1080p frame on an RTX 3080; EEVEE glass needs raytraced refraction; EEVEE has no shadow
# catcher (a Shader-to-RGB shadow-only floor stands in); rigid bodies are not repeatable across
# processes, so motion here is always keyed.
import json
import math
import os
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
req = json.load(open(argv[0], encoding="utf-8"))
out = req["out"]
os.makedirs(out, exist_ok=True)
t_start = time.time()


def say(progress, message):
    print(json.dumps({"progress": round(progress, 4), "message": message}), flush=True)


def lin(x):
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def rgba(h, a=1.0):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (lin(int(h[0:2], 16) / 255), lin(int(h[2:4], 16) / 255), lin(int(h[4:6], 16) / 255), a)


# ------------------------------------------------------------------ scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
fps = int(req.get("fps", 30))
W, H = int(req["width"]), int(req["height"])
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = max(1, round(float(req["duration"]) * fps))
scene.render.resolution_x, scene.render.resolution_y = W, H
scene.render.resolution_percentage = 100
scene.render.film_transparent = req.get("transparent", True)
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
# Standard, not AgX/Filmic: brand colours must come out as the brand's hex values.
scene.view_settings.view_transform = req.get("viewTransform", "Standard")
engine = req.get("engine", "eevee")


# ------------------------------------------------------------------ keys
def fcurves(owner):
    ad = owner.animation_data
    if not ad or not ad.action:
        return
    act = ad.action
    if hasattr(act, "fcurves"):
        yield from act.fcurves
        return
    for layer in act.layers:  # Blender 4.4+ layered actions
        for strip in layer.strips:
            bag = strip.channelbag(ad.action_slot)
            if bag:
                yield from bag.fcurves


def keyed(owner, path, keys, convert=lambda v: v):
    """keys: [{t, v, ease}], `ease` shapes the segment that STARTS at the key (engine convention)."""
    for k in keys:
        value = convert(k["v"])
        setattr(owner, path, value if not isinstance(value, (list, tuple)) else Vector(value))
        owner.keyframe_insert(data_path=path, frame=1 + float(k["t"]) * fps)
    for fc in fcurves(owner):
        if fc.data_path != path:
            continue
        pts = fc.keyframe_points
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ease = keys[i].get("ease") if i < len(keys) else None
            if isinstance(ease, str):
                ease = NAMED.get(ease)
            x1, y1, x2, y2 = ease or [0.33, 0.0, 0.67, 1.0]
            dt, dv = b.co.x - a.co.x, b.co.y - a.co.y
            a.interpolation = "BEZIER"
            a.handle_right_type = "FREE"
            b.handle_left_type = "FREE"
            a.handle_right = (a.co.x + x1 * dt, a.co.y + y1 * dv)
            b.handle_left = (a.co.x + x2 * dt, a.co.y + y2 * dv)


# The motion engine's named eases (src/motion/anim.ts) that are cubic-beziers.
NAMED = {
    "linear": [0, 0, 1, 1], "ease": [0.25, 0.1, 0.25, 1], "ease-in": [0.42, 0, 1, 1], "ease-out": [0, 0, 0.58, 1], "ease-in-out": [0.42, 0, 0.58, 1],
    "cubic-out": [0.33, 1, 0.68, 1], "cubic-in": [0.32, 0, 0.67, 0], "cubic-in-out": [0.65, 0, 0.35, 1],
    "quart-out": [0.25, 1, 0.5, 1], "expo-out": [0.16, 1, 0.3, 1], "expo-in": [0.7, 0, 0.84, 0], "expo-in-out": [0.87, 0, 0.13, 1],
    "back-out": [0.34, 1.56, 0.64, 1], "house": [0.25, 0, 0, 1], "settle": [0.187, 0.368, 0.123, 0.981], "emphasized": [0.05, 0.7, 0.1, 1],
    "rise": [0.044, 0.419, 0.044, 0.991], "push": [0.57, 0, 0.41, 0.98], "creep": [1, 0.093, 0.856, 0.033], "snap-settle": [0.079, 0.602, 0.182, 0.958],
    "resolve": [0.162, 0.495, 0.117, 1.005], "card-zoom": [0.15, 0.46, 0.43, 1],
}

# ------------------------------------------------------------------ materials
def material(name, spec):
    spec = spec or {}
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    preset = spec.get("preset", "plastic")
    col = rgba(spec.get("color", "#8899ff"))
    bsdf.inputs["Base Color"].default_value = col
    if preset in ("glass", "frosted"):
        bsdf.inputs["Transmission Weight"].default_value = 1.0
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.04 if preset == "glass" else 0.35)
        bsdf.inputs["IOR"].default_value = spec.get("ior", 1.45)
        if spec.get("thinFilm"):
            bsdf.inputs["Thin Film Thickness"].default_value = spec["thinFilm"]
        # EEVEE glass (Cycles ignores these): raytraced refraction or it renders dark.
        m.use_raytrace_refraction = True
        m.thickness_mode = "SPHERE"
        m.surface_render_method = "DITHERED"
    elif preset == "pearl":
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.35)
        bsdf.inputs["Subsurface Weight"].default_value = spec.get("subsurface", 0.25)
        bsdf.inputs["Coat Weight"].default_value = 1.0
        bsdf.inputs["Coat Roughness"].default_value = 0.05
        bsdf.inputs["Sheen Weight"].default_value = spec.get("sheen", 0.5)
    elif preset in ("metal", "gem"):
        bsdf.inputs["Metallic"].default_value = spec.get("metallic", 1.0)
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.22 if preset == "metal" else 0.15)
    elif preset == "clay":
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.8)
        bsdf.inputs["Specular IOR Level"].default_value = 0.2
    elif preset == "image":
        # A picture on the surface (a UI screen on a device, a poster): lit a little, glowing like a screen.
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(spec["image"], check_existing=True)
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = spec.get("strength", 0.85)
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.25)
    elif preset in ("emission", "flat"):
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = spec.get("strength", 6.0 if preset == "emission" else 1.0)
        if preset == "flat":
            bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
            bsdf.inputs["Specular IOR Level"].default_value = 0.0
    else:  # glossy plastic
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.3)
        bsdf.inputs["Coat Weight"].default_value = spec.get("coat", 0.6)
    return m


def shadow_only(name, lit=0.8, strength=0.6, radius=None):
    """EEVEE has no shadow catcher: a white diffuse floor through Shader-to-RGB becomes the alpha of a
    black layer (lit -> transparent, shadowed -> dark), faded out with distance."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Max"].default_value = lit
    mr.inputs["To Min"].default_value = strength
    mr.inputs["To Max"].default_value = 0.0
    mr.clamp = True
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = 0.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], bw.inputs[0])
    nt.links.new(bw.outputs[0], mr.inputs["Value"])
    fac = mr.outputs["Result"]
    if radius:
        tc = nt.nodes.new("ShaderNodeTexCoord")
        ln = nt.nodes.new("ShaderNodeVectorMath")
        ln.operation = "LENGTH"
        fade = nt.nodes.new("ShaderNodeMapRange")
        fade.interpolation_type = "SMOOTHSTEP"
        fade.inputs["From Min"].default_value = radius * 0.55
        fade.inputs["From Max"].default_value = radius
        fade.inputs["To Min"].default_value = 1.0
        fade.inputs["To Max"].default_value = 0.0
        mul = nt.nodes.new("ShaderNodeMath")
        mul.operation = "MULTIPLY"
        nt.links.new(tc.outputs["Object"], ln.inputs[0])
        nt.links.new(ln.outputs["Value"], fade.inputs["Value"])
        nt.links.new(fac, mul.inputs[0])
        nt.links.new(fade.outputs["Result"], mul.inputs[1])
        fac = mul.outputs[0]
    nt.links.new(fac, mix.inputs["Fac"])
    nt.links.new(tr.outputs[0], mix.inputs[1])
    nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], o.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    return m


# ------------------------------------------------------------------ objects
def mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def crystal(o):
    import random
    rnd = random.Random(o.get("seed", 3))
    n, r, h = o.get("sides", 6), o.get("radius", 0.3), o.get("height", 0.9)
    verts, faces = [], []
    for ring_z in (-h / 2, h / 2):
        for i in range(n):
            a = 2 * math.pi * i / n + (0.15 if ring_z > 0 else 0)
            rr = r * (1 + rnd.uniform(-0.05, 0.05))
            verts.append((rr * math.cos(a), rr * math.sin(a), ring_z + rnd.uniform(-0.05, 0.05) * h * 0.3))
    top, bot = len(verts), len(verts) + 1
    verts.append((r * 0.35, 0.0, h / 2 + o.get("tip", 0.4)))
    verts.append((-r * 0.1, 0.0, -h / 2 - o.get("base", 0.22)))
    for i in range(n):
        j = (i + 1) % n
        faces += [(i, j, n + j, n + i), (n + i, n + j, top), (j, i, bot)]
    ob = mesh_object(o["id"], verts, faces)
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def build(o):
    kind = o["kind"]
    if kind in ("box", "rounded-box"):
        bpy.ops.mesh.primitive_cube_add(size=1)
        ob = bpy.context.active_object
        ob.scale = o.get("size", [1, 1, 1])
        bpy.ops.object.transform_apply(scale=True)
        if o.get("radius", 0.06 if kind == "rounded-box" else 0):
            bev = ob.modifiers.new("bevel", "BEVEL")
            bev.width = o.get("radius", 0.06)
            bev.segments = 8
            smooth(ob)
    elif kind == "sphere":
        bpy.ops.mesh.primitive_uv_sphere_add(radius=o.get("radius", 0.5), segments=64, ring_count=32)
        ob = bpy.context.active_object
        smooth(ob)
    elif kind == "icosphere":
        bpy.ops.mesh.primitive_ico_sphere_add(radius=o.get("radius", 0.5), subdivisions=o.get("detail", 1))
        ob = bpy.context.active_object
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=o.get("major", 0.6), minor_radius=o.get("minor", 0.18), major_segments=96, minor_segments=32)
        ob = bpy.context.active_object
        smooth(ob)
    elif kind in ("cylinder", "cone"):
        if kind == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(radius=o.get("radius", 0.4), depth=o.get("height", 1), vertices=64)
        else:
            bpy.ops.mesh.primitive_cone_add(radius1=o.get("radius", 0.4), depth=o.get("height", 1), vertices=64)
        ob = bpy.context.active_object
        smooth(ob)
    elif kind == "capsule":
        bpy.ops.mesh.primitive_cylinder_add(radius=o.get("radius", 0.25), depth=o.get("height", 1), vertices=48)
        ob = bpy.context.active_object
        bev = ob.modifiers.new("round", "BEVEL")
        bev.width = o.get("radius", 0.25) * 0.98
        bev.segments = 12
        bev.limit_method = "NONE"
        smooth(ob)
    elif kind == "crystal":
        ob = crystal(o)
    elif kind == "text":
        cu = bpy.data.curves.new(o["id"], "FONT")
        cu.body = o.get("text", "Helios")
        cu.align_x, cu.align_y = "CENTER", "CENTER"
        cu.extrude = o.get("extrude", 0.08)
        cu.bevel_depth = o.get("bevel", 0.015)
        cu.bevel_resolution = 4
        cu.size = o.get("size", 0.6)
        ob = bpy.data.objects.new(o["id"], cu)
        scene.collection.objects.link(ob)
    elif kind == "empty":
        # An invisible pivot: parent objects to it and key it to spin a group (a ring of cards).
        ob = bpy.data.objects.new(o["id"], None)
        scene.collection.objects.link(ob)
    elif kind == "plane":
        # A flat card (UV 0–1 across it), standing upright facing the camera by default: size [w, h].
        bpy.ops.mesh.primitive_plane_add(size=1)
        ob = bpy.context.active_object
        w, h = (o.get("size") or [1, 1])[:2]
        ob.scale = (w, h, 1)
        bpy.ops.object.transform_apply(scale=True)
        if "rotation" not in o:
            o["rotation"] = [90, 0, 0]
    elif kind == "floor":
        bpy.ops.mesh.primitive_plane_add(size=o.get("size", 40))
        ob = bpy.context.active_object
        mode = o.get("shadow", "auto")
        if mode == "auto":
            mode = "catcher" if engine == "cycles" else "shadow-only"
        if mode == "catcher":
            ob.is_shadow_catcher = True
        elif mode == "shadow-only":
            ob.data.materials.append(shadow_only(o["id"] + "-mat", o.get("lit", 0.8), o.get("strength", 0.6), o.get("fade", 6)))
            ob.visible_shadow = False
        elif mode == "none":
            ob.hide_render = True
    else:
        raise ValueError(f"unknown object kind {kind}")
    ob.name = o["id"]
    if o.get("parent") in objects:
        # Position, rotation and keys are then relative to the parent: a screen rides its device.
        ob.parent = objects[o["parent"]]
    ob.location = o.get("position", [0, 0, 0])
    ob.rotation_euler = [math.radians(a) for a in o.get("rotation", [0, 0, 0])]
    if "scale" in o:
        s = o["scale"]
        ob.scale = [s, s, s] if isinstance(s, (int, float)) else s
    if o.get("material") and kind not in ("floor", "empty"):
        ob.data.materials.append(material(o["id"] + "-mat", o["material"]))
    if o.get("positionKeys"):
        keyed(ob, "location", o["positionKeys"])
    if o.get("rotationKeys"):
        keyed(ob, "rotation_euler", o["rotationKeys"], lambda v: [math.radians(a) for a in v])
    if o.get("scaleKeys"):
        keyed(ob, "scale", o["scaleKeys"], lambda v: [v, v, v] if isinstance(v, (int, float)) else v)
    return ob


say(0.01, "building the scene")
objects = {}
for o in req.get("objects", []):
    objects[o["id"]] = build(o)

# ------------------------------------------------------------------ lights
lights = req.get("lights", "studio")
if lights == "studio":
    lights = [
        {"id": "key", "position": [-2.5, -3.0, 3.0], "power": 700, "size": 3, "color": "#fff4ea"},
        {"id": "fill", "position": [3.0, -2.0, 1.2], "power": 250, "size": 4, "color": "#dfe6ff"},
        {"id": "rim", "position": [0.0, 3.0, 2.5], "power": 600, "size": 2, "color": "#ffffff"},
    ]
for L in lights or []:
    ld = bpy.data.lights.new(L["id"], L.get("kind", "AREA").upper())
    ld.energy = L.get("power", 400)
    if ld.type == "AREA":
        ld.size = L.get("size", 3)
    ld.color = rgba(L.get("color", "#ffffff"))[:3]
    lo = bpy.data.objects.new(L["id"], ld)
    scene.collection.objects.link(lo)
    lo.location = L["position"]
    lo.rotation_euler = (Vector(L.get("target", [0, 0, 0])) - lo.location).to_track_quat("-Z", "Y").to_euler()

# ------------------------------------------------------------------ world
world = bpy.data.worlds.new("world")
world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes["Background"]
wspec = req.get("world", {"color": "#1b1d3a"})
if isinstance(wspec, str):
    wspec = {"color": wspec}
if wspec.get("gradient"):
    # A hand-made gradient environment (the Modern Motion crystal trick): colour bands that run
    # AROUND the horizon, so faceted metal picks a different hue on every facet.
    import numpy as np
    stops = sorted(wspec["gradient"], key=lambda s: s[0])
    ew, eh = 512, 256
    u = np.linspace(0, 1, ew, endpoint=False)
    cols = np.zeros((ew, 3))
    pos = [s[0] for s in stops]
    for c in range(3):
        cols[:, c] = np.interp(u, pos, [rgba(s[1])[c] for s in stops], period=1.0)
    v = np.linspace(0, 1, eh)[:, None]
    horizon = 1.0 - np.clip(np.abs(v - 0.5) * 2.0, 0, 1) ** 1.5 * wspec.get("poleFade", 0.6)
    img = np.ones((eh, ew, 4))
    img[:, :, :3] = cols[None, :, :] * horizon[:, :, None]
    image = bpy.data.images.new("helios-gradient-env", ew, eh, float_buffer=True)
    image.pixels.foreach_set(img.astype(np.float32).ravel())
    env = wnt.nodes.new("ShaderNodeTexEnvironment")
    env.image = image
    wnt.links.new(env.outputs["Color"], bg.inputs["Color"])
else:
    bg.inputs[0].default_value = rgba(wspec.get("color", "#1b1d3a"))
bg.inputs[1].default_value = wspec.get("strength", 0.6)
scene.world = world

# ------------------------------------------------------------------ camera
cs = req.get("camera", {})
cd = bpy.data.cameras.new("cam")
cd.lens = cs.get("lens", 50)
cd.sensor_fit = "HORIZONTAL"
cd.sensor_width = cs.get("sensor", 36)
cam = bpy.data.objects.new("cam", cd)
scene.collection.objects.link(cam)
scene.camera = cam
target = bpy.data.objects.new("cam-target", None)
scene.collection.objects.link(target)
target.location = cs.get("target", [0, 0, 0])
track = cam.constraints.new("TRACK_TO")
track.target = target
track.track_axis = "TRACK_NEGATIVE_Z"
track.up_axis = "UP_Y"
cam.location = cs.get("position", [0, -6, 1.2])
if cs.get("fstop"):
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = cs["fstop"]
    cd.dof.focus_object = target
if cs.get("positionKeys"):
    keyed(cam, "location", cs["positionKeys"])
if cs.get("targetKeys"):
    keyed(target, "location", cs["targetKeys"])

# ------------------------------------------------------------------ engine
if engine == "cycles":
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    device = "NONE"
    for kind in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            if any(d.type == kind for d in prefs.devices):
                device = kind
                break
        except Exception:  # noqa: BLE001 - backend not built for this machine
            continue
    for d in prefs.devices:
        d.use = d.type == device
    scene.cycles.device = "GPU" if device != "NONE" else "CPU"
    scene.cycles.samples = req.get("samples", 32)
    scene.cycles.use_denoising = True
    scene.cycles.use_adaptive_sampling = True
    scene.render.use_persistent_data = True
else:
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = req.get("samples", 32)
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True
scene.render.use_motion_blur = req.get("motionBlur", True)

# ------------------------------------------------------------------ camera + objects for the 2D compositor
# Motion engine / AE axes: pixels, +y down, +z away from the viewer, camera in front at negative z.
PX = float(req.get("pxPerMetre", 1000))
to_px = lambda v: [round(v.x * PX + W / 2, 3), round(-v.z * PX + H / 2, 3), round(v.y * PX, 3)]  # noqa: E731
camera_frames, object_frames = [], []
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    camera_frames.append({"frame": f, "t": round((f - 1) / fps, 5), "position": to_px(cam.matrix_world.to_translation()),
                          "pointOfInterest": to_px(target.matrix_world.to_translation()), "zoom": round(cd.lens / cd.sensor_width * W, 3),
                          "fstop": cd.dof.aperture_fstop if cd.dof.use_dof else None})
    entry = {"frame": f}
    for oid, ob in objects.items():
        if ob.type not in ("MESH", "FONT"):
            continue
        corners = [world_to_camera_view(scene, cam, ob.matrix_world @ Vector(c)) for c in ob.bound_box]
        xs = [c.x * W for c in corners]
        ys = [(1 - c.y) * H for c in corners]
        centre = world_to_camera_view(scene, cam, ob.matrix_world.to_translation())
        entry[oid] = {"x": round(centre.x * W, 2), "y": round((1 - centre.y) * H, 2), "box": [round(min(xs), 1), round(min(ys), 1), round(max(xs) - min(xs), 1), round(max(ys) - min(ys), 1)], "behind": centre.z < 0}
    object_frames.append(entry)
json.dump({"fps": fps, "width": W, "height": H, "pxPerMetre": PX, "frames": camera_frames}, open(os.path.join(out, "camera.json"), "w"))
json.dump({"fps": fps, "frames": object_frames}, open(os.path.join(out, "objects2d.json"), "w"))

# ------------------------------------------------------------------ render
frames = req.get("frames") or list(range(scene.frame_start, scene.frame_end + 1))
step = max(1, int(req.get("step", 1)))
frames = frames[::step]
times = []
say(0.03, f"rendering {len(frames)} frame(s) with {engine}")
for i, f in enumerate(frames):
    scene.frame_set(f)
    # Files are numbered 00001… in render order, so a stepped or picked run is still one sequence.
    scene.render.filepath = os.path.join(out, f"{i + 1:05d}.png")
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    times.append(round(time.time() - t0, 3))
    say(0.03 + 0.96 * (i + 1) / len(frames), f"frame {i + 1}/{len(frames)} in {times[-1]} s")

json.dump({"ok": True, "engine": engine, "frames": len(frames), "frameNumbers": frames, "step": step, "fps": fps, "width": W, "height": H,
           "secondsPerFrame": times, "totalSeconds": round(time.time() - t_start, 2), "blender": bpy.app.version_string},
          open(os.path.join(out, "result.json"), "w"), indent=1)
say(1.0, "done")
