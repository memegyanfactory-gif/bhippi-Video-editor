import bpy,sys,math,json,importlib
sys.path.insert(0,__import__('os').path.dirname(__import__('os').path.abspath(__file__)))
import studio,brush,numpy as np
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];out=args[0];views=args[1].split(',') if len(args)>1 else ['head']
VIEWOPT=dict(a.split('=',1) for a in args[3:] if '=' in a)
keep={'GEO-body_male_stylized','GEO-body_female_stylized'}
for o in list(bpy.data.objects):
    if o.name not in keep and not (o.parent and o.parent.name in keep and 'eye' in o.name):bpy.data.objects.remove(o,do_unlink=True)
for s in list(bpy.data.scenes)[1:]:bpy.data.scenes.remove(s)
sc=bpy.context.scene
for o in bpy.data.objects:
    if o.name not in sc.collection.all_objects:sc.collection.objects.link(o)
BODY={}
for n,g in [('GEO-body_male_stylized','m'),('GEO-body_female_stylized','f')]:
    o=bpy.data.objects[n];cx=sum((o.matrix_world@v.co).x for v in o.data.vertices)/len(o.data.vertices)
    eyes=[c for c in o.children]
    for e in eyes:
        mw=e.matrix_world.copy();e.parent=None;e.matrix_world=mw
    for c in [o]+eyes:c.location.x-=cx
    bpy.context.view_layer.update()
    for c in [o]+eyes:
        mw=c.matrix_world.copy();c.data.transform(mw);c.matrix_world=np.identity(4).tolist() and __import__('mathutils').Matrix.Identity(4)
    from mathutils import Matrix
    for e in eyes:
        if e.dimensions.x>0:
            xs=[v.co.copy() for v in e.data.vertices];c0=Vector(((min(v.x for v in xs)+max(v.x for v in xs))/2,(min(v.y for v in xs)+max(v.y for v in xs))/2,(min(v.z for v in xs)+max(v.z for v in xs))/2))
            far=sorted(xs,key=lambda v:-(v-c0).length)[:12];ad=sum(((v-c0) for v in far),Vector()).normalized()
            print('EYE',g,tuple(round(x,4) for x in c0),'apex',tuple(round(x,3) for x in ad))
            e.data.transform(Matrix.Translation(-c0));e.data.transform(ad.rotation_difference(Vector((0,-1,0))).to_matrix().to_4x4());e.location=c0
    BODY[g]={'o':o,'eyes':sorted([e for e in eyes if e.dimensions.x>0],key=lambda e:e.location.x)}
import stylize;importlib.reload(stylize)
for g,B in BODY.items():
    o=B['o'];n=len(o.data.vertices);S=brush.Sculpt([v.co[:] for v in o.data.vertices]+[e.location[:] for e in B['eyes']],[list(p.vertices) for p in o.data.polygons])
    info=stylize.run(g,S,B)
    for v,p in zip(o.data.vertices,S.V[:n]):v.co=p
    for e,p in zip(B['eyes'],S.V[n:]):print('EYEPOS',g,e.location[:],'->',p);e.location=Vector(p)
    o.data.update()
skin=studio.mat('skin','#e9ae88',.42,.25)
def eyemat(iris):
    m=bpy.data.materials.new('eye');m.use_nodes=True;nt=m.node_tree;b=nt.nodes['Principled BSDF'];b.inputs['Roughness'].default_value=.04;b.inputs['Coat Weight'].default_value=.6
    tc=nt.nodes.new('ShaderNodeTexCoord');sep=nt.nodes.new('ShaderNodeSeparateXYZ');nt.links.new(tc.outputs['Object'],sep.inputs[0])
    xy=nt.nodes.new('ShaderNodeCombineXYZ');nt.links.new(sep.outputs['X'],xy.inputs['X']);nt.links.new(sep.outputs['Z'],xy.inputs['Y'])
    ln=nt.nodes.new('ShaderNodeVectorMath');ln.operation='LENGTH';nt.links.new(xy.outputs[0],ln.inputs[0])
    front=nt.nodes.new('ShaderNodeMath');front.operation='LESS_THAN';nt.links.new(sep.outputs['Y'],front.inputs[0]);front.inputs[1].default_value=0
    mx=nt.nodes.new('ShaderNodeMath');mx.operation='MAXIMUM';nt.links.new(ln.outputs['Value'],mx.inputs[0])
    inv=nt.nodes.new('ShaderNodeMath');inv.operation='MULTIPLY_ADD';nt.links.new(front.outputs[0],inv.inputs[0]);inv.inputs[1].default_value=-10;inv.inputs[2].default_value=10;nt.links.new(inv.outputs[0],mx.inputs[1])
    ramp=nt.nodes.new('ShaderNodeValToRGB');cr=ramp.color_ramp
    return m,nt,mx,ramp,b
