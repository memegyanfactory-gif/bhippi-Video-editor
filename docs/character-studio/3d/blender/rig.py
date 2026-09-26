# joint finding on the (sculpted) base mesh + armature + automatic weights
import bpy,numpy as np
from mathutils import Vector
def V(o,n=400000):
    P=np.array([v.co[:] for v in o.data.vertices]);T=[]
    for f in o.data.polygons:
        vs=list(f.vertices)
        for i in range(1,len(vs)-1):T.append((vs[0],vs[i],vs[i+1]))
    T=np.array(T);a,b,c=P[T[:,0]],P[T[:,1]],P[T[:,2]];area=np.linalg.norm(np.cross(b-a,c-a),axis=1)/2
    rng=np.random.default_rng(1);idx=rng.choice(len(T),n,p=area/area.sum());u=rng.random((n,2));m=u.sum(1)>1;u[m]=1-u[m]
    return np.vstack([P,a[idx]+(b[idx]-a[idx])*u[:,:1]+(c[idx]-a[idx])*u[:,1:]])
def centroid(P):return P.mean(0) if len(P) else None
def pca(P):c=P.mean(0);u,s,vt=np.linalg.svd(P-c,full_matrices=False);return c,vt[0]
def kmeans1(x,k,it=30):
    c=np.quantile(x,np.linspace(.1,.9,k))
    for _ in range(it):
        l=np.argmin(np.abs(x[:,None]-c[None,:]),1);c=np.array([x[l==i].mean() if (l==i).any() else c[i] for i in range(k)])
    return l,c
def arm_split(P,crotch):
    """per z-slice x threshold separating the arm (outside) from torso/legs (inside), for x>0"""
    zs=np.arange(.55,1.6,.01);th={};armpit=None
    for z in zs:
        b=np.sort(P[(np.abs(P[:,2]-z)<.002)&(P[:,0]>.02)][:,0])
        if len(b)<4:continue
        gaps=np.diff(b);i=np.argmax(gaps)
        if gaps[i]>.008:th[round(z,2)]=(b[i]+b[i+1])/2
        elif z>crotch+.2 and armpit is None and round(z-.01,2) in th:armpit=z
    last=max(k for k in th if armpit is None or k<armpit)
    return th,armpit,th[last]
