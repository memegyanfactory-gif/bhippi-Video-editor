"""Proof 2 of the Helios <-> Blender headless bridge (extends blender_bridge_proof.py).

blender -b --factory-startup -P proof2.py -- request.json

Everything the first proof did (primitives, extruded text, material presets, 3-light studio, two-node
camera with CSS cubic-bezier eases mapped 1:1 to F-curve handles, PNG RGBA, camera.json), plus:

- world: a hex colour, or {"image": equirect.png, "strength", "rotationZ", "rotationKeys"} so Helios can
  hand Blender a gradient environment it rendered itself (the Modern Motion "Custom_HDRI" trick);
- object kinds: crystal (faceted hex prism with a slanted tip), icosphere, cyclorama, window gobo,
  letter (one extruded glyph, converted to a mesh so it can take a rigid body);
- keyed position / rotation / scale with eases, so Helios can precompute a "drop-bounce";
- EEVEE glass: per-material raytraced refraction, thickness mode, render method; optional sphere probes;
- floor shadow modes: catcher (Cycles), shadow-only (EEVEE Shader-to-RGB trick), visible, none;
- physics: rigid body world, staggered kinematic release, timed bake, per-frame transforms + hash;
- passes: Z / object index / cryptomatte into a multilayer EXR, PNG and EXR saved from ONE render;
- objects2d.json: each object's projected 2D position per frame (for 2D callouts that track 3D objects);
- timings: build, bake, first frame (compile) and steady frames, all in result.json.

Prints `{"progress", "message"}` JSON lines like every Helios worker.
"""
import hashlib
import json
import math
import os
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

T0 = time.time()
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
req = json.load(open(argv[0], encoding="utf-8"))
out = req["out"]
os.makedirs(out, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(argv[0]))


def say(progress, message):
    print(json.dumps({"progress": round(progress, 4), "message": message}), flush=True)


def srgb_to_lin(x):
    return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4


def hex_rgba(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*[srgb_to_lin(x) for x in c], a)  # Blender colour inputs are linear


def rel(p):
    return p if os.path.isabs(p) else os.path.join(HERE, p)


# ------------------------------------------------------------------ scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
fps = req.get("fps", 30)
scene.render.fps = fps
scene.frame_start = 1
scene.frame_end = max(1, round(req["duration"] * fps))
scene.render.resolution_x, scene.render.resolution_y = req["width"], req["height"]
scene.render.resolution_percentage = 100
scene.render.film_transparent = req.get("transparent", True)
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = req.get("view_transform", "AgX")
scene.view_settings.look = "None"
engine = req.get("engine", "eevee")
EE = req.get("eevee", {})
font = bpy.data.fonts.load(req["font"]) if req.get("font") else None


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
        bsdf.inputs["IOR"].default_value = spec.get("ior", 1.45)
        bsdf.inputs["Thin Film Thickness"].default_value = spec.get("thinFilm", 380.0)
        g = EE.get("glass", {})
        if g:  # EEVEE-only material settings; Cycles ignores them
            m.use_raytrace_refraction = g.get("raytraceRefraction", False)
            m.thickness_mode = g.get("thickness", "SPHERE")
            m.surface_render_method = g.get("renderMethod", "DITHERED")
            m.use_thickness_from_shadow = g.get("thicknessFromShadow", False)
            if g.get("renderMethod") == "BLENDED":
                m.show_transparent_back = g.get("showBackface", True)
                m.use_transparency_overlap = True
    elif preset in ("metal", "gem"):
        bsdf.inputs["Metallic"].default_value = spec.get("metallic", 1.0 if preset == "metal" else 0.7)
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.22 if preset == "metal" else 0.2)
        if spec.get("coat"):
            bsdf.inputs["Coat Weight"].default_value = spec["coat"]
    elif preset == "emission":
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = spec.get("strength", 6.0)
    elif preset == "matte":
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.7)
        bsdf.inputs["Specular IOR Level"].default_value = spec.get("specular", 0.3)
    else:  # glossy plastic
        bsdf.inputs["Roughness"].default_value = spec.get("roughness", 0.3)
        bsdf.inputs["Coat Weight"].default_value = spec.get("coat", 0.6)
    return m


