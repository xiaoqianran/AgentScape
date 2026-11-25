import * as THREE from 'three';

// Material batching can put distant, disconnected solids in a single mesh.
// Refine the conservative AABB only for bounded indexed triangle geometry.
// Weld coincident positions for connectivity so UV/normal seams cannot split
// a closed solid into unrelated faces. No geometry or physics is mutated.
export function visualComponentBounds(geometry, matrixWorld, limit) {
  const position=geometry.getAttribute('position'), index=geometry.getIndex();
  if(!index || !position || position.itemSize!==3 || position.count>100000 || index.count>300000 || index.count%3!==0 || limit<2) return null;
  const parent=new Int32Array(position.count);
  const points=new Map();
  for(let i=0;i<position.count;i++){
    parent[i]=i;
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    if(![x,y,z].every(Number.isFinite))return null;
    const key=`${x},${y},${z}`;
    if(points.has(key))parent[i]=points.get(key);
    else points.set(key,i);
  }
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
  for(let i=0;i<index.count;i+=3){
    const a=index.getX(i),b=index.getX(i+1),c=index.getX(i+2);
    if(![a,b,c].every(v=>Number.isInteger(v)&&v>=0&&v<position.count))return null;
    join(a,b);join(a,c);
  }
  const boxes=new Map(),point=new THREE.Vector3();
  // Include even unreferenced vertices to preserve the full mesh bound.
  for(let i=0;i<position.count;i++){
    const key=root(i);
    if(!boxes.has(key)){
      if(boxes.size>=limit)return null;
      boxes.set(key,new THREE.Box3());
    }
    point.fromBufferAttribute(position,i);
    boxes.get(key).expandByPoint(point);
  }
  if(boxes.size<2)return null;
  const result=[...boxes.values()].map(box=>box.applyMatrix4(matrixWorld));
  return result.every(box=>!box.isEmpty()&&[...box.min.toArray(),...box.max.toArray()].every(Number.isFinite))?result:null;
}