def find_joints(o,g):
    P=V(o);J={}
    crotch=P[(np.abs(P[:,0])<.006)&(P[:,2]<1.1)&(P[:,2]>.5)][:,2].min();top=P[:,2].max()
    th,armpit,thtop=arm_split(P,crotch)
    thr=lambda z:th.get(round(z,2),thtop if z>=armpit-.01 else 9)
    X=np.abs(P[:,0]);zk=np.round(P[:,2],2);TH=np.array([thr(z) for z in zk]);isarm=X>TH
    Bd=P[~isarm];Ar=P[isarm]
    for s,n in((1,'L'),(-1,'R')):
        leg=Bd[(Bd[:,0]*s>.012)&(Bd[:,2]<crotch-.01)]
        ank=centroid(leg[np.abs(leg[:,2]-.09)<.012]);hipc=centroid(leg[np.abs(leg[:,2]-(crotch-.04))<.01])
        hip=np.array([hipc[0],hipc[1]+.005,crotch+.055]);knee_z=ank[2]+(hip[2]-ank[2])*.47
        kn=centroid(leg[np.abs(leg[:,2]-knee_z)<.01]);kn[1]-=.008
        foot=leg[leg[:,2]<.05];toe=foot[np.argmin(foot[:,1])]
        ball=centroid(foot[(foot[:,1]<toe[1]+.065)&(foot[:,1]>toe[1]+.04)]);ball[2]=.028
        J['thigh'+n]=hip;J['shin'+n]=kn;J['foot'+n]=ank;J['toe'+n]=ball;J['toetip'+n]=np.array([ball[0],toe[1],.025])
    tor=lambda z:centroid(Bd[(np.abs(Bd[:,2]-z)<.01)&(np.abs(Bd[:,0])<.1)])
    J['hips']=np.array([0,tor(crotch+.1)[1],crotch+.1])
    J['spine']=np.array([0,tor(crotch+.24)[1]+.01,crotch+.24]);J['chest']=np.array([0,tor(armpit-.05)[1]+.01,armpit-.05])
    # neck base: top of the trapezius slope just inside the shoulder
    tz=Bd[(np.abs(np.abs(Bd[:,0])-thtop*.78)<.006)&(Bd[:,2]<armpit+.22)&(Bd[:,2]>armpit)][:,2].max()
    nb=min(tz+.015,armpit+.18);J['neck']=np.array([0,tor(nb)[1],nb])
    ear=Bd[(X[~isarm]>.07)&(Bd[:,2]>nb+.06)];ear_z=ear[np.argmax(np.abs(ear[:,0]))][2]
    J['head']=np.array([0,tor(nb+.07)[1]+.005 if tor(nb+.07) is not None else -.01,max(ear_z-.055,nb+.05)]);J['headtop']=np.array([0,-.005,top])
    for s,n in((1,'L'),(-1,'R')):
        A=Ar[Ar[:,0]*s>0]
        low=A[A[:,2]<armpit]
        c,ax=pca(low);ax=ax if ax[2]<0 else -ax
        t=(low-c)@ax;wr=None;prev=None
        for k in np.arange(t.min(),t.max(),.008):
            b=low[(t>=k)&(t<k+.008)]
            if len(b)<4:continue
            w=b[:,1].max()-b[:,1].min()
            if prev is not None and k>t.min()+.15 and w>prev*1.25:wr=k;break
            prev=w
        if wr is None:
            best=None
            for k in np.arange(t.max()-.3,t.max()-.14,.006):
                b=low[np.abs(t-k)<.004]
                if len(b)<4:continue
                w=(b[:,1].max()-b[:,1].min())+(b[:,0].max()-b[:,0].min())
                if best is None or w<best[0]:best=(w,k)
            wr=best[1]+.012
        wrist=centroid(low[np.abs(t-(wr-.004))<.006])
        shoulder=np.array([s*(thtop+.035 if g=='m' else thtop+.03),J['chest'][1]-.005,armpit+.07])
        elbow=shoulder+(wrist-shoulder)*.52;elbow[1]+=.012
        J['shoulder'+n]=np.array([s*.03,J['neck'][1]+.005,J['neck'][2]-.03]);J['upperarm'+n]=shoulder;J['forearm'+n]=elbow;J['hand'+n]=wrist
        H=low[t>wr];th_=(H-wrist)@ax;fz=H[th_>th_.max()*.52]
        thumb=H[(H[:,1]<np.quantile(H[:,1],.1))&(th_<th_.max()*.62)]
        rest=fz[fz[:,1]>thumb[:,1].max()-.005] if len(thumb) else fz
        l,cc=kmeans1(rest[:,1],4);order=np.argsort(cc)
        for name,ci in zip(['index','middle','ring','pinky'],order):
            F=rest[l==ci];ft=(F-wrist)@ax;base=centroid(F[ft<ft.min()+.012]);tip=F[np.argmax(ft)]
            cf,fa=pca(F);fa=fa if fa@(tip-base)>0 else -fa
            base=base-fa*.012;L=np.linalg.norm(tip-base)
            J[name+'1'+n]=base;J[name+'2'+n]=base+fa*L*.45;J[name+'3'+n]=base+fa*L*.74;J[name+'tip'+n]=tip
        ct=thumb.mean(0);tip=thumb[np.argmax(np.linalg.norm(thumb-wrist,axis=1))]
        tb=wrist+ax*.012+(ct-wrist)*.25
        J['thumb1'+n]=tb;J['thumb2'+n]=tb+(tip-tb)*.42;J['thumb3'+n]=tb+(tip-tb)*.72;J['thumbtip'+n]=tip
    print('armpit',armpit,'crotch',crotch,'thtop',thtop)
    return J
PARENT={'hips':None,'spine':'hips','chest':'spine','neck':'chest','head':'neck'}
for n in 'LR':
    PARENT.update({'shoulder'+n:'chest','upperarm'+n:'shoulder'+n,'forearm'+n:'upperarm'+n,'hand'+n:'forearm'+n,'thigh'+n:'hips','shin'+n:'thigh'+n,'foot'+n:'shin'+n,'toe'+n:'foot'+n})
    for f in['thumb','index','middle','ring','pinky']:
        for j in(1,2,3):PARENT[f+str(j)+n]='hand'+n if j==1 else f+str(j-1)+n
TAIL={'hips':'spine','spine':'chest','chest':'neck','neck':'head','head':'headtop'}
for n in 'LR':
    TAIL.update({'shoulder'+n:'upperarm'+n,'upperarm'+n:'forearm'+n,'forearm'+n:'hand'+n,'hand'+n:'middle1'+n,'thigh'+n:'shin'+n,'shin'+n:'foot'+n,'foot'+n:'toe'+n,'toe'+n:'toetip'+n})
    for f in['thumb','index','middle','ring','pinky']:
        for j in(1,2,3):TAIL[f+str(j)+n]=f+(str(j+1) if j<3 else 'tip')+n
