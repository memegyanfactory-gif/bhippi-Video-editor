# wardrobe cut from the bound body using bone weights (+ plane cuts), then skinned by weight transfer
import bpy,bmesh,math
from mathutils import Vector
import garment as GA
def bone_frac(arm,bname,p):
    b=arm.data.bones[bname];h=b.head_local;t=b.tail_local;d=t-h;return (Vector(p)-h).dot(d)/d.length_squared
def face_bones(bm,dl,body):
    names={i:g.name for i,g in enumerate(body.vertex_groups)};F={}
    for f in bm.faces:
        acc={}
        for v in f.verts:
            for gi,w in v[dl].items():acc[names[gi]]=acc.get(names[gi],0)+w
        F[f.index]=max(acc,key=acc.get) if acc else None
    return F
def cut_by(body,arm,name,keep,off,mat,thick=.002,levels=1,planes=(),sole=None,smooth=(.6,6),relax=4,slot=None,gap=None,loose=None):
    bm=bmesh.new();bm.from_mesh(body.data);bm.normal_update();dl=bm.verts.layers.deform.active;bm.faces.ensure_lookup_table()
    FB=face_bones(bm,dl,body)
    kill=[f for f in bm.faces if not keep(f.calc_center_median(),FB[f.index])]
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    for co,no in planes:
        g=bm.verts[:]+bm.edges[:]+bm.faces[:];bmesh.ops.bisect_plane(bm,geom=g,plane_co=co,plane_no=no,clear_inner=True,dist=1e-5)
    if slot:
        x0,cond=slot
        for sx in(x0,-x0):
            g=bm.verts[:]+bm.edges[:]+bm.faces[:];bmesh.ops.bisect_plane(bm,geom=g,plane_co=Vector((sx,0,0)),plane_no=Vector((1,0,0)),dist=1e-5)
        kill=[f for f in bm.faces if abs(f.calc_center_median().x)<x0 and cond(f.calc_center_median())]
        bmesh.ops.delete(bm,geom=kill,context='FACES')
    if loose:
        # push fabric out to a minimum distance from each listed bone axis (straight legs, relaxed sleeves)
        names={i:g.name for i,g in enumerate(body.vertex_groups)}
        for v in bm.verts:
            best=None
            for gi,w in v[dl].items():
                bn=names[gi]
                for pre,rmin in loose.items():
                    if bn.startswith(pre) and w>.3:
                        bo=arm.data.bones[bn];h=bo.head_local;t=bo.tail_local;d=t-h;u=max(0,min(1,(v.co-h).dot(d)/d.length_squared))
                        c=h+d*u;r=(v.co-c);rl=r.length
                        rm=rmin(u) if callable(rmin) else rmin
                        if rl<rm and rl>1e-6:
                            k=min(1,w*1.4);v.co=c+r*(1+(rm/rl-1)*k)
    for _ in range(relax):
        bd=[v for v in bm.verts if v.is_boundary];new={}
        for v in bd:
            nb=[e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb)==2:new[v]=v.co*.4+(nb[0].co+nb[1].co)*.3
        for v,c in new.items():v.co=c
    bm.normal_update()
    for v in bm.verts:v.co+=v.normal*off
    me=bpy.data.meshes.new(name);bm.to_mesh(me);bm.free()
    ob=bpy.data.objects.new(name,me);bpy.context.scene.collection.objects.link(ob);me.materials.append(mat)
    if sole:
        me.materials.append(sole)
        for p in me.polygons:
            if p.center.z<.022:p.material_index=1
    if smooth:
        sm=ob.modifiers.new('drape','SMOOTH');sm.factor=smooth[0];sm.iterations=smooth[1]
        sw=ob.modifiers.new('fit','SHRINKWRAP');sw.target=body;sw.wrap_method='NEAREST_SURFACEPOINT';sw.wrap_mode='OUTSIDE';sw.offset=gap if gap is not None else off
        bpy.context.view_layer.objects.active=ob
        for mn in('drape','fit'):bpy.ops.object.modifier_apply(modifier=mn)
        declutter(ob,body,(gap if gap is not None else off),.045)
    so=ob.modifiers.new('sol','SOLIDIFY');so.thickness=thick;so.offset=-1;so.use_even_offset=False;so.use_rim=True
    sub=ob.modifiers.new('sub','SUBSURF');sub.levels=sub.render_levels=levels
    for p in me.polygons:p.use_smooth=True
    return ob
