import json,struct,base64,sys
def conv(src,dst):
    b=open(src,'rb').read();assert b[:4]==b'glTF'
    off=12;js=None;bin_=None
    while off<len(b):
        ln,typ=struct.unpack('<II',b[off:off+8]);chunk=b[off+8:off+8+ln];off+=8+ln
        if typ==0x4E4F534A:js=json.loads(chunk)
        elif typ==0x004E4942:bin_=chunk
    js['buffers'][0]['uri']='data:application/octet-stream;base64,'+base64.b64encode(bin_).decode()
    json.dump(js,open(dst,'w'),separators=(',',':'))
if __name__=='__main__':
    # m.glb, m_slim.glb, m_heavy.glb, f.glb ... -> male.gltf.json, male_slim.gltf.json, ...
    for g,n in [('m','male'),('f','female')]:
        for b in ['','_slim','_heavy']:conv(f'{g}{b}.glb',f'{n}{b}.gltf.json')
