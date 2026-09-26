# artist pass: brush strokes per base (m = male, f = female). x: + = character's left, -y = front, z up.
import numpy as np
def neck_mask(r0,r1,head=None):
    def f(V):
        r=np.hypot(V[:,0],V[:,1]+.01);t=np.clip((r1-r)/(r1-r0),0,1);t=t*t*(3-2*t)
        if head is not None:
            c,R=np.array(head[0]),np.array(head[1]);d=np.linalg.norm((V-c)/R,axis=1);h=np.clip((1.12-d)/.17,0,1);t=np.maximum(t,h*h*(3-2*h))
        return t
    return f
def _lidonly(S,c,R,a,n):
    keep=S.V[n:].copy();S.lid(c,R,a);S.V[n:]=keep;return S.V[:n]
def run(g,S,B):
    if g=='m':
        # long lower face, narrow jaw, pointed chin
        S.scale((0,-.06,1.52),(.13,.14,.07),(.95,1,1),pivot=(0,-.06,1.52),sym=False)
        # long philtrum
        S.grab((0,-.16,1.54),(.045,.04,.035),(0,0,-.006),sym=False)
        # big hanging nose
        S.grab((0,-.18,1.585),(.034,.04,.034),(0,-.03,-.016),sym=False)
        S.scale((0,-.17,1.59),(.04,.05,.05),(1.18,1,1.1),sym=False)
        S.inflate((0,-.205,1.575),(.022,.025,.022),.006,sym=False)
        S.grab((0,-.15,1.625),(.022,.03,.03),(0,-.012,0),sym=False)
        # heavy brow ridge
        S.grab((.042,-.135,1.668),(.055,.03,.022),(0,-.007,-.002))
        # heavy, sleepy upper lids
        n=len(S.V)-2
        for x in (-.0407,.0407):S.V[:n]=_lidonly(S,(x,-.0828,1.63),.0385,.3,n)
        # cheek hollows (lanky)
        S.grab((.06,-.1,1.55),(.03,.03,.03),(-.004,.004,0))
        # longer, thinner neck (last, so face strokes land on the original landmarks)
        S.scale((0,-.01,1.44),(.16,.16,.05),(.95,.96,1),sym=False)
        S.region_move(1.37,1.48,(0,0,.022),neck_mask(.075,.13,((0,-.05,1.6),(.14,.2,.2))))
        S.smooth((0,-.01,1.45),(.09,.1,.07),it=6,k=.6,sym=False)
    else:
        S.scale((0,-.02,1.33),(.3,.3,.3),.93,pivot=(0,-.02,1.33),sym=False) if False else None
        S.grab((0,-.12,1.33),(.09,.1,.06),(0,-.002,-.007),sym=False)
        S.scale((0,-.06,1.36),(.12,.13,.07),(.92,1,1),pivot=(0,-.06,1.36),sym=False)
        S.grab((.05,-.12,1.41),(.03,.03,.03),(.002,-.004,.004))
        S.region_move(1.25,1.31,(0,0,.018),neck_mask(.065,.115,((0,-.04,1.45),(.12,.15,.16))))
    return None