for g,B in BODY.items():
    o=B['o'];o.data.materials.clear();o.data.materials.append(skin)
    s=o.modifiers.new('sub','SUBSURF');s.levels=s.render_levels=2
    for p in o.data.polygons:p.use_smooth=True
    import eyes as EY;importlib.reload(EY)
    img=EY.iris_image('iris_'+g,'#5a86b5' if g=='m' else '#4f8a6a')
    for e in B['eyes']:
        EY.setup_eye(e,img)
        for p in e.data.polygons:p.use_smooth=True
import hair;importlib.reload(hair)
if 'export' in views:hair.LOD.update(u=5,b=2,cap=1)
hairmat=studio.mat('hair','#2e1f18',.38);hairmat2=studio.mat('hair2','#5a3322',.38)
for g,B in BODY.items():
    e=[x.location.copy() for x in B['eyes']];ey=sum(v.y for v in e)/2;ez=sum(v.z for v in e)/2
    B['hc']=(0,ey+.08,ez+.035)
    B['extra']=[]
    B['extra'].append(hair.style_messy(B['o'],B['hc'],hairmat) if g=='m' else hair.style_long(B['o'],B['hc'],hairmat2))
    import garment;importlib.reload(garment)
    B['extra']+=garment.underwear(B['o'],g,{'briefs':studio.mat('briefs','#cfdbe8' if g=='m' else '#efe4ea',.75),'trim':studio.mat('trim','#2c68c8' if g=='m' else '#c9577f',.6),'top':studio.mat('top','#efe4ea',.75)})
    B['extra'].append(hair.brows(B['o'],B['hc'],hairmat,e,1.25 if g=='m' else .8))
import rig;importlib.reload(rig)
DO_RIG=True
for g,B in BODY.items():
    if not DO_RIG:continue
    J=rig.find_joints(B['o'],g);B['J']=J
    arm=rig.build_armature(J,'RIG_'+g);B['arm']=arm
    heady=[x for x in B['extra'] if x.name.startswith(('Hair','Brows'))]+B['eyes']
    cloth=[x for x in B['extra'] if x not in heady]
    import wardrobe as WR;importlib.reload(WR)
    rig.bind(B['o'],arm,rigid=[],transfer=[])
    WM={'top':studio.mat('w_top','#e8e4dc',.7),'outer':studio.mat('w_outer','#c9533f',.6),'bottom':studio.mat('w_bottom','#3b5a8c',.8),'shoe':studio.mat('w_shoe','#e2554a',.5),'sole':studio.mat('w_sole','#f4f1ea',.6)}
    B['ward']=WR.build(B['o'],arm,g,WM)
    rig.bind_extra(B['o'],arm,rigid=heady,transfer=cloth+list(B['ward'].values()))
    WR.cover_mask(B['o'],B['ward'])
    show=set((VIEWOPT.get('wear_'+g) or '').split('+'))
    for k,o in B['ward'].items():o.hide_render=k not in show;o.hide_viewport=k not in show
    # armature deform before subdivision
    o=B['o'];i=[m.name for m in o.modifiers].index('Armature') if 'Armature' in [m.name for m in o.modifiers] else None
    if i:bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_move_to_index(modifier='Armature',index=0)
    print('RIG',g,{k:tuple(round(float(x),3) for x in v) for k,v in J.items() if not k[-1] in 'R'})
    if 'pose' in views:
        import math
        pb=arm.pose.bones
        def rot(b,x=0,y=0,z=0):pb[b].rotation_mode='XYZ';pb[b].rotation_euler=(math.radians(x),math.radians(y),math.radians(z))
        rot('upperarmL',0,0,55);rot('forearmL',-70,0,0);rot('upperarmR',-40,0,-10);rot('forearmR',-35,0,0)
        rot('thighL',-35,0,0);rot('shinL',60,0,0);rot('head',10,25,0);rot('spine',8,0,0)
        for f in['index','middle','ring','pinky']:
            for j in(1,2,3):rot(f+str(j)+'R',-55,0,0)
        rot('thumb2R',-30,0,0)