def build_armature(J,name):
    am=bpy.data.armatures.new(name);ob=bpy.data.objects.new(name,am);bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active=ob;bpy.ops.object.mode_set(mode='EDIT')
    E={}
    for b,p in PARENT.items():
        e=am.edit_bones.new(b);e.head=Vector(J[b]);e.tail=Vector(J[TAIL[b]])
        if (e.tail-e.head).length<1e-3:e.tail=e.head+Vector((0,0,.02))
        E[b]=e
    for b,p in PARENT.items():
        if p:E[b].parent=E[p];E[b].use_connect=False
    # roll: fingers/hands curl toward the palm; keep default z-up roll elsewhere
    bpy.ops.object.mode_set(mode='OBJECT');return ob
def bind(body,arm,rigid=(),rigid_bone='head',transfer=()):
    bpy.ops.object.select_all(action='DESELECT');body.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    bind_extra(body,arm,rigid,rigid_bone,transfer)
def bind_extra(body,arm,rigid=(),rigid_bone='head',transfer=()):
    for o in rigid:
        o.parent=arm;vg=o.vertex_groups.new(name=rigid_bone);vg.add(list(range(len(o.data.vertices))),1.0,'REPLACE')
        m=o.modifiers.new('arm','ARMATURE');m.object=arm
        bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_move_to_index(modifier='arm',index=0)
    for o in transfer:
        o.parent=arm
        for b in arm.data.bones:o.vertex_groups.new(name=b.name)
        dt=o.modifiers.new('dt','DATA_TRANSFER');dt.object=body;dt.use_vert_data=True;dt.data_types_verts={'VGROUP_WEIGHTS'};dt.vert_mapping='POLYINTERP_NEAREST'
        bpy.context.view_layer.objects.active=o;bpy.ops.object.datalayout_transfer(modifier='dt');bpy.ops.object.modifier_move_to_index(modifier='dt',index=0);bpy.ops.object.modifier_apply(modifier='dt')
        for bn,to in(('head','chest'),('neck','chest')):
            if bn in o.vertex_groups and to in o.vertex_groups:
                src=o.vertex_groups[bn];dst=o.vertex_groups[to]
                for v in o.data.vertices:
                    for g in v.groups:
                        if g.group==src.index and g.weight>0:
                            w=g.weight;dst.add([v.index],w,'ADD');src.remove([v.index]);break
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        m=o.modifiers.new('arm','ARMATURE');m.object=arm;bpy.ops.object.modifier_move_to_index(modifier='arm',index=0)

def fix_head_neck(body,arm):
    """rigid head above a tilted chin-to-nape plane; smooth chest->neck->head gradient along the neck; shoulders untouched"""
    import math
    B=arm.data.bones;hz=B['head'].head_local;nz=B['neck'].head_local
    P=[v.co for v in body.data.vertices]
    chin=min((p for p in P if p.y<-.085 and abs(p.x)<.02 and nz.z+.02<p.z<hz.z+.02),key=lambda p:p.z)
    nape_z=hz.z-.01;nape_y=max(p.y for p in P if abs(p.x)<.02 and abs(p.z-nape_z)<.01)
    k=max(.5,(nape_z-(chin.z-.004))/(nape_y-chin.y))     # plane z(y)=chin.z-.004+k*(y-chin.y); anatomical minimum slope
    plane=lambda p:chin.z-.004+k*(p.y-chin.y)
    names={g.name:g for g in body.vertex_groups};gi={g.index:g.name for g in body.vertex_groups}
    for n in('head','neck','chest'):
        if n not in names:names[n]=body.vertex_groups.new(name=n);gi[names[n].index]=n
    nb=nz.z-.015;ax_y=nz.y
    ss=lambda a,b,x:0. if x<=a else 1. if x>=b else (lambda t:t*t*(3-2*t))((x-a)/(b-a))
    changed=0
    for v in body.data.vertices:
        p=v.co;pl=plane(p)
        wh=ss(pl-.04,pl+.012,p.z)                        # head ownership, soft band under the jaw
        r=math.hypot(p.x,(p.y-ax_y)*1.1)
        inneck=1.-ss(.07,.1,r)                             # near the neck axis only (keeps shoulders/traps)
        if wh<=0 and not(inneck>0 and p.z>nb):continue
        cur={gi[g.group]:g.weight for g in v.groups if g.weight>0}
        if wh>0:
            # head takes wh, everything else scaled down
            new={n:w*(1-wh) for n,w in cur.items() if n!='head'};new['head']=wh+cur.get('head',0)*(1-wh)
        else:
            t=ss(nb,pl-.04,p.z)                             # 0 at neck base -> 1 near the head
            want={'chest':(1-t)**2,'neck':1-(1-t)**2-t*t*.35,'head':t*t*.35}
            new={n:w*(1-inneck) for n,w in cur.items()}
            for n,w in want.items():new[n]=new.get(n,0)+w*inneck
        s=sum(new.values()) or 1
        for n,w in new.items():
            names[n].add([v.index],w/s,'REPLACE')
        for n in cur:
            if n not in new:names[n].remove([v.index])
        changed+=1
    print('fix_head_neck',body.name,'verts',changed,'chin',tuple(round(c,3) for c in chin),'slope',round(k,2))

