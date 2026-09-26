# sculpted clump hair: tapered bezier tubes laid over the scalp by a flow field, plus a scalp cap
import bpy,bmesh,math,random
from mathutils import Vector
from mathutils.bvhtree import BVHTree
def bvh_of(ob):
    bm=bmesh.new();bm.from_mesh(ob.data);bm.transform(ob.matrix_world);t=BVHTree.FromBMesh(bm);bm.free();return t
class Scalp:
    def __init__(s,ob,center):s.t=bvh_of(ob);s.c=Vector(center)
    def dir(s,az,el):return Vector((math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
    def at(s,az,el,off=0.):
        d=s.dir(az,el);hit=s.t.ray_cast(s.c+d*.4,-d)
        if hit[0] is None:return s.c+d*.1,d
        p,n=hit[0],hit[1];return p+n*off,n
def taper_curve(name,shape):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='2D';sp=cu.splines.new('POLY');sp.points.add(len(shape)-1)
    for i,(x,y) in enumerate(shape):sp.points[i].co=(x,y,0,1)
    ob=bpy.data.objects.new(name,cu);bpy.context.scene.collection.objects.link(ob);ob.hide_render=True;ob.hide_viewport=True;return ob
LOD={'u':10,'b':4}
def clump(name,pts,radius,taper,mat,res=None,flat=1.,tilt=0.):
    cu=bpy.data.curves.new(name,'CURVE');cu.dimensions='3D';cu.resolution_u=LOD['u'];cu.bevel_depth=radius;cu.bevel_resolution=min(res or LOD['b'],LOD['b'])
    cu.taper_object=taper;cu.use_fill_caps=True;sp=cu.splines.new('BEZIER');sp.bezier_points.add(len(pts)-1)
    for i,p in enumerate(pts):
        b=sp.bezier_points[i];b.co=p;b.handle_left_type=b.handle_right_type='AUTO';b.tilt=tilt
    ob=bpy.data.objects.new(name,cu);bpy.context.scene.collection.objects.link(ob);ob.data.materials.append(mat)
    if flat!=1.:
        ob.data.bevel_mode='OBJECT'
    return ob
def path_over(S,a0,e0,a1,e1,n=6,off0=.002,offm=.012,off1=.006,lift=None,jit=0,rnd=None):
    pts=[]
    for i in range(n):
        t=i/(n-1);az=a0+(a1-a0)*t;el=e0+(e1-e0)*t
        if jit and rnd:az+=rnd.uniform(-jit,jit)*t;el+=rnd.uniform(-jit,jit)*t
        off=off0*(1-t)**2+offm*2*t*(1-t)+off1*t*t
        p,nrm=S.at(az,el,off)
        if lift and i==n-1:p=p+Vector(lift)
        pts.append(p)
    return pts
def cap(body,S,hairline,mat,thick=.004,name='HairCap'):
    # copy faces whose centre is above the hairline(az) and inflate them
    me=body.data;bm=bmesh.new();bm.from_mesh(me);bm.transform(body.matrix_world)
    kill=[]
    for f in bm.faces:
        c=f.calc_center_median();d=(c-S.c)
        if d.length<1e-6:kill.append(f);continue
        az=math.atan2(d.x,-d.y);el=math.asin(max(-1,min(1,d.z/d.length)))
        if el<hairline(az) or d.length>.2:kill.append(f)
    bmesh.ops.delete(bm,geom=kill,context='FACES')
    for v in bm.verts:v.co+=v.normal*thick
    m2=bpy.data.meshes.new(name);bm.to_mesh(m2);bm.free();ob=bpy.data.objects.new(name,m2);bpy.context.scene.collection.objects.link(ob)
    ob.data.materials.append(mat);so=ob.modifiers.new('sol','SOLIDIFY');so.thickness=.003;so.offset=-1
    sub=ob.modifiers.new('sub','SUBSURF');sub.levels=sub.render_levels=LOD.get('cap',2)
    for p in ob.data.polygons:p.use_smooth=True
    return ob
def join(objs,name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True);bpy.context.view_layer.objects.active=o
        if o.type=='CURVE':bpy.ops.object.convert(target='MESH')
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:o.select_set(True)
    bpy.context.view_layer.objects.active=objs[0];bpy.ops.object.join();objs[0].name=name
    for p in objs[0].data.polygons:p.use_smooth=True
    return objs[0]
D=math.pi/180
def style_messy(body,center,mat,seed=3):
    """short messy cut like the reference: crown whorl, clumps sweeping forward and up, short sides and back"""
    rnd=random.Random(seed);S=Scalp(body,center)
    hl=lambda az:(8*D if abs(az)<60*D else -2*D) if abs(az)<120*D else -35*D
    def hairline(az):
        a=abs(az)
        if a<50*D:return 22*D
        if a<100*D:return 22*D-(a-50*D)/(50*D)*28*D
        return -6*D-(a-100*D)/(80*D)*32*D
    capo=cap(body,S,hairline,mat,.0035)
    tp=taper_curve('tp_clump',[(0,.55),(.15,1),(.5,.85),(.8,.5),(1,0)])
    C=[]
    # top: from crown (back-top) sweeping forward, tips falling over the forehead and flicking out
    for i in range(20):
        a=(-58+i*116/19)*D+rnd.uniform(-4,4)*D
        pts=path_over(S,a*.75,(62+rnd.uniform(0,8))*D,a*1.08,(2+rnd.uniform(-3,6))*D,n=6,off0=.003,offm=.022,off1=.013,lift=(rnd.uniform(-.008,.008),-.012,.004+rnd.uniform(0,.01)),jit=5*D,rnd=rnd)
        C.append(clump(f'top{i}',pts,.012+rnd.uniform(0,.005),tp,mat))
    for i in range(7):
        a=(-36+i*12)*D;pts=path_over(S,a*.8+180*D*0,82*D,a,52*D,n=4,off0=.004,offm=.016,off1=.016,lift=(0,-.006,.008));C.append(clump(f'vol{i}',pts,.016,tp,mat))
    # back-of-crown clumps flowing forward into the top layer
    for i in range(9):
        a=(140+i*10)*D;pts=path_over(S,a,38*D,a+(180*D-a)*.2,66*D,n=5,off0=.003,offm=.013,off1=.014,jit=3*D,rnd=rnd)
        C.append(clump(f'crown{i}',pts,.015,tp,mat))
    # sides: short, combed down and back
    for sd in(-1,1):
        for k in range(5):
            a=sd*(62+k*14)*D;pts=path_over(S,a,40*D,a+sd*12*D,(10-k*4)*D,n=4,off0=.003,offm=.008,off1=.005)
            C.append(clump(f'side{sd}{k}',pts,.011,tp,mat))
    # back
    for k in range(9):
        a=(135+k*11.25)*D;pts=path_over(S,a,40*D,a,(-22-rnd.uniform(0,6))*D,n=5,off0=.003,offm=.009,off1=.004)
        C.append(clump(f'back{k}',pts,.012,tp,mat))
    # a few flyaway strands
    for k in range(5):
        a=rnd.uniform(-40,40)*D;pts=path_over(S,a,60*D,a+rnd.uniform(-20,20)*D,40*D,n=4,off0=.008,offm=.02,off1=.03,lift=(0,0,.015))
        C.append(clump(f'fly{k}',pts,.0035,tp,mat))
    return join([capo]+C,'Hair')
def brows(body,center,mat,eyes,thick=1.,arch=.004):
    S=Scalp(body,center);tp=taper_curve('tp_brow',[(0,.7),(.25,1),(.7,.8),(1,.15)]);C=[]
    for e in eyes:
        sd=1 if e.x>0 else -1;ex=e.x
        pts=[]
        for t in(0,.33,.66,1):
            x=ex-sd*.022+sd*t*.05
            d=Vector((x,-.3,e.z+.03+arch*math.sin(t*math.pi)-t*.004))
            hit=S.t.ray_cast(d,Vector((0,1,0)))
            pts.append(hit[0]+Vector((0,-.003,0)) if hit[0] else d)
        C.append(clump(f'brow{sd}',pts,.0065*thick,tp,mat,res=3))
    return join(C,'Brows')

def fall_path(S,a,e0,e1,drop,n_scalp=4,n_fall=5,out=.012,rnd=None,sway=0.):
    """scalp segment from (a,e0) to (a,e1), then hangs down `drop` metres, kept outside the head/neck radius"""
    pts=path_over(S,a,e0,a,e1,n=n_scalp,off0=.003,offm=.012,off1=.01)
    p=pts[-1];h=Vector((p.x-S.c.x,p.y-S.c.y,0));r=max(h.length,.001);h.normalize()
    for k in range(1,n_fall+1):
        t=k/n_fall;rr=r+out*math.sin(t*math.pi*.5)+sway*t
        q=Vector((S.c.x+h.x*rr,S.c.y+h.y*rr,p.z-drop*t))
        if rnd:q+=Vector((rnd.uniform(-.004,.004),rnd.uniform(-.004,.004),0))
        pts.append(q)
    return pts
def style_long(body,center,mat,seed=5,length=.34,part=22*D):
    rnd=random.Random(seed);S=Scalp(body,center)
    def hairline(az):
        a=abs(az)
        if a<50*D:return 26*D
        if a<100*D:return 26*D-(a-50*D)/(50*D)*30*D
        return -4*D-(a-100*D)/(80*D)*30*D
    capo=cap(body,S,hairline,mat,.004)
    tp=taper_curve('tp_long',[(0,.8),(.1,1),(.6,.95),(.9,.7),(1,.35)]);tb=taper_curve('tp_bang',[(0,.7),(.2,1),(.7,.75),(1,.1)])
    C=[]
    # sweep from the side part down both sides of the head
    for i in range(24):
        side=1 if i%2 else -1;k=i//2;a_end=side*(52+k*9.5)*D
        e_end=(12-k*2.2)*D
        pts=path_over(S,part,78*D-k*1.5*D,a_end,e_end,n=5,off0=.004,offm=.02,off1=.014,jit=2*D,rnd=rnd)
        # continue falling
        p=pts[-1];h=Vector((p.x-S.c.x,p.y-S.c.y,0));r=h.length;h.normalize()
        for j in range(1,5):
            t=j/4;q=Vector((S.c.x+h.x*(r+.01*t),S.c.y+h.y*(r+.01*t)+.02*t,p.z-length*t*(1-.35*(abs(a_end)<60*D))))
            pts.append(q)
        C.append(clump(f'sweep{i}',pts,.027+rnd.uniform(0,.005),tp,mat))
    # back curtain
    for k in range(16):
        a=(112+k*9)*D;pts=fall_path(S,a,70*D,-20*D,length*.85,out=.01,rnd=rnd)
        C.append(clump(f'back{k}',pts,.026,tp,mat))
    # side-swept bangs over the forehead
    for k in range(5):
        a0=part-.02+k*.05;a1=(-62+k*6)*D;pts=path_over(S,a0,74*D,a1,(22-k*2)*D,n=6,off0=.005,offm=.02,off1=.012,lift=(-.004,-.006,-.006))
        C.append(clump(f'bang{k}',pts,.017,tb,mat))
    return join([capo]+C,'Hair')