for g,B in BODY.items():
    for c in [B['o']]+B['eyes']+B['extra']+([B['arm']] if 'arm' in B else []):
        if c.parent is None:c.location.x+=(-.55 if g=='m' else .55)
studio.setup(int(args[2]) if len(args)>2 else 32)
hm=max(v.co.z for v in BODY['m']['o'].data.vertices);hf=max(v.co.z for v in BODY['f']['o'].data.vertices)
for v in views:
    if v=='head':
        for i,az in enumerate([0,-.6,-1.5708]):studio.shot(f'{out}_hm{i}.png',(-.55,0,hm-.15),1.25,az,.02,85,520,620)
        for i,az in enumerate([0,-.6,-1.5708]):studio.shot(f'{out}_hf{i}.png',(.55,0,hf-.14),1.2,az,.02,85,520,620)
    if v=='pose':
        studio.shot(f'{out}_pose.png',(0,0,.9),7.0,-.3,.06,62,1500,1100)
        studio.shot(f'{out}_poseh.png',(-.75,0,.95),2.2,-.6,.1,70,900,900)
    if v=='hero':
        studio.shot(f'{out}_hero.png',(0,0,.88),7.0,-.28,.06,62,1500,1100)
        studio.shot(f'{out}_face_m.png',(-.55,-.02,hm-.16),1.05,-.35,.03,85,800,900)
        studio.shot(f'{out}_face_f.png',(.55,-.02,hf-.15),1.0,.35,.03,85,800,900)
    if v=='body':
        for i,az in enumerate([0,-.6,-1.5708,math.pi]):studio.shot(f'{out}_b{i}.png',(0,0,.86),7.2,az,.03,75,700,900)
if 'export' in views:
    import os
    for g,B in BODY.items():
        arm=B['arm']
        for pb in arm.pose.bones:pb.rotation_mode='QUATERNION';pb.rotation_quaternion=(1,0,0,0);pb.location=(0,0,0)
        # back to the origin for export
        dx=arm.location.x;arm.location.x=0
        objs=[arm]+[c for c in arm.children]
        for o in objs:o.hide_render=False;o.hide_viewport=False;o.hide_set(False)
        for o in objs:
            for m in o.modifiers:
                if m.type=='SUBSURF':m.levels=0;m.render_levels=0 if o.name.startswith('GEO-body') else 1
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:o.select_set(True)
        bpy.context.view_layer.objects.active=arm
        tris=0
        dg=bpy.context.evaluated_depsgraph_get()
        for o in objs:
            if o.type=='MESH':
                ev=o.evaluated_get(dg);me=ev.to_mesh();t=sum(len(p.vertices)-2 for p in me.polygons);ev.to_mesh_clear();print('TRIS',g,o.name,t);tris+=t
        print('TRIS total',g,tris)
        fn=os.path.abspath(f'{out}_{g}.glb')
        bpy.ops.export_scene.gltf(filepath=fn,export_format='GLB',use_selection=True,export_apply=True,export_skins=True,export_animations=False,export_yup=True,export_texcoords=True,export_normals=True,export_materials='EXPORT',export_image_format='AUTO',export_draco_mesh_compression_enable=True,export_draco_mesh_compression_level=7,export_draco_position_quantization=14,export_draco_normal_quantization=10,export_attributes=True)
        print('GLB',fn,os.path.getsize(fn))
        arm.location.x=dx
bpy.ops.wm.save_as_mainfile(filepath=out+'.blend')
