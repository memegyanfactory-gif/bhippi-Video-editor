# garments cut from the body surface with clean plane cuts, lifted along normals, given thickness
import bpy,bmesh
from mathutils import Vector
def cut(body,name,planes,off,mat,thick=.002,levels=2,box=None):
    """planes: list of (point, normal); keep the side the normal points to"""
    bm=bmesh.new();bm.from_mesh(body.data);bm.normal_update()
    if box:
        kill=[f for f in bm.faces if not box(f.calc_center_median())];bmesh.ops.delete(bm,geom=kill,context='FACES')
    for co,no in planes:
        g=bm.verts[:]+bm.edges[:]+bm.faces[:];bmesh.ops.bisect_plane(bm,geom=g,plane_co=co,plane_no=no,clear_inner=True,dist=1e-5)
    bm.normal_update()
    for v in bm.verts:v.co+=v.normal*off
    me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free();ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat)
    so=ob.modifiers.new('sol','SOLIDIFY');so.thickness=thick;so.offset=-1;so.use_even_offset=True
    sub=ob.modifiers.new('sub','SUBSURF');sub.levels=sub.render_levels=levels
    for p in ob.data.polygons:p.use_smooth=True
    return ob
def legplane(s,crotch,lift=0.):
    # keeps the side above the leg opening of side s (+1 left, -1 right); front sits higher than back
    return (Vector((s*.022,0,crotch-.01+lift)),Vector((-.62*s,.28,1)).normalized())
def underwear(body,g,mats):
    crotch=.80 if g=='m' else .76;waist=.935 if g=='m' else .885
    torso=lambda c:abs(c.x)<.2 and c.z>crotch-.12 and c.z<waist+.1
    up=Vector((0,0,1));dn=Vector((0,0,-1))
    P=[legplane(1,crotch),legplane(-1,crotch),(Vector((0,0,waist)),dn)]
    out=[cut(body,'Briefs',P,.0026,mats['briefs'],box=torso)]
    out.append(cut(body,'BriefsTrim',[(Vector((0,0,waist+.001)),dn),(Vector((0,0,waist-.012)),up)],.0042,mats['trim'],.003,box=torso))
    for s in(1,-1):
        a=legplane(s,crotch);b=legplane(s,crotch,.011)
        out.append(cut(body,f'BriefsLeg{s}',[a,(b[0],-b[1]),(Vector((0,0,waist)),dn)],.004,mats['trim'],.003,box=lambda c:torso(c) and c.x*s>-.01))
    if g=='f':
        lo,hi=1.115,1.25;box=lambda c:abs(c.x)<.2 and lo-.05<c.z<hi+.05
        sides=[(Vector((.135,0,0)),Vector((-1,0,0))),(Vector((-.135,0,0)),Vector((1,0,0)))]
        topP=[(Vector((0,0,lo)),up),(Vector((0,0,hi)),Vector((0,-.35,-1)).normalized())]+sides
        out.append(cut(body,'Top',topP,.003,mats['top'],box=box))
        out.append(cut(body,'TopTrim',[(Vector((0,0,lo-.001)),up),(Vector((0,0,lo+.011)),dn)]+sides,.0046,mats['trim'],.003,box=box))
    return out
