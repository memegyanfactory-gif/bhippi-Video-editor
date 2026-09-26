import bpy
for o in bpy.data.objects:
    if o.type!='MESH' or not o.vertex_groups:continue
    names={g.index:g.name for g in o.vertex_groups};bad=0;zero=0;ex=None
    for v in o.data.vertices:
        ws=[(names[g.group],g.weight) for g in v.groups if g.weight>0]
        if not ws:zero+=1;continue
        b,w=max(ws,key=lambda t:t[1])
        side=b[-1] if b[-1] in 'LR' and not b in('hips',) else None
        if side and ((side=='L' and v.co.x<-.03) or (side=='R' and v.co.x>.03)):bad+=1;ex=ex or (tuple(round(c,3) for c in v.co),b,round(w,2))
    if bad or zero:print('W',o.name,'verts',len(o.data.vertices),'zero',zero,'wrongside',bad,ex)