BUILDS={
 'slim':{'spine':.86,'chest':.89,'hips':.9,'neck':.93,'upperarm':.84,'forearm':.87,'thigh':.85,'shin':.88,'shoulder':.92},
 'heavy':{'spine':1.5,'chest':1.24,'hips':1.3,'neck':1.2,'upperarm':1.28,'forearm':1.16,'thigh':1.32,'shin':1.16,'shoulder':1.14,'belly':.075},
 'muscular':{'spine':1.0,'chest':1.12,'hips':1.03,'neck':1.12,'upperarm':1.2,'forearm':1.13,'thigh':1.12,'shin':1.07,'shoulder':1.15},
}
def apply_build(body,arm,build):
    """re-shape the bound body around its own bones: each vertex moves radially from the bone axes it is weighted to"""
    if build not in BUILDS:return
    from mathutils import Vector
    S=BUILDS[build];bones=arm.data.bones;gi={g.index:g.name for g in body.vertex_groups}
    def fac(n):
        for k,v in S.items():
            if n.startswith(k):return v
        return 1.
    hipz=bones['hips'].head_local.z;chestz=bones['chest'].head_local.z
    for v in body.data.vertices:
        p=v.co.copy();d=Vector()
        for g in v.groups:
            n=gi[g.group];f=fac(n)
            if f==1. or g.weight<=0:continue
            b=bones[n];h=b.head_local;t=b.tail_local;ax=t-h;u=max(0.,min(1.,(p-h).dot(ax)/ax.length_squared));c=h+ax*u
            r=p-c
            if n in('spine','chest','hips'):r.z=0.                   # torso: grow sideways and front/back only
            d+=r*(f-1.)*g.weight
        if 'belly' in S and p.y<0:
            t=max(0.,1.-abs(p.z-(hipz+chestz)/2)/((chestz-hipz)*.75))*max(0.,1.-abs(p.x)/.16)
            d.y-=S['belly']*t*t*(3-2*t)
        v.co=p+d
    body.data.update();print('build',build,body.name)

def smooth_neck(body,arm,iters=6):
    """soften the chest/neck/head weight transition along the neck (no hard ring crease)"""
    import bmesh,math
    B=arm.data.bones;nb=B['neck'].head_local.z-.03;top=B['head'].head_local.z+.01;ay=B['neck'].head_local.y
    gi={g.index:g.name for g in body.vertex_groups};gs={g.name:g for g in body.vertex_groups}
    me=body.data;adj=[[] for _ in me.vertices]
    for e in me.edges:a,b=e.vertices;adj[a].append(b);adj[b].append(a)
    sel=[v.index for v in me.vertices if nb<v.co.z<top and math.hypot(v.co.x,(v.co.y-ay)*1.1)<.1]
    names=('chest','neck','head')
    W={n:[0.]*len(me.vertices) for n in names}
    for v in me.vertices:
        for g in v.groups:
            n=gi[g.group]
            if n in W:W[n][v.index]=g.weight
    for _ in range(iters):
        for n in names:
            w=W[n];nw=w[:]
            for i in sel:nw[i]=.5*w[i]+.5*sum(w[j] for j in adj[i])/max(1,len(adj[i]))
            W[n]=nw
    for i in sel:
        v=me.vertices[i];other=sum(g.weight for g in v.groups if gi[g.group] not in names)
        tot=sum(W[n][i] for n in names) or 1;scale=max(0.,1-other)/tot
        for n in names:
            if W[n][i]>1e-4:gs[n].add([i],W[n][i]*scale,'REPLACE')
            elif any(gi[g.group]==n for g in v.groups):gs[n].remove([i])
    print('smooth_neck',len(sel))
