#!/usr/bin/env python3
"""Generate a tiny standards-compliant GLB used to exercise the real GLTFLoader path.
The node hierarchy mirrors the Blender authoring convention documented in README.md.
No third-party Python packages are required.
"""
import json, struct
from pathlib import Path

# 24 verts: four unique vertices per face so flat normals remain correct.
faces = [
    ((1,0,0), [(0.5,-0.5,-0.5),(0.5,0.5,-0.5),(0.5,0.5,0.5),(0.5,-0.5,0.5)]),
    ((-1,0,0), [(-0.5,-0.5,0.5),(-0.5,0.5,0.5),(-0.5,0.5,-0.5),(-0.5,-0.5,-0.5)]),
    ((0,1,0), [(-0.5,0.5,-0.5),(-0.5,0.5,0.5),(0.5,0.5,0.5),(0.5,0.5,-0.5)]),
    ((0,-1,0), [(-0.5,-0.5,0.5),(-0.5,-0.5,-0.5),(0.5,-0.5,-0.5),(0.5,-0.5,0.5)]),
    ((0,0,1), [(-0.5,-0.5,0.5),(0.5,-0.5,0.5),(0.5,0.5,0.5),(-0.5,0.5,0.5)]),
    ((0,0,-1), [(0.5,-0.5,-0.5),(-0.5,-0.5,-0.5),(-0.5,0.5,-0.5),(0.5,0.5,-0.5)]),
]
positions=[]; normals=[]; indices=[]
for normal, verts in faces:
    base=len(positions)
    positions.extend(verts); normals.extend([normal]*4)
    indices.extend([base,base+1,base+2,base,base+2,base+3])

bin_data=bytearray(); views=[]; accessors=[]
def align4():
    while len(bin_data)%4: bin_data.append(0)
def add_view(raw, target):
    align4(); off=len(bin_data); bin_data.extend(raw)
    views.append({"buffer":0,"byteOffset":off,"byteLength":len(raw),"target":target})
    return len(views)-1

def add_accessor(view, component, count, typ, mins=None, maxs=None):
    a={"bufferView":view,"componentType":component,"count":count,"type":typ}
    if mins is not None: a['min']=mins
    if maxs is not None: a['max']=maxs
    accessors.append(a); return len(accessors)-1

pos_raw=b''.join(struct.pack('<3f',*v) for v in positions)
nrm_raw=b''.join(struct.pack('<3f',*v) for v in normals)
idx_raw=b''.join(struct.pack('<H',i) for i in indices)
pos=add_accessor(add_view(pos_raw,34962),5126,len(positions),'VEC3',[-.5,-.5,-.5],[.5,.5,.5])
nrm=add_accessor(add_view(nrm_raw,34962),5126,len(normals),'VEC3')
idx=add_accessor(add_view(idx_raw,34963),5123,len(indices),'SCALAR',[0],[23])

gltf={
 "asset":{"version":"2.0","generator":"AgentScape demo asset generator"},
 "scene":0,
 "scenes":[{"nodes":[0,1]}],
 "nodes":[
   {"name":"Body","mesh":0,"translation":[0,1,0],"scale":[1.7,2.0,.72]},
   {"name":"doorHinge","translation":[-.82,1,.39],"children":[2]},
   {"name":"Door","mesh":1,"translation":[.81,0,0],"scale":[1.62,1.9,.08]}
 ],
 "meshes":[
   {"name":"CabinetBody","primitives":[{"attributes":{"POSITION":pos,"NORMAL":nrm},"indices":idx,"material":0}]},
   {"name":"CabinetDoor","primitives":[{"attributes":{"POSITION":pos,"NORMAL":nrm},"indices":idx,"material":1}]}
 ],
 "materials":[
   {"name":"CabinetBody","pbrMetallicRoughness":{"baseColorFactor":[.086,.12,.18,1],"roughnessFactor":.62,"metallicFactor":0}},
   {"name":"CabinetDoor","pbrMetallicRoughness":{"baseColorFactor":[.24,.36,.55,1],"roughnessFactor":.46,"metallicFactor":0}}
 ],
 "buffers":[{"byteLength":len(bin_data)}],"bufferViews":views,"accessors":accessors
}
json_bytes=json.dumps(gltf,separators=(',',':')).encode()
while len(json_bytes)%4: json_bytes+=b' '
align4(); bin_bytes=bytes(bin_data)
header=struct.pack('<4sII',b'glTF',2,12+8+len(json_bytes)+8+len(bin_bytes))
out=header+struct.pack('<I4s',len(json_bytes),b'JSON')+json_bytes+struct.pack('<I4s',len(bin_bytes),b'BIN\0')+bin_bytes
path=Path('public/assets/cabinet.glb'); path.write_bytes(out)
print(f'wrote {path} ({len(out)} bytes)')
