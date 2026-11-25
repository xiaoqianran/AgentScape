import * as THREE from 'three';
import { expect, it } from 'vitest';
import { SpatialSystem } from '../../modules/world/runtime/systems/SpatialSystem.js';
import { boxesOverlap } from '../../modules/world/runtime/spatial/SpatialSnapshot.js';
const spatial=new SpatialSystem({store:null});
const entry=(x,y,z,w,h,d)=>({box:new THREE.Box3(new THREE.Vector3(x,y,z),new THREE.Vector3(x+w,y+h,z+d))});
function baseline(snapshot,margin){
 const rows=[...snapshot],pairs=[];
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++)if(boxesOverlap(rows[i][1].box,rows[j][1].box,margin))pairs.push([rows[i][0],rows[j][0]]);
 return pairs;
}
it('matches pairwise overlap and insertion order for sparse, dense, mixed, touching and invalid bounds',()=>{
 let state=197;
 const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 for(const count of [1,63,64,150]){
  for(const mode of ['sparse','dense','mixed']){
   const snapshot=new Map();
   for(let i=0;i<count;i++){
    const span=mode==='dense'?.1:mode==='mixed'?6:80;
    const v=Array.from({length:3},()=>Math.round(rand()*span*4)/4);
    const size=Array.from({length:3},()=>mode==='dense'?2:Math.round(rand()*3*4)/4);
    snapshot.set('object-'+(count-i),entry(...v,...size));
   }
   for(const margin of [0,.015,.25,-1,NaN])expect(spatial.overlapPairs({snapshot,margin})).toEqual(baseline(snapshot,margin));
   if(count>=64){
    snapshot.set('empty',{box:new THREE.Box3()});
    expect(spatial.overlapPairs({snapshot})).toEqual(baseline(snapshot,.01));
   }
  }
 }
});
