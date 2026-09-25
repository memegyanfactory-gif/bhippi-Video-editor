import cv2, numpy as np, sys
from pathlib import Path
source, matte, plate_path, output = sys.argv[1:5]
v=cv2.VideoCapture(source); m=cv2.VideoCapture(matte)
plate=cv2.imread(plate_path)
if plate is None: raise RuntimeError('Missing clean plate')
h,w=plate.shape[:2]; rng=np.random.default_rng(42); cell=24
ny=(h+cell-1)//cell; nx=(w+cell-1)//cell
colors=np.array([[70,70,244],[104,202,55],[250,132,50],[56,214,255]],np.float32)
colorids=rng.integers(0,4,(ny,nx)); delay=rng.uniform(0,.72,(ny,nx))
offset=rng.uniform(-1,1,(ny,nx,2))*np.array([150,110])
writer=cv2.VideoWriter(output,cv2.VideoWriter_fourcc(*'mp4v'),30,(w,h))
if not writer.isOpened(): raise RuntimeError('Could not open video writer')
sheets=[]
def smooth(x):
 x=np.clip(x,0,1); return x*x*(3-2*x)
for i in range(150):
 t=i/30; ok,frame=v.read(); okm,mf=m.read()
 if not ok or not okm: raise RuntimeError('Missing frame '+str(i))
 alpha=cv2.resize(cv2.cvtColor(mf,cv2.COLOR_BGR2GRAY),(w,h)).astype(np.float32)/255
 # Each colored tile flies a short distance and settles on the tracked silhouette.
 tiled=np.zeros((h,w,3),np.float32); coverage=np.zeros((h,w),np.float32)
 small=cv2.resize(alpha,(nx,ny),interpolation=cv2.INTER_AREA)
 for gy,gx in zip(*np.where(small>.10)):
  a=.08+delay[gy,gx]+.16*gy/ny
  p=np.clip((t-a)/.58,0,1)
  if p<=0: continue
  ease=1-(1-p)**4
  dx,dy=offset[gy,gx]*(1-ease)
  size=int(cell*(.22+.78*ease)); x=int(gx*cell+dx+(cell-size)/2); y=int(gy*cell+dy+(cell-size)/2)
  x0=max(0,x); y0=max(0,y); x1=min(w,x+size-1); y1=min(h,y+size-1)
  if x1<=x0 or y1<=y0:continue
  color=colors[colorids[gy,gx]]*(.80+.20*ease)
  tiled[y0:y1,x0:x1]=color
  coverage[y0:y1,x0:x1]=smooth(p/.25)*small[gy,gx]
 # Tiles resolve independently, top-to-bottom, into natural footage.
 local=smooth((t-(1.45+delay*.55+np.arange(ny)[:,None]/ny*.36))/.66)
 live=cv2.resize(local.astype(np.float32),(w,h),interpolation=cv2.INTER_NEAREST)
 cov=coverage*(1-live)
 # While assembled the pixels are exactly clipped to the tracked alpha.
 cov*=((1-smooth((t-1.05)/.35))+smooth((t-1.05)/.35)*alpha)
 base=plate.astype(np.float32)
 comp=base*(1-cov[:,:,None])+tiled*cov[:,:,None]
 am=(alpha*live)[:,:,None]
 comp=comp*(1-am)+frame.astype(np.float32)*am
 # Return to unmodified live shot by 2.7s, including microphone and fine edges.
 finish=smooth((t-2.25)/.45)
 comp=comp*(1-finish)+frame.astype(np.float32)*finish
 out=np.uint8(np.clip(comp,0,255));writer.write(out)
 if i in [6,18,30,42,54,66,81,120]:
  thumb=cv2.resize(out,(480,270));cv2.putText(thumb,f'{t:.2f}s',(14,25),cv2.FONT_HERSHEY_SIMPLEX,.7,(255,255,255),2)
  sheets.append(thumb)
writer.release();v.release();m.release()
cv2.imwrite(str(Path(output).with_suffix('.jpg')),np.vstack([np.hstack(sheets[:4]),np.hstack(sheets[4:])]))
print(output)
