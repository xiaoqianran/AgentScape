import * as THREE from 'three';
import { WORLD, QUALITY, Batch, buildTextures, buildMaterials } from './src/core.js';
import { terrainHeight, createTerrain } from './src/terrain.js';
import { buildCity } from './src/city.js';
import { buildDams } from './src/dams.js';
import { createRevetment } from './src/detail.js';
import { createNature } from './src/nature.js';
import { createSky } from './src/sky.js';
import { buildWaterMasks } from './src/hydro.js';
import { createWater } from './src/water.js';

// The original CNB application owns its own renderer, camera, input and RAF.
// This adapter transfers only the scene content to AgentScape's shared Runtime.
export const LIANGZHU_ID = 'liangzhu-ancient-city';

const VIEWS = [
  { id:'aerial', label:'全城航拍', position:[1500,1350,2100], target:[-100,6,-100] },
  { id:'palace', label:'莫角山宫殿', position:[540,118,660], target:[0,12,-60] },
  { id:'wall', label:'城墙与水门', position:[1240,52,120], target:[885,7,-450] },
  { id:'reservoir', label:'高坝库区', position:[-2200,560,-1500], target:[-3100,10,-3000] },
  { id:'highdam', label:'谷口高坝', position:[-3400,520,-3550], target:[-4200,32,-4200] },
  { id:'wetland', label:'城东湿地', position:[2300,420,1100], target:[2750,2.6,300] },
];

function createNavigationSurface() {
  // Simplified navigable terrain: visual mesh is never used as a physics collider.
  const xSize = 2800, zSize = 3000, nx = 42, nz = 44;
  const geometry = new THREE.PlaneGeometry(xSize, zSize, nx, nz);
  geometry.rotateX(-Math.PI / 2);
  const positions = geometry.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    positions.setY(i, terrainHeight(positions.getX(i), positions.getZ(i)));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible:false }));
  mesh.name = 'LiangzhuNavigationSurface';
  mesh.userData.navigationIgnore = false;
  return {
    mesh,
    collider:{
      shape:'trimesh',
      vertices:Array.from(positions.array),
      indices:Array.from(geometry.getIndex().array)
    }
  };
}

export function createLiangzhuEnvironment({ renderer=null, quality='low' } = {}) {
  const preset = QUALITY[quality] || QUALITY.low;
  const root = new THREE.Group();
  root.name = 'LiangzhuAncientCity';
  root.userData.environment = LIANGZHU_ID;

  const textures = buildTextures(undefined, preset.texScale);
  const materials = buildMaterials(textures);
  const rendererProxy = renderer || { toneMappingExposure:1, shadowMap:{ needsUpdate:false } };
  const sky = createSky(root, rendererProxy, materials, preset);
  sky.setHour(WORLD.sunDefaultHour);
  const terrain = createTerrain(root, materials, preset);

  const staticGroup = new THREE.Group();
  staticGroup.name = '良渚城址和水利工程';
  root.add(staticGroup);
  const batch = new Batch(180);
  const context = { B:batch, M:materials, scene:root, revet:[], q:preset, onProgress:()=>{} };
  buildCity(context);
  buildDams(context);
  batch.build(staticGroup);
  createRevetment(root, materials, context.revet, preset.cobble);
  const nature = createNature(root, materials, preset);
  const water = createWater(root, buildWaterMasks(preset), preset);
  water.setSky(sky.getState());
  water.setWind(0.75);

  const navigation = createNavigationSurface();
  const navigationRoot = new THREE.Group();
  navigationRoot.name = 'LiangzhuNavigation';
  navigationRoot.add(navigation.mesh);
  root.add(navigationRoot);
  root.traverse(node => {
    if (node.isMesh && node !== navigation.mesh) node.userData.navigationIgnore = true;
  });

  let time = 0;
  // The renderer supplies the active camera at draw time; Runtime.step does not.
  sky.dome.onBeforeRender = (_renderer,_scene,camera) => {
    sky.update(time,camera);
    water.setCamera(camera);
    nature.update(time,camera);
  };
  let currentHour = WORLD.sunDefaultHour;
  let weather = 'mist';
  // Mirror the original sky fog into AgentScape's rendering settings.
  return {
    id:LIANGZHU_ID, root, floor:navigation.mesh, navigationRoot,
    colliders:[navigation.collider],
    layout:{bounds:{min:[-1400,-1500],max:[1400,1500]},groundY:4.2,margin:2},
    camera:{position:VIEWS[0].position,target:VIEWS[0].target,far:WORLD.far},
    rendering:{background:0xaebfbb,exposure:1.0,fog:root.fog},
    navigation:{agentRadius:0.3,agentHeight:1.7,maxSlope:45,maxClimb:0.4},
    views:VIEWS,
    setHour(hour) {
      currentHour=hour;
      sky.setHour(hour);
      water.setSky(sky.getState());
    },
    setWeather(next) {
      if (!['clear','mist','rain'].includes(next)) return;
      weather=next;
      sky.setWeather(next);
      nature.setWeather(next);
      water.setSky(sky.getState());
      water.setWind(next==='rain' ? 1.4 : 0.75);
    },
    snapshot(){ return {schemaVersion:1,hour:currentHour,weather}; },
    restore(state){
      if(state?.schemaVersion!==1) return false;
      if(Number.isFinite(state.hour)) this.setHour(state.hour);
      if(typeof state.weather==='string') this.setWeather(state.weather);
      return true;
    },
    step(dt) {
      time += dt;
      water.setTime(time);
    },
    dispose(){
      // Scene root lifecycle owns the meshes; textures are generated for this Environment.
      for(const maps of Object.values(textures)) {
        for(const texture of Object.values(maps)) texture?.dispose?.();
      }
    }
  };
}