def shadow_only_material(name, lit=0.8, strength=0.65, shade="#000000", method="BLENDED", radius=None):
    """EEVEE has no shadow catcher. Classic trick: a diffuse white floor goes through Shader-to-RGB,
    its brightness becomes the alpha of a black layer (lit -> transparent, shadowed -> dark)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    dif = nt.nodes.new("ShaderNodeBsdfDiffuse")
    dif.inputs["Color"].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    mr = nt.nodes.new("ShaderNodeMapRange")  # brightness [0, lit] -> shadow alpha [strength, 0]
    mr.inputs["From Min"].default_value = 0.0
    mr.inputs["From Max"].default_value = lit
    mr.inputs["To Min"].default_value = strength
    mr.inputs["To Max"].default_value = 0.0
    mr.clamp = True
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = hex_rgba(shade)
    em.inputs["Strength"].default_value = 0.0 if shade == "#000000" else 1.0
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(dif.outputs[0], s2r.inputs[0])
    nt.links.new(s2r.outputs["Color"], bw.inputs[0])
    nt.links.new(bw.outputs[0], mr.inputs["Value"])
    fac = mr.outputs["Result"]
    if radius:  # fade the catcher out with distance: far floor gets less light, which would read as "shadow"
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
    m.surface_render_method = method  # BLENDED: smooth alpha; DITHERED: stochastic alpha (grainy at 32 spp)
    return m


# ------------------------------------------------------------------ easing -> F-curve handles
def _fcurves(obj_or_id):
    ad = obj_or_id.animation_data
    act = ad.action
    if hasattr(act, "fcurves"):
        yield from act.fcurves
        return
    slot = ad.action_slot  # Blender 4.4+ slotted/layered actions
    for layer in act.layers:
        for strip in layer.strips:
            bag = strip.channelbag(slot)
            if bag:
                yield from bag.fcurves


def keyframe(obj, path, keys, index_count):
    """keys: [{t, v, ease}] where ease is [x1,y1,x2,y2] for the segment that STARTS at the key
    (the motion engine's convention). A CSS cubic-bezier is a 2D bezier in (time, value) space,
    exactly what a Blender bezier F-curve segment is, so handles map 1:1."""
    for k in keys:
        frame = 1 + k["t"] * fps
        setattr(obj, path, k["v"]) if index_count == 1 else setattr(obj, path, Vector(k["v"]))
        obj.keyframe_insert(data_path=path, frame=frame)
    for fc in _fcurves(obj):
        if fc.data_path != path:
            continue
        pts = fc.keyframe_points
        for i in range(len(pts) - 1):
            a, b = pts[i], pts[i + 1]
            ease = keys[i].get("ease") or [0.33, 0.0, 0.67, 1.0]
            x1, y1, x2, y2 = ease
            dt = b.co.x - a.co.x
            dv = b.co.y - a.co.y
            a.interpolation = "BEZIER"
            a.handle_right_type = "FREE"
            b.handle_left_type = "FREE"
            a.handle_right = (a.co.x + x1 * dt, a.co.y + y1 * dv)
            b.handle_left = (a.co.x + x2 * dt, a.co.y + y2 * dv)


# ------------------------------------------------------------------ geometry builders
def make_mesh_object(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def build_crystal(o):
    """Hexagonal prism with a slanted pointed tip and a short pointed base: 18 flat facets,
    like the Modern Motion crystal (modelled from a cube with loop cuts in the film)."""
    import random
    rnd = random.Random(o.get("seed", 3))
    n = o.get("sides", 6)
    r = o.get("radius", 0.3)
    h = o.get("height", 0.9)
    tip, base = o.get("tip", 0.4), o.get("base", 0.22)
    jit = o.get("jitter", 0.05)
    verts, faces = [], []
    for ring_z in (-h / 2, h / 2):
        for i in range(n):
            a = 2 * math.pi * i / n + (0.15 if ring_z > 0 else 0)
            rr = r * (1 + rnd.uniform(-jit, jit))
            verts.append((rr * math.cos(a), rr * math.sin(a), ring_z + rnd.uniform(-jit, jit) * h * 0.3))
    top = len(verts)
    verts.append((r * o.get("tipOffset", 0.35), 0.0, h / 2 + tip))
    bot = len(verts)
    verts.append((-r * 0.1, 0.0, -h / 2 - base))
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, n + j, n + i))
        faces.append((n + i, n + j, top))
        faces.append((j, i, bot))
    ob = make_mesh_object(o["id"], verts, faces)
    for p in ob.data.polygons:
        p.use_smooth = False
    if o.get("bevel", 0.012):
        bev = ob.modifiers.new("bevel", "BEVEL")
        bev.width = o.get("bevel", 0.012)
        bev.segments = 1
        bev.limit_method = "ANGLE"
    return ob


def build_cyclorama(o):
    """Floor that curves up into a back wall (the 'painted cyclorama' of the film)."""
    w, depth, wall_y, height, R = o.get("width", 30), o.get("front", 12), o.get("wallY", 4.0), o.get("height", 10), o.get("fillet", 1.5)
    prof = [(-depth, 0.0), (wall_y - R, 0.0)]
    for k in range(1, 12):
        a = -math.pi / 2 + (math.pi / 2) * k / 12
        prof.append((wall_y - R + R * math.cos(a), R + R * math.sin(a)))
    prof += [(wall_y, R), (wall_y, height)]
    verts, faces = [], []
    for (y, z) in prof:
        verts.append((-w / 2, y, z))
        verts.append((w / 2, y, z))
    for i in range(len(prof) - 1):
        a, b = 2 * i, 2 * (i + 1)
        faces.append((a, a + 1, b + 1, b))
    ob = make_mesh_object(o["id"], verts, faces)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def build_gobo(o):
    """A window frame that only casts shadows (invisible to camera): 2x2 panes by default."""
    W, H, bar, cols, rows = o.get("w", 2.4), o.get("h", 3.0), o.get("bar", 0.12), o.get("cols", 2), o.get("rows", 2)
    big = o.get("surround", 12.0)
    boxes = []  # (cx, cz, sx, sz) in the window plane (x, z)
    boxes += [(0, H / 2 + big / 2, W + 2 * big, big), (0, -H / 2 - big / 2, W + 2 * big, big)]
    boxes += [(-W / 2 - big / 2, 0, big, H), (W / 2 + big / 2, 0, big, H)]
    for c in range(1, cols):
        boxes.append((-W / 2 + W * c / cols, 0, bar, H))
    for r_ in range(1, rows):
        boxes.append((0, -H / 2 + H * r_ / rows, W, bar))
    verts, faces = [], []
    for (cx, cz, sx, sz) in boxes:
        b = len(verts)
        for dx, dz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            verts.append((cx + dx * sx / 2, 0.0, cz + dz * sz / 2))
        faces.append((b, b + 1, b + 2, b + 3))
    ob = make_mesh_object(o["id"], verts, faces)
    ob.visible_camera = o.get("cameraVisible", False)
    ob.visible_glossy = False
    ob.visible_diffuse = False
    ob.visible_transmission = False
    return ob


def build_letter(o):
    cu = bpy.data.curves.new(o["id"], "FONT")
    cu.body = o["text"]
    if font:
        cu.font = font
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = o.get("extrude", 0.1)
    cu.bevel_depth = o.get("bevel", 0.015)
    cu.bevel_resolution = 3
    cu.size = o.get("size", 0.8)
    ob = bpy.data.objects.new(o["id"], cu)
    scene.collection.objects.link(ob)
    # a rigid body needs a mesh with its origin at the centre of its bounds
    bpy.context.view_layer.objects.active = ob
    for x in bpy.context.view_layer.objects:
        x.select_set(False)
    ob.select_set(True)
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.origin_set(type="ORIGIN_GEOMETRY", center="BOUNDS")
    ob = bpy.context.active_object
    ob.name = o["id"]
    try:  # smooth bevels, crisp faces (Blender 4.1+ operator; no modifier or asset needed)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    except Exception:
        bpy.ops.object.shade_flat()
    return ob


# ------------------------------------------------------------------ objects
built = {}
floors = {}
t_build0 = time.time()
for idx, o in enumerate(req["objects"]):
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
    elif kind == "icosphere":
        bpy.ops.mesh.primitive_ico_sphere_add(radius=o.get("radius", 0.4), subdivisions=o.get("subdivisions", 1))
        ob = bpy.context.active_object
        bpy.ops.object.shade_flat()
    elif kind == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=o.get("major", 0.6), minor_radius=o.get("minor", 0.18), major_segments=96, minor_segments=32)
        ob = bpy.context.active_object
        bpy.ops.object.shade_smooth()
    elif kind == "text":
        cu = bpy.data.curves.new(o["id"], "FONT")
        cu.body = o["text"]
        if font:
            cu.font = font
        cu.align_x = "CENTER"
        cu.align_y = "CENTER"
        cu.extrude = o.get("extrude", 0.08)
        cu.bevel_depth = o.get("bevel", 0.015)
        cu.bevel_resolution = 4
        cu.size = o.get("size", 0.6)
        ob = bpy.data.objects.new(o["id"], cu)
        scene.collection.objects.link(ob)
    elif kind == "letter":
        ob = build_letter(o)
    elif kind == "crystal":
        ob = build_crystal(o)
    elif kind == "cyclorama":
        ob = build_cyclorama(o)
    elif kind == "gobo":
        ob = build_gobo(o)
    elif kind == "floor":
        bpy.ops.mesh.primitive_plane_add(size=o.get("size", 40))
        ob = bpy.context.active_object
        mode = o.get("shadow", "catcher")
        if mode == "auto":
            mode = "catcher" if engine == "cycles" else "shadow-only"
        if mode == "catcher":
            ob.is_shadow_catcher = True  # Cycles: only the shadow survives on transparent film
        elif mode == "shadow-only":
            ob.data.materials.append(shadow_only_material(o["id"] + "-mat", o.get("lit", 0.8), o.get("strength", 0.65), method=o.get("method", "BLENDED"), radius=o.get("radius")))
            ob.visible_shadow = False
        elif mode == "none":
            ob.hide_render = True
        floors[o["id"]] = mode
    else:
        raise ValueError(f"unknown kind {kind}")
    ob.name = o["id"]
    ob.pass_index = idx + 1
    ob.location = o.get("position", [0, 0, 0])
    ob.rotation_euler = [math.radians(a) for a in o.get("rotation", [0, 0, 0])]
    if "scale" in o and kind not in ("box",):
        ob.scale = o["scale"]
    if "lookAt" in o:  # orient local +Y toward a point (gobo windows face their light)
        ob.rotation_euler = (Vector(o["lookAt"]) - ob.location).to_track_quat("Y", "Z").to_euler()
    if o.get("sitOn") is not None:  # rest the object's lowest point on z = sitOn at its base rotation
        bpy.context.view_layer.update()
        rot = ob.rotation_euler.to_matrix()
        minz = min((rot @ Vector(c)).z for c in ob.bound_box)
        ob.location.z = o["sitOn"] - minz
    base_loc = Vector(ob.location)
    if "material" in o:
        ob.data.materials.clear()
        ob.data.materials.append(material(o["id"] + "-mat", o["material"]))
    if "rotationKeys" in o:
        keys = [{"t": k["t"], "v": [math.radians(a) for a in k["v"]], "ease": k.get("ease")} for k in o["rotationKeys"]]
        keyframe(ob, "rotation_euler", keys, 3)
    if "positionKeys" in o:
        pk = o["positionKeys"]
        if o.get("keysRelative"):  # offsets from the resting position (Helios precomputes a drop-bounce)
            pk = [{**k, "v": [base_loc[j] + k["v"][j] for j in range(3)]} for k in pk]
        keyframe(ob, "location", pk, 3)
    if "scaleKeys" in o:
        keyframe(ob, "scale", o["scaleKeys"], 3)
    built[o["id"]] = ob

# ------------------------------------------------------------------ lights
for L in req.get("lights", []):
    ltype = L.get("type", "AREA")
    ld = bpy.data.lights.new(L["id"], ltype)
    ld.energy = L.get("power", 400)
    if ltype == "AREA":
        ld.size = L.get("size", 3)
    if ltype == "SUN":
        ld.angle = math.radians(L.get("angle", 2.0))
    if ltype == "SPOT":
        ld.spot_size = math.radians(L.get("cone", 45))
        ld.spot_blend = L.get("blend", 0.3)
        ld.shadow_soft_size = L.get("radius", 0.1)
    ld.color = hex_rgba(L.get("color", "#ffffff"))[:3]
    lo = bpy.data.objects.new(L["id"], ld)
    scene.collection.objects.link(lo)
    lo.location = L["position"]
    direction = Vector(L.get("target", [0, 0, 0])) - lo.location
    lo.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

for P in req.get("probes", []):  # EEVEE sphere probes (auto-updated at render time in EEVEE Next)
    lp = bpy.data.lightprobes.new(P["id"], "SPHERE")
    lp.influence_distance = P.get("radius", 1.5)
    lp.clip_start = P.get("clipStart", 0.05)
    po = bpy.data.objects.new(P["id"], lp)
    scene.collection.objects.link(po)
    po.location = P["position"]

# ------------------------------------------------------------------ world
world = bpy.data.worlds.new("world")
world.use_nodes = True
wnt = world.node_tree
bg = wnt.nodes["Background"]
wspec = req.get("world", "#20223a")
if isinstance(wspec, str):
    wspec = {"color": wspec}
if wspec.get("image"):
    env = wnt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(rel(wspec["image"]))
    env.image.colorspace_settings.name = "sRGB"
    env.interpolation = "Linear"
    mapping = wnt.nodes.new("ShaderNodeMapping")
    coord = wnt.nodes.new("ShaderNodeTexCoord")
    wnt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
    wnt.links.new(mapping.outputs["Vector"], env.inputs["Vector"])
    wnt.links.new(env.outputs["Color"], bg.inputs["Color"])
    mapping.inputs["Rotation"].default_value = (0, 0, math.radians(wspec.get("rotationZ", 0)))
    if wspec.get("rotationKeys"):  # animate the environment (the AE "Custom_HDRI" comp could animate too)
        for k in wspec["rotationKeys"]:
            mapping.inputs["Rotation"].default_value = (0, 0, math.radians(k["v"]))
            mapping.inputs["Rotation"].keyframe_insert("default_value", frame=1 + k["t"] * fps)
else:
    bg.inputs[0].default_value = hex_rgba(wspec.get("color", "#20223a"))
bg.inputs[1].default_value = wspec.get("strength", req.get("worldStrength", 0.6))
if wspec.get("haze"):  # atmospheric haze: light shafts through the gobo (EEVEE volumetrics)
    hz = wspec["haze"]
    pv = wnt.nodes.new("ShaderNodeVolumePrincipled")
    pv.inputs["Density"].default_value = hz.get("density", 0.02)
    pv.inputs["Anisotropy"].default_value = hz.get("anisotropy", 0.3)
    pv.inputs["Color"].default_value = hex_rgba(hz.get("color", "#ffffff"))
    wnt.links.new(pv.outputs[0], wnt.nodes["World Output"].inputs["Volume"])
    scene.eevee.volumetric_end = hz.get("end", 30.0)
    scene.eevee.volumetric_tile_size = str(hz.get("tile", 8))
    scene.eevee.use_volumetric_shadows = hz.get("shadows", True)
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
    if cam_spec.get("focus"):
        cd.dof.focus_object = built[cam_spec["focus"]]
    else:
        cd.dof.focus_object = target
if cam_spec.get("positionKeys"):
    keyframe(cam, "location", cam_spec["positionKeys"], 3)
else:
    cam.location = cam_spec["position"]
t_build = time.time() - t_build0

# ------------------------------------------------------------------ engine
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
    cy = req.get("cycles", {})
    scene.render.use_persistent_data = cy.get("persistentData", False)
    if "adaptiveThreshold" in cy:
        scene.cycles.adaptive_threshold = cy["adaptiveThreshold"]
    if "filmTransparentGlass" in cy:
        scene.cycles.film_transparent_glass = cy["filmTransparentGlass"]
else:
    scene.render.engine = "BLENDER_EEVEE"
    ee = scene.eevee
    ee.taa_render_samples = req.get("samples", 32)
    ee.use_raytracing = EE.get("raytracing", True)  # proof 1 behaviour: raytracing on
    ee.ray_tracing_method = EE.get("method", "SCREEN")
    if "resolution" in EE:
        ee.ray_tracing_options.resolution_scale = str(EE["resolution"])
    if "fastGI" in EE:
        ee.use_fast_gi = EE["fastGI"]
    if "shadowRays" in EE:
        ee.shadow_ray_count = EE["shadowRays"]
scene.render.use_motion_blur = req.get("motionBlur", True)

# ------------------------------------------------------------------ physics (rigid body drop)
phys = req.get("physics")
physics_info = None


def select_only(ob):
    for x in bpy.context.view_layer.objects:
        x.select_set(False)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)


if phys:
    bpy.ops.rigidbody.world_add()
    rbw = scene.rigidbody_world
    rbw.substeps_per_frame = phys.get("substeps", 10)
    rbw.solver_iterations = phys.get("iterations", 10)
    rbw.point_cache.frame_start = scene.frame_start
    rbw.point_cache.frame_end = scene.frame_end
    for pid in phys.get("passive", []):
        ob = built[pid]
        select_only(ob)
        bpy.ops.rigidbody.object_add(type="PASSIVE")
        ob.rigid_body.collision_shape = phys.get("passiveShape", "MESH")
        ob.rigid_body.friction = phys.get("friction", 0.6)
        ob.rigid_body.restitution = phys.get("floorRestitution", 0.5)
    for i, aid in enumerate(phys.get("active", [])):
        ob = built[aid]
        select_only(ob)
        bpy.ops.rigidbody.object_add(type="ACTIVE")
        rb = ob.rigid_body
        rb.collision_shape = phys.get("shape", "CONVEX_HULL")
        rb.mass = phys.get("mass", 1.0)
        rb.friction = phys.get("friction", 0.6)
        rb.restitution = phys.get("restitution", 0.35)
        rb.linear_damping = phys.get("linearDamping", 0.1)
        rb.angular_damping = phys.get("angularDamping", 0.2)
        rb.collision_margin = phys.get("margin", 0.01)
        rel_f = 1 + round(phys.get("stagger", 0.1) * fps * i)
        if rel_f > 1:  # hold it in the air (kinematic) until its release frame: the stagger
            rb.kinematic = True
            rb.keyframe_insert("kinematic", frame=1)
            rb.keyframe_insert("kinematic", frame=rel_f - 1)
            rb.kinematic = False
            rb.keyframe_insert("kinematic", frame=rel_f)
    t_b = time.time()
    baked_by = "ptcache.bake_all"
    try:
        bpy.ops.ptcache.bake_all(bake=True)
    except Exception as e:  # stepping the frames fills the cache too
        baked_by = f"frame stepping ({e})"
        for f in range(scene.frame_start, scene.frame_end + 1):
            scene.frame_set(f)
    t_bake = time.time() - t_b
    dg = bpy.context.evaluated_depsgraph_get()
    track_rows = []
    for f in range(scene.frame_start, scene.frame_end + 1):
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        row = {"frame": f}
        for aid in phys.get("active", []):
            mw = built[aid].evaluated_get(dg).matrix_world
            row[aid] = [list(map(float, r)) for r in mw]
        track_rows.append(row)
    digest = hashlib.sha256(json.dumps(track_rows).encode()).hexdigest()
    json.dump({"frames": track_rows, "sha256": digest}, open(os.path.join(out, "physics.json"), "w"))
    physics_info = {"bake_s": round(t_bake, 3), "baked_by": baked_by, "sha256": digest,
                    "frames": scene.frame_end, "is_baked": rbw.point_cache.is_baked}
    say(0.05, f"rigid body baked in {t_bake:.3f} s ({baked_by}), sha {digest[:12]}")
    if phys.get("bakeToKeyframes"):
        # bpy.ops.rigidbody.bake_to_keyframes fails in background mode (its keyframe_insert_by_name poll needs
        # a UI context), so freeze the sim by hand: key every frame from the recorded matrices, then take the
        # objects out of the rigid body world. The result renders the same, and survives any re-render.
        from mathutils import Matrix
        t_k = time.time()
        for aid in phys.get("active", []):
            ob = built[aid]
            scene.rigidbody_world.collection.objects.unlink(ob)
            prev = None
            for row in track_rows:
                M = Matrix(row[aid])
                loc, rot, _sc = M.decompose()
                e = rot.to_euler("XYZ", prev) if prev is not None else rot.to_euler("XYZ")
                prev = e
                ob.location, ob.rotation_euler = loc, e
                ob.keyframe_insert("location", frame=row["frame"])
                ob.keyframe_insert("rotation_euler", frame=row["frame"])
            for fc in _fcurves(ob):
                for kp in fc.keyframe_points:
                    kp.interpolation = "LINEAR"
        physics_info["bake_to_keyframes_s"] = round(time.time() - t_k, 3)
        physics_info["bake_to_keyframes"] = "manual (bpy.ops.rigidbody.bake_to_keyframes needs a UI context)"

# ------------------------------------------------------------------ passes (multilayer EXR)
passes = req.get("passes")
if passes:
    vl = scene.view_layers[0]
    vl.use_pass_z = passes.get("z", True)
    vl.use_pass_mist = passes.get("mist", False)
    vl.use_pass_normal = passes.get("normal", False)
    vl.use_pass_object_index = passes.get("objectIndex", False)
    vl.use_pass_cryptomatte_object = passes.get("cryptomatte", False)
    vl.pass_cryptomatte_depth = passes.get("cryptoDepth", 6)
    if engine == "cycles" and passes.get("shadowCatcher"):
        vl.cycles.use_pass_shadow_catcher = True

# ------------------------------------------------------------------ camera + object export for the 2D compositor
# Motion-engine camera: pixels, +y down, +z away from the viewer, `zoom` = distance (px) at which one
# px of a layer equals one px of the frame = lens / sensorWidth * compWidth (AE's formula).
PX_PER_M = req.get("pxPerMetre", 1000)
frames_out = []
objs2d = []
W, H = req["width"], req["height"]
for f in range(scene.frame_start, scene.frame_end + 1):
    scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    mw = cam.matrix_world
    loc = mw.to_translation()
    tgt = target.matrix_world.to_translation()
    to_px = lambda v: [v.x * PX_PER_M + W / 2, -v.z * PX_PER_M + H / 2, v.y * PX_PER_M]  # noqa: E731
    frames_out.append({
        "frame": f, "t": round((f - 1) / fps, 5),
        "position": [round(x, 3) for x in to_px(loc)],
        "pointOfInterest": [round(x, 3) for x in to_px(tgt)],
        "zoom": round(cd.lens / cd.sensor_width * W, 3),
        "lens_mm": cd.lens,
    })
    row = {"frame": f}
    for oid, ob in built.items():
        if floors.get(oid) or ob.type != "MESH" or oid.startswith(("floor", "cyc", "gobo")):
            continue
        p = world_to_camera_view(scene, cam, ob.evaluated_get(dg).matrix_world.translation)
        row[oid] = [round(p.x * W, 1), round((1 - p.y) * H, 1), round(p.z, 3)]  # px, px, metres to camera
    objs2d.append(row)
json.dump({"fps": fps, "width": W, "height": H, "pxPerMetre": PX_PER_M, "frames": frames_out},
          open(os.path.join(out, "camera.json"), "w"), indent=1)
json.dump({"fps": fps, "width": W, "height": H, "note": "projected object origins: [x px, y px (down), depth m]", "frames": objs2d},
          open(os.path.join(out, "objects2d.json"), "w"))


# ------------------------------------------------------------------ render the requested frames
def set_format(fmt):
    ims = scene.render.image_settings
    if fmt.get("format") == "exr-multilayer":
        ims.media_type = "MULTI_LAYER_IMAGE"
        ims.file_format = "OPEN_EXR_MULTILAYER"
        ims.color_depth = str(fmt.get("depth", "16"))
        ims.exr_codec = fmt.get("codec", "ZIP")
    else:
        ims.media_type = "IMAGE"
        ims.file_format = "PNG"
        ims.color_mode = "RGBA"
        ims.color_depth = "8"


frames = req.get("frames") or list(range(scene.frame_start, scene.frame_end + 1))
outputs = (passes or {}).get("outputs") or [{"format": "png"}]
timings, save_timings = [], []
t_all = time.time()
for i, f in enumerate(frames):
    scene.frame_set(f)
    t0 = time.time()
    if len(outputs) == 1 and outputs[0]["format"] == "png":
        scene.render.filepath = os.path.join(out, f"{f:05d}.png")
        bpy.ops.render.render(write_still=True)
        timings.append(round(time.time() - t0, 3))
    else:  # one render, several files: save the Render Result in each requested format
        bpy.ops.render.render(write_still=False)
        timings.append(round(time.time() - t0, 3))
        rr = bpy.data.images["Render Result"]
        for fmt in outputs:
            ts = time.time()
            set_format(fmt)
            ext = "exr" if fmt["format"].startswith("exr") else "png"
            path = os.path.join(out, f"{f:05d}{fmt.get('suffix', '')}.{ext}")
            rr.save_render(filepath=path, scene=scene)
            save_timings.append({"file": os.path.basename(path), "save_s": round(time.time() - ts, 3),
                                 "bytes": os.path.getsize(path) if os.path.exists(path) else None})
    say((i + 1) / len(frames), f"frame {f} in {timings[-1]} s")

steady = timings[1:]
json.dump({"ok": True, "engine": engine, "samples": req.get("samples"), "size": [W, H], "frames": frames,
           "seconds_per_frame": timings, "first_frame_s": timings[0] if timings else None,
           "steady_mean_s": round(sum(steady) / len(steady), 3) if steady else None,
           "build_s": round(t_build, 3), "physics": physics_info, "saves": save_timings,
           "render_total_s": round(time.time() - t_all, 2), "script_total_s": round(time.time() - T0, 2),
           "dir": out, "camera": "camera.json", "objects2d": "objects2d.json"},
          open(os.path.join(out, "result.json"), "w"), indent=1)
say(1.0, "done")