from mathutils.bvhtree import BVHTree
def declutter(ob,body,off,maxd):
    # any vertex flung away from the body goes back to the nearest surface point + offset
    bm=bmesh.new();bm.from_mesh(body.data);t=BVHTree.FromBMesh(bm);bm.free();n=0
    for v in ob.data.vertices:
        co,no,i,d=t.find_nearest(v.co)
        if co is not None and d>maxd:v.co=co+no*off;n+=1
    if n:print('declutter',ob.name,n)
TORSO={'hips','spine','chest','neck','shoulderL','shoulderR'}
def build(body,arm,g,M):
    crotch=.80 if g=='m' else .75;waist=.95 if g=='m' else .9
    out={}
    def top(sleeve,neckz):
        def k(c,b):
            if b is None:return False
            if b in TORSO or (b.startswith('thigh') and c.z>crotch+.04):return c.z>crotch+.05 and c.z<neckz+.06
            if b.startswith('upperarm'):return bone_frac(arm,b,c)<sleeve*2
            if b.startswith('forearm'):return sleeve>.5 and bone_frac(arm,b,c)<(sleeve-.5)*2
            return False
        return k
    neckz=arm.data.bones['neck'].head_local.z+.01
    wz=crotch+.06
    down=Vector((0,0,-1));up=Vector((0,0,1))
    NL=lambda d:(Vector((0,0,neckz-.012+d)),Vector((0,.4,-1)).normalized())
    out['tshirt']=cut_by(body,arm,'W_tshirt',top(.28,neckz),.011,M['top'],smooth=(.85,14),gap=.008,loose={'upperarm':.058},planes=[(Vector((0,0,wz)),up),NL(0)])
    out['longsleeve']=cut_by(body,arm,'W_longsleeve',top(.96,neckz),.008,M['top'],smooth=(.7,8),planes=[(Vector((0,0,wz)),up),NL(0)])
    out['hoodie']=cut_by(body,arm,'W_hoodie',top(.98,neckz+.02),.016,M['outer'],.003,smooth=(.8,12),planes=[(Vector((0,0,wz-.02)),up),NL(.02)])
    jk=top(.98,neckz+.02)
    out['jacket']=cut_by(body,arm,'W_jacket',jk,.02,M['outer'],.004,smooth=(.8,12),planes=[(Vector((0,0,wz-.03)),up),NL(.03)],slot=(.04,lambda c:c.y<-.02 and c.z>crotch))
    LEG=('thigh','shin','hips')
    def pants(frac):
        def k(c,b):
            if b is None:return False
            if b=='hips' or b=='spine':return c.z<waist
            if b.startswith('thigh'):return True
            if b.startswith('shin'):return bone_frac(arm,b,c)<frac
            return False
        return k
    out['jeans']=cut_by(body,arm,'W_jeans',pants(.93),.012,M['bottom'],smooth=(.9,16),gap=.01,loose={'thigh':lambda u:.085-.02*u,'shin':lambda u:.066},planes=[(Vector((0,0,waist)),down)])
    def shorts(c,b):
        if b is None:return False
        if b in('hips','spine'):return c.z<waist
        if b.startswith('thigh'):return bone_frac(arm,b,c)<.5
        return False
    out['shorts']=cut_by(body,arm,'W_shorts',shorts,.013,M['bottom'],smooth=(.8,12),loose={'thigh':lambda u:.09},planes=[(Vector((0,0,waist)),down)])
    out['sneakers']=sneakers(body,arm,M['shoe'],M['sole'])
    out['skirt']=skirt(body,arm,g,M['bottom'],waist,crotch)
    return out
