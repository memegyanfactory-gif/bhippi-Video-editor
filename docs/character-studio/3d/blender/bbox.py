import bpy
from mathutils import Vector
dg=bpy.context.evaluated_depsgraph_get()
for o in bpy.data.objects:
    if o.type!='MESH' or o.hide_render:continue
    ev=o.evaluated_get(dg);me=ev.to_mesh();M=o.matrix_world
    xs=[(M@v.co) for v in me.vertices]
    if xs:
        mn=Vector((min(v.x for v in xs),min(v.y for v in xs),min(v.z for v in xs)));mx=Vector((max(v.x for v in xs),max(v.y for v in xs),max(v.z for v in xs)))
        if mx.x>1.2 or mn.x<-1.3 or mx.z>2.2:print('SUSPECT',o.name,tuple(round(a,2) for a in mn),tuple(round(a,2) for a in mx),[m.type for m in o.modifiers],len(o.vertex_groups))
    ev.to_mesh_clear()
