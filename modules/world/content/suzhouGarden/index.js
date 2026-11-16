import * as THREE from 'three';
import { WORLD, QUALITY, POIS, Batch, buildTextures, buildMaterials, terrainHeight } from './src/core.js';
import { buildBuildings } from './src/buildings.js';
import { buildRockery } from './src/rockery.js';
import { createNature } from './src/nature.js';
import { createSky } from './src/sky.js';
import { createWater } from './src/water.js';
import { LODManager } from './src/lod.js';

// Native AgentScape environment: content and lighting only. The original UI,
// controls, postprocessing and animation loop are deliberately not imported.
export const SUZHOU_ID = 'suzhou-garden';
function createGround() {
  const geo = new THREE.PlaneGeometry(300,300,48,48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  for(let i=0;i<pos.count;i++){
    pos.setY(i,terrainHeight(pos.getX(i),pos.getZ(i)));
  }
  pos.needsUpdate=true;
  geo.computeVertexNormals();
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({visible:false}));
  mesh.name='SuzhouGardenNavigationSurface';
  return {mesh,collider:{shape:'trimesh',vertices:Array.from(pos.array),indices:Array.from(geo.getIndex().array)}};
}
// CONTENT-015: the entrance-axis region (景区 1 · 澄观门庭, Z 110 -> 40) is the
// garden's interactive region. Its structures get real physics colliders and
// navmesh blockers derived from the same footprint list, matching the visual
// builders in src/buildings.js (shadow walls, brick gate with a real 3.6 m
// doorway, sedan hall, side corridors, 澄观堂). Every other region of the
// garden stays display-only: terrain collision and navigation only.
const boxCollider=(halfExtents,translation,rotY=0)=>rotY
  ? {shape:'box',halfExtents,translation,rotation:[0,Math.sin(rotY/2),0,Math.cos(rotY/2)]}
  : {shape:'box',halfExtents,translation};
