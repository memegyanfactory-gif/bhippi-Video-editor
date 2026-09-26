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
        bpy.ops.object.vertex_group_normalize_all(lock_active=False)
        m=o.modifiers.new('arm','ARMATURE');m.object=arm;bpy.ops.object.modifier_move_to_index(modifier='arm',index=0)
