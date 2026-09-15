import { performance } from 'node:perf_hooks';
import { createMagicCabin } from '../../modules/world/content/magicCabin.js';
import { cabinCanvasHost } from '../../tests/helpers/cabinCanvasHost.js';

// CPU-only content benchmark. No renderer, GPU, physics or navigation timing is implied.
const cabin=createMagicCabin(cabinCanvasHost());
try {
  for(let i=0;i<240;i++)cabin.step(1/60);
  const samples=[];
  for(let i=0;i<1200;i++) {
    const start=performance.now();cabin.step(1/60);samples.push(performance.now()-start);
  }
  samples.sort((a,b)=>a-b);
  const kinds={};for(const entry of cabin.affordances)kinds[entry.kind]=(kinds[entry.kind] || 0)+1;
  let meshes=0;let vertices=0;
  cabin.root.traverse(node=>{if(node.isMesh){meshes++;vertices+=node.geometry.attributes.position?.count || 0;}});
  console.log(JSON.stringify({scope:'content update CPU only; excludes GPU, physics, navigation',samples:samples.length,
    updateMs:{p50:samples[599],p95:samples[1139]},interactionNodes:cabin.interactions.length,
    agentContracts:cabin.affordances.length,kinds,meshes,vertices,diagnostics:cabin.diagnostics()},null,2));
} finally {cabin.dispose();}
