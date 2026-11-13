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
  root.add(navigationRoot);
  root.traverse(node=>{if(node.isMesh&&node!==surface.mesh)node.userData.navigationIgnore=true;});
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
    id:SUZHOU_ID,root,floor:surface.mesh,navigationRoot,colliders:[surface.collider],
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

