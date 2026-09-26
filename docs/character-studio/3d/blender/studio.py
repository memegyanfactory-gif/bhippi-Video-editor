# shared studio: lights, backdrop, camera helpers
import bpy, math
from mathutils import Vector
def hexc(h,a=1):
    h=h.lstrip('#');c=[int(h[i:i+2],16)/255 for i in (0,2,4)];c=[x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c];return (*c,a)
def mat(name,col,rough=.5,sss=0,spec=.5):
    m=bpy.data.materials.new(name);m.use_nodes=True;b=m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value=hexc(col);b.inputs['Roughness'].default_value=rough
    if sss:b.inputs['Subsurface Weight'].default_value=sss;b.inputs['Subsurface Radius'].default_value=(1,.4,.25);b.inputs['Subsurface Scale'].default_value=.012
    return m
def setup(samples=48,bg='#8d949b'):
    sc=bpy.context.scene
    w=bpy.data.worlds.new('w');sc.world=w;w.use_nodes=True;w.node_tree.nodes['Background'].inputs[0].default_value=hexc(bg);w.node_tree.nodes['Background'].inputs[1].default_value=1.0
    def light(name,loc,energy,size,col='#ffffff'):
        L=bpy.data.lights.new(name,'AREA');L.energy=energy;L.size=size;L.color=hexc(col)[:3]
        o=bpy.data.objects.new(name,L);sc.collection.objects.link(o);o.location=loc
        o.rotation_euler=(Vector((0,0,1.1))-Vector(loc)).to_track_quat('-Z','Y').to_euler();return o
    light('key',(-2.4,-3.4,3.0),520,2.4,'#fff3e6');light('fill',(2.8,-2.6,1.5),170,3.2,'#e6eeff');light('rim',(1.4,3.4,2.8),420,1.8)
    import bmesh
    bm=bmesh.new();prof=[(y,0.) for y in (-8,-4,-1,0.5)]+[(1.5+1.6*math.sin(a/8*math.pi/2)-1.6+1.6-1.6*math.cos(a/8*math.pi/2)*0,0) for a in []]
    prof=[(-8,0),(-2,0),(0.6,0)]+[(0.6+1.8*math.sin(k/10*math.pi/2),1.8-1.8*math.cos(k/10*math.pi/2)) for k in range(1,11)]+[(2.4,6)]
    rows=[]
    for x in (-10,10):rows.append([bm.verts.new((x,y,z)) for y,z in prof])
    for i in range(len(prof)-1):bm.faces.new((rows[0][i],rows[1][i],rows[1][i+1],rows[0][i+1]))
    me=bpy.data.meshes.new('cyc');bm.to_mesh(me);fl=bpy.data.objects.new('floor',me);sc.collection.objects.link(fl)
    for p in me.polygons:p.use_smooth=True
    fl.data.materials.append(mat('floor','#8f969d',.9))
    sc.render.engine='CYCLES';sc.render.film_transparent=False;sc.cycles.samples=samples;sc.cycles.use_denoising=True;sc.cycles.device='CPU'
    sc.view_settings.view_transform='AgX';sc.view_settings.look='AgX - Medium High Contrast'
    cam=bpy.data.cameras.new('cam');co=bpy.data.objects.new('cam',cam);sc.collection.objects.link(co);sc.camera=co;return co
def shot(fn,target,dist,az,el,lens,resx,resy):
    sc=bpy.context.scene;co=sc.camera;tx=Vector(target);d=Vector((math.sin(az)*math.cos(el),-math.cos(az)*math.cos(el),math.sin(el)))
    co.location=tx+d*dist;co.rotation_euler=(tx-co.location).to_track_quat('-Z','Y').to_euler();co.data.lens=lens
    sc.render.resolution_x=resx;sc.render.resolution_y=resy;sc.render.filepath=fn;bpy.ops.render.render(write_still=True)