def skirt(body,arm,g,mat,waist,crotch):
    # lathe: fit the waist cross-section, flare to just above the knee
    knee=arm.data.bones['shinL'].head_local.z+.06
    P=[v.co for v in body.data.vertices]
    def ring(z):
        b=[p for p in P if abs(p.z-z)<.01 and abs(p.x)<.25]
        cy=sum(p.y for p in b)/len(b);rx=max(abs(p.x) for p in b);ry=(max(p.y for p in b)-min(p.y for p in b))/2;return cy,rx,ry
    cy,rx,ry=ring(waist-.01);hy,hx,hr=ring(crotch+.05)
    bm=bmesh.new();N=48;rows=[]
    prof=[(waist,1.0,rx+.008,ry+.008),(crotch+.05,1.0,hx+.012,hr+.012),(knee,1.0,hx*1.22+.03,hr*1.25+.03)]
    for i,(z,_,ax,ay) in enumerate(prof):
        rows.append([bm.verts.new((ax*math.sin(k/N*2*math.pi),cy+ay*-math.cos(k/N*2*math.pi),z)) for k in range(N)])
    for i in range(len(rows)-1):
        for k in range(N):bm.faces.new((rows[i][k],rows[i][(k+1)%N],rows[i+1][(k+1)%N],rows[i+1][k]))
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
    me=bpy.data.meshes.new('W_skirt');bm.to_mesh(me);bm.free();ob=bpy.data.objects.new('W_skirt',me);bpy.context.scene.collection.objects.link(ob);me.materials.append(mat)
    so=ob.modifiers.new('sol','SOLIDIFY');so.thickness=.004;sub=ob.modifiers.new('sub','SUBSURF');sub.levels=sub.render_levels=2
    for p in me.polygons:p.use_smooth=True
    return ob

def sneakers(body,arm,mat,sole):
    """cartoon sneaker: convex hull around each foot (toes bridged), collar cut, white sole band"""
    obs=[]
    names={i:g.name for i,g in enumerate(body.vertex_groups)}
    for n in 'LR':
        pts=[]
        for v in body.data.vertices:
            if v.co.z>.13:continue
            w={names[g.group]:g.weight for g in v.groups}
            if w.get('foot'+n,0)+w.get('toe'+n,0)+w.get('shin'+n,0)*(v.co.z<.12)>.4:pts.append(v.co.copy())
        cx=sum(p.x for p in pts)/len(pts);cy=sum(p.y for p in pts)/len(pts)
        bm=bmesh.new()
        for p in pts:
            d=Vector((p.x-cx,p.y-cy,0));d=d.normalized() if d.length>1e-6 else d
            q=p+d*.012+Vector((0,0,.006 if p.z>.03 else 0));q.z=max(q.z,-.0)
            bm.verts.new(q)
        bmesh.ops.convex_hull(bm,input=bm.verts[:])
        me=bpy.data.meshes.new('shoe'+n);bm.to_mesh(me);bm.free()
        ob=bpy.data.objects.new('W_sneakers_'+n,me);bpy.context.scene.collection.objects.link(ob)
        me.materials.append(mat);me.materials.append(sole)
        rm=ob.modifiers.new('rm','REMESH');rm.mode='SMOOTH';rm.octree_depth=5;rm.use_smooth_shade=True
        bpy.context.view_layer.objects.active=ob;bpy.ops.object.modifier_apply(modifier='rm')
        # collar: remove the top above the ankle, relax the rim
        bm=bmesh.new();bm.from_mesh(ob.data)
        g=bm.verts[:]+bm.edges[:]+bm.faces[:];bmesh.ops.bisect_plane(bm,geom=g,plane_co=Vector((0,0,.105)),plane_no=Vector((0,.35,1)).normalized(),clear_outer=True,dist=1e-5)
        for f in bm.faces:f.material_index=1 if f.calc_center_median().z<.024 else 0
        bm.to_mesh(ob.data);bm.free()
        so=ob.modifiers.new('sol','SOLIDIFY');so.thickness=.004;so.offset=-1
        sub=ob.modifiers.new('sub','SUBSURF');sub.levels=sub.render_levels=1
        for p in ob.data.polygons:p.use_smooth=True
        obs.append(ob)
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs:o.select_set(True)
    bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();obs[0].name='W_sneakers'
    return obs[0]
