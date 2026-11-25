// Deterministic CPU microbenchmark: compare identical AABB candidate sets.
import * as THREE from 'three';
import assert from 'node:assert/strict';
import { SpatialSystem } from '../../modules/world/runtime/systems/SpatialSystem.js';
import { boxesOverlap } from '../../modules/world/runtime/spatial/SpatialSnapshot.js';
const system=new SpatialSystem({store:null});
function baseline(snapshot){
  const ids=[...snapshot.keys()],pairs=[];
  for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)if(boxesOverlap(snapshot.get(ids[a]).box,snapshot.get(ids[b]).box,.01))pairs.push([ids[a],ids[b]]);
  return pairs;
}
function measure(fn){
  const samples=[];let result;
  for(let i=0;i<6;i++){const start=performance.now();result=fn();samples.push(performance.now()-start);}
  return {result,medianMs:samples.slice(1).sort((a,b)=>a-b)[2]};
}
const cases=[['sparse',24],['sparse',512],['sparse',2048],['sparse',8192],['dense',512]];
for(const [layout,count] of cases){
  const snapshot=new Map();
  for(let i=0;i<count;i++){
    const p=layout==='dense'?new THREE.Vector3((i%17)/100,(i%29)/100,(i%13)/100):new THREE.Vector3((i%128)*2,Math.floor(i/128)%8*2,Math.floor(i/1024)*2);
    snapshot.set('o'+i,{box:new THREE.Box3(p,p.clone().addScalar(1))});
  }
  const before=measure(()=>baseline(snapshot)),after=measure(()=>system.overlapPairs({snapshot}));
  assert.deepEqual(after.result,before.result);
  console.log(JSON.stringify({layout,count,pairs:before.result.length,baselineMs:before.medianMs,optimizedMs:after.medianMs}));
}