const span=(top)=>[(top+0.5)/2,(top-0.5)/2]; // [halfHeight, centerY] reaching 0.5 below grade
export const SUZHOU_ENTRANCE_STRUCTURES=Object.freeze([
  {name:'shadow-wall-west',collider:boxCollider([2.92,span(3.8)[0],0.3],[-11.5,span(3.8)[1],106.5],0.540),nav:true},
  {name:'shadow-wall-east',collider:boxCollider([2.92,span(3.8)[0],0.3],[11.5,span(3.8)[1],106.5],-0.540),nav:true},
  {name:'stone-screen',collider:boxCollider([4.5,span(0.82)[0],0.35],[0,span(0.82)[1],104]),nav:true},
  {name:'gate-west',collider:boxCollider([2.6,span(5.6)[0],0.45],[-4.4,span(5.6)[1],92]),nav:true},
  {name:'gate-east',collider:boxCollider([2.6,span(5.6)[0],0.45],[4.4,span(5.6)[1],92]),nav:true},
  {name:'gate-lintel',collider:boxCollider([1.8,0.99,0.45],[0,4.61,92]),nav:false},
  {name:'sedan-hall',collider:boxCollider([10,span(5.2)[0],4],[0,span(5.2)[1],80]),nav:true},
  {name:'chengguan-hall',collider:boxCollider([14,span(8.4)[0],6],[0,span(8.4)[1],58]),nav:true},
  ...[-24,24].flatMap((x)=>[59,63,67,71].map((z)=>({name:`corridor-column-${x}-${z}`,collider:{shape:'cylinder',radius:0.18,halfHeight:1.9,translation:[x,1.4,z]},nav:false})))
]);
function createEntranceBlockers() {
  return SUZHOU_ENTRANCE_STRUCTURES.filter((item)=>item.nav).map((item)=>{
    const c=item.collider;
    const mesh=new THREE.Mesh(
      new THREE.BoxGeometry(c.halfExtents[0]*2,c.halfExtents[1]*2,c.halfExtents[2]*2),
      new THREE.MeshBasicMaterial({visible:false}));
    mesh.position.set(...c.translation);
    if(c.rotation) mesh.quaternion.set(...c.rotation);
    mesh.name=`SuzhouEntranceBlocker:${item.name}`;
    return mesh;
  });
}
export function createSuzhouGardenEnvironment({renderer=null,quality='low'}={}) {
  const q=QUALITY[quality]||QUALITY.low;
  const root=new THREE.Group();
  root.name='SuzhouGarden';
  root.userData.environment=SUZHOU_ID;
  const textures=buildTextures(undefined,q.texScale);
  const materials=buildMaterials(textures);
  const rendererProxy=renderer||{toneMappingExposure:1,shadowMap:{needsUpdate:false}};
  const sky=createSky(root,rendererProxy,materials);
  sky.setHour(WORLD.sunDefaultHour);
  sky.setQuality(q);
  const camera=new THREE.PerspectiveCamera();
  const lod=new LODManager(camera,root);
  const batch=new Batch(40);
  const sceneGroup=new THREE.Group();
  sceneGroup.name='园林建筑与假山';
  root.add(sceneGroup);
  const context={B:batch,M:materials,scene:root,plaques:[],lod,BatchClass:Batch,quality:q,waterfalls:[],streams:[],onProgress:()=>{}};
  buildBuildings(context);
  buildRockery(context);
  batch.build(sceneGroup);
  const nature=createNature(root,materials,context);
  const water=createWater(root,context);
  water.setSky(sky.getState());
  for(const group of [sceneGroup,nature.trunkGroup,nature.pathGroup]){
    if(group)lod.addBatchGroup(group);
  }
  lod.setQuality(q);
  const surface=createGround();
  const navigationRoot=new THREE.Group();
  navigationRoot.name='SuzhouGardenNavigation';
  navigationRoot.add(surface.mesh);
  const entranceBlockers=createEntranceBlockers();
  for(const blocker of entranceBlockers) navigationRoot.add(blocker);
  root.add(navigationRoot);
  root.traverse(node=>{if(node.isMesh&&node!==surface.mesh)node.userData.navigationIgnore=true;});
  for(const blocker of entranceBlockers) delete blocker.userData.navigationIgnore;
  let time=0, hour=WORLD.sunDefaultHour,weather='clear';
  let lastLodUpdate=0;
  sky.dome.onBeforeRender=(_renderer,_scene,activeCamera)=>{
    sky.update(time,activeCamera);
    water.setCamera(activeCamera);
    nature.update(time,activeCamera);
    lod.camera=activeCamera;
    const now=performance.now();
    if(now-lastLodUpdate>=250){
      lod.update((now-lastLodUpdate)/1000);
      lastLodUpdate=now;
    }
  };
  return {
    id:SUZHOU_ID,root,floor:surface.mesh,navigationRoot,colliders:[surface.collider,...SUZHOU_ENTRANCE_STRUCTURES.map((item)=>item.collider)],
    layout:{bounds:{min:[-150,-140],max:[150,160]},groundY:0,margin:2},
    camera:{position:POIS[0].pos,target:POIS[0].target,far:3200},
    rendering:{background:0x91a9c3,exposure:1.08,fog:root.fog},
    navigation:{agentRadius:0.3,agentHeight:1.7,maxSlope:45,maxClimb:0.4},
    views:POIS.map(item=>({id:item.id,label:item.name,position:item.pos,target:item.target})),
    setHour(next){hour=next;sky.setHour(next);water.setSky(sky.getState());},
    setWeather(next){
      if(!['clear','mist','rain'].includes(next))return;
      weather=next;sky.setWeather(next);nature.setWeather(next,sky.getState());water.setSky(sky.getState());
    },
    snapshot(){return {schemaVersion:1,hour,weather};},
    restore(value){
      if(value?.schemaVersion!==1)return false;
      if(Number.isFinite(value.hour))this.setHour(value.hour);
      if(typeof value.weather==='string')this.setWeather(value.weather);
      return true;
    },
    step(dt){time+=dt;water.setTime(time);},
    dispose(){
      lod.visMats.forEach(material=>material.dispose());
      for(const maps of Object.values(textures)){
        for(const texture of Object.values(maps))texture?.dispose?.();
      }
    }
  };
}

