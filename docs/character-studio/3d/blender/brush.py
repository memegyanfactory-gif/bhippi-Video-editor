# scripted sculpt brushes on a mesh (world == object space after we zero the transform); x-symmetric
import numpy as np
class Sculpt:
    def __init__(s,V,F):s.V=np.array(V,dtype=np.float64);s.F=F;s._adj=None
    def fall(s,d):t=np.clip(d,0,1);return (1-t)**2*(1+2*t)
    def w(s,c,r,sym=True):
        c=np.array(c,float);r=np.array(r if hasattr(r,'__len__') else (r,r,r),float)
        d=np.linalg.norm((s.V-c)/r,axis=1);w=s.fall(d)
        if sym and abs(c[0])>1e-6:
            m=c.copy();m[0]=-m[0];w=np.maximum(w,s.fall(np.linalg.norm((s.V-m)/r,axis=1)))
        return w
    def sgn(s,c):return np.where(s.V[:,0]*np.sign(c[0] or 1)>=0,1,-1) if abs(c[0])>1e-6 else np.ones(len(s.V))
    def grab(s,c,r,d,sym=True):
        d=np.array(d,float);w=s.w(c,r,sym);D=np.tile(d,(len(s.V),1))
        if sym and abs(c[0])>1e-6:D[:,0]*=s.sgn(c)
        s.V+=D*w[:,None]
    def scale(s,c,r,k,pivot=None,sym=True):
        c=np.array(c,float);p=np.array(pivot if pivot is not None else c,float);k=np.array(k if hasattr(k,'__len__') else (k,k,k),float);w=s.w(c,r,sym)
        P=np.tile(p,(len(s.V),1))
        if sym and abs(p[0])>1e-6:P[:,0]=np.abs(p[0])*s.sgn(c)
        s.V=P+(s.V-P)*(1+(k-1)*w[:,None])
    def normals(s):
        V=s.V;N=np.zeros_like(V)
        for f in s.F:
            a,b,c=V[f[0]],V[f[1]],V[f[2]];n=np.cross(b-a,c-a)
            for i in f:N[i]+=n
        return N/np.maximum(np.linalg.norm(N,axis=1),1e-9)[:,None]
    def inflate(s,c,r,amt,sym=True):
        w=s.w(c,r,sym);s.V+=s.normals()*(amt*w)[:,None]
    def adj(s):
        if s._adj is None:
            A=[set() for _ in s.V]
            for f in s.F:
                for i in range(len(f)):a,b=f[i],f[(i+1)%len(f)];A[a].add(b);A[b].add(a)
            s._adj=[np.array(list(a)) for a in A]
        return s._adj
    def smooth(s,c,r,it=3,k=.5,sym=True):
        w=s.w(c,r,sym)*k;A=s.adj();idx=np.nonzero(w>1e-4)[0]
        for _ in range(it):
            avg=np.array([s.V[A[i]].mean(0) for i in idx]);s.V[idx]+=(avg-s.V[idx])*w[idx,None]
    def region_move(s,zlo,zhi,d,cond=None):
        # smooth vertical ramp: 0 below zlo, 1 above zhi
        t=np.clip((s.V[:,2]-zlo)/(zhi-zlo),0,1);t=t*t*(3-2*t);t0=t
        if cond is not None:
            z=s.V[:,2];u=np.clip((z-zhi)/(.03),0,1);u=u*u*(3-2*u);c=cond(s.V);t=np.maximum(t*(c+(1-c)*u),np.where(c>.999,1.0,0.0)*(s.V[:,2]>zlo-.1))
        s.V+=np.array(d,float)[None,:]*t[:,None]
def _lid(s,c,R,ang,upper=True):
    c=np.array(c,float);q=s.V-c;d=np.linalg.norm(q,axis=1)
    wr=np.clip((R*1.7-d)/(R*.5),0,1);w=wr*wr*(3-2*wr)*np.clip((q[:,2]*(1 if upper else -1)+R*.15)/(R*.5),0,1)*np.clip((-q[:,1]+R*.2)/(R*.6),0,1)
    a=ang*w;ca,sa=np.cos(a),np.sin(a);y=q[:,1]*ca-q[:,2]*sa;z=q[:,1]*sa+q[:,2]*ca
    s.V[:,1]=c[1]+y;s.V[:,2]=c[2]+z
Sculpt.lid=_lid
