import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { ObjectStore } from '../../modules/world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../modules/world/runtime/systems/SpatialSystem.js';
import { SceneGraph } from '../../modules/world/runtime/graph/SceneGraph.js';

// CPU-only sparse-world microbenchmark. This measures relation derivation,
// not MCP transport, browser frame time, physics or GPU rendering.
const counts=[100,300,600];
const runs=5;
const results=[];
for(const count of counts){
  const store=new ObjectStore();
  const geometry=new THREE.BoxGeometry(1,1,1);
  const material=new THREE.MeshBasicMaterial();
  for(let index=0;index<count;index++){
    const object=new THREE.Mesh(geometry,material);
    object.position.set((index%40)*8,0.5,Math.floor(index/40)*8);
    const id='box_'+index;
    store.add(id,{id,assetId:'box',object,manifest:{actions:[],surfaces:[],receptacles:[]}});
  }
  const spatial=new SpatialSystem({store});
  const original=spatial.containmentGeometry.bind(spatial);
  let exactContainmentCalls=0;
  spatial.containmentGeometry=(...args)=>{
    exactContainmentCalls++;
    return original(...args);
  };
  const graph=new SceneGraph({store,spatial});
  const samples=[];
  for(let i=0;i<runs+1;i++){
    graph.invalidate();
    const start=performance.now();
    graph.update();
    const elapsed=performance.now()-start;
    if(i>0)samples.push(elapsed);
  }
  samples.sort((a,b)=>a-b);
  results.push({
    objects:count,
    testedPairs:count*(count-1)/2,
    theoreticalExactContainmentCallsWithoutBroadPhase:count*(count-1),
    actualExactContainmentCalls:exactContainmentCalls,
    relations:graph.list().length,
    rebuildMs:{median:Number(samples[Math.floor(samples.length/2)].toFixed(2)),
      max:Number(samples[samples.length-1].toFixed(2))}
  });
  geometry.dispose();
  material.dispose();
}
console.log(JSON.stringify({scope:'CPU-only sparse SceneGraph; excludes MCP, WebGL/WebGPU, physics and navmesh',
  hardwareDependent:true,runsPerSize:runs,results},null,2));
