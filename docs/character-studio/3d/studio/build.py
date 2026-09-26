import re
s=open('studio.src.html').read()
for tag,f in [('/*TOON3D*/','toon3d.js'),('/*TOONKIT*/','toonkit.js'),('/*RIG3D*/','rig3d.js')]:
    code=open(f).read();assert '</script' not in code,f;s=s.replace(tag,code)
open('studio.html','w').write(s)
loc=s.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js','./node_modules/three/build/three.module.js').replace('"https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"','"./node_modules/three/examples/jsm/"')
open('studio_local.html','w').write(loc)
print(len(s))
# same page under a strict CSP like the artifact viewer's (for csp.mjs)
csp='''<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; connect-src 'self'; img-src 'self' data: blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com">'''
open('csp_local.html','w').write(loc.replace('<meta charset="utf-8">','<meta charset="utf-8">'+csp,1))
