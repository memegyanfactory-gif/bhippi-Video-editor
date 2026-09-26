# eye texture (procedural iris painted into an image) + planar UVs so it survives skinning and glTF export
import bpy,numpy as np,math
def iris_image(name,iris='#5a86b5',size=512):
    def h(c):c=c.lstrip('#');return np.array([int(c[i:i+2],16)/255 for i in(0,2,4)])
    N=size;y,x=np.mgrid[0:N,0:N];u=(x+.5)/N*2-1;v=(y+.5)/N*2-1;r=np.hypot(u,v);a=np.arctan2(v,u)
    white=h('#f2eee7');col=np.tile(white,(N,N,1))
    # soft vein-free sclera shading toward the edge
    col*= (1-.08*np.clip((r-.6)/.4,0,1))[...,None]
    I=h(iris);ir=.42;pr=.19
    m=r<ir;t=np.clip(r/ir,0,1)
    streak=.5+.5*np.sin(a*38+np.sin(a*7)*2)
    ic=I[None,None,:]*(0.55+.45*t[...,None])*(0.85+.15*streak[...,None])
    ic=ic*(1-.55*np.clip((t-.82)/.18,0,1))[...,None]          # limbal ring
    col[m]=ic[m]
    col[r<pr]=h('#0d0b10')
    # catch light
    hl=np.hypot(u+.13,v-.14)<.07;col[hl]=1
    rgba=np.concatenate([col,np.ones((N,N,1))],-1).astype(np.float32)
    img=bpy.data.images.new(name,N,N,alpha=True);img.pixels.foreach_set(rgba.ravel());img.pack();return img
def setup_eye(e,img,front=(0,-1,0)):
    me=e.data;r=max(e.dimensions)/2
    if not me.uv_layers:me.uv_layers.new(name='UVMap')
    uv=me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co=me.vertices[me.loops[li].vertex_index].co
            if co.y<0:uv[li].uv=(co.x/(2*r*.62)+.5,co.z/(2*r*.62)+.5)
            else:uv[li].uv=(.02,.02)
    m=bpy.data.materials.new('Eye');m.use_nodes=True;nt=m.node_tree;b=nt.nodes['Principled BSDF']
    tx=nt.nodes.new('ShaderNodeTexImage');tx.image=img;tx.extension='EXTEND';nt.links.new(tx.outputs['Color'],b.inputs['Base Color'])
    b.inputs['Roughness'].default_value=.05;b.inputs['Coat Weight'].default_value=.7
    me.materials.clear();me.materials.append(m)
