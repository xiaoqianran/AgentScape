import * as THREE from 'three';
import { WORLD, QUALITY, POIS, Batch, resetWorldSeed, buildTextures, buildMaterials } from './core.js';
import { buildBuildings } from './buildings.js';
import { createNature, terrainHeight } from './nature.js';
import { createSky } from './sky.js';
import { createWater } from './water.js';

// Geometry and shaders originate from the standalone Yuanmingyuan scene.
// This adapter owns no renderer, camera, or animation loop: AgentScape does.
const ID = 'yuanmingyuan-western-mansions';

function makeGroundProxy() {
  // Navigation and physics use a coarse surface, never the high-detail visual geometry.
  const geometry = new THREE.PlaneGeometry(WORLD.groundSize[0], WORLD.groundSize[1], 48, 36);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.getAttribute('position');
  for (let index = 0; index < position.count; index++) {
    position.setY(index, terrainHeight(position.getX(index), position.getZ(index)));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ visible:false }));
  mesh.name = 'YuanmingyuanGroundProxy';
  mesh.userData.navigationIgnore = false;
  const vertices = Array.from(geometry.getAttribute('position').array);
  const indices = Array.from(geometry.getIndex().array);
  return { mesh, collider:{ shape:'trimesh', vertices, indices } };
}

export function createYuanmingyuanEnvironment({ renderer = null, quality = 'medium', seed = 18601018 } = {}) {
  resetWorldSeed(seed);
  const preset = QUALITY[quality] || QUALITY.medium;
  const root = new THREE.Group();
  root.name = 'YuanmingyuanWesternMansions';
  root.userData.environment = ID;

  const textures = buildTextures(undefined, preset.texScale);
  const materials = buildMaterials(textures);
  const shadingRenderer = renderer || { toneMappingExposure:1.16, shadowMap:{ needsUpdate:false } };
  const sky = createSky(root, shadingRenderer);
  sky.setHour(WORLD.sunDefaultHour);

  const ruin = new THREE.Group(); ruin.name = '遗址本体';
  const restored = new THREE.Group(); restored.name = '复原构件';
  const ruinOnly = new THREE.Group(); ruinOnly.name = '仅遗址态残墙';
  ruinOnly.visible = false;
  root.add(ruin, restored, ruinOnly);
  const ctx = {
    ruin:new Batch(38), rest:new Batch(38), ruinOnly:new Batch(38),
    M:materials, jets:[], waters:[], rubble:[], labels:[]
  };
  buildBuildings(ctx);
  ctx.ruin.build(ruin);
  ctx.rest.build(restored);
  ctx.ruinOnly.build(ruinOnly);

  const nature = createNature(root, materials, ctx);
  nature.applyQuality(preset);
  const water = createWater(root, sky, ctx);
  water.setPixelRatio(renderer?.getPixelRatio?.() || 1);

  // The procedural sky always follows the active AgentScape camera.
  sky.sky.onBeforeRender = (_renderer, _scene, camera) => sky.sky.position.copy(camera.position);
  root.traverse(node => { if (node.isMesh) node.userData.navigationIgnore = true; });
  const ground = makeGroundProxy();
  ground.mesh.userData.navigationIgnore = false;
  const navigationRoot = new THREE.Group();
  navigationRoot.name = 'YuanmingyuanNavigation';
  navigationRoot.add(ground.mesh);
  root.add(navigationRoot);

  let currentHour = WORLD.sunDefaultHour;
  let isRestored = true;
  return {
    id:ID,root,floor:ground.mesh,navigationRoot,
    colliders:[ground.collider],
    layout:{bounds:{min:[WORLD.bounds.minX,WORLD.bounds.minZ],max:[WORLD.bounds.maxX,WORLD.bounds.maxZ]},groundY:0,margin:2},
    camera:{position:POIS[0].pos,target:POIS[0].target,far:3000},
    rendering:{background:0x91a9c3,exposure:1.16,fog:sky.fog},
    navigation:{agentRadius:0.3,agentHeight:1.7,maxSlope:45,maxClimb:0.4},
    views:POIS.map(item=>({id:item.id,label:item.name,position:item.pos,target:item.target})),
    setHour(hour) { currentHour=hour;sky.setHour(hour); },
    setRestore(value) {
      isRestored=Boolean(value);
      restored.visible=isRestored;
      ruinOnly.visible=!isRestored;
      water.drops.visible=isRestored;
      water.ribbons.visible=isRestored;
      water.curtains.forEach(mesh=>{mesh.visible=isRestored});
    },
    snapshot() { return {schemaVersion:1, hour:currentHour, restored:isRestored, seed}; },
    restore(state) {
      if(state?.schemaVersion!==1) return false;
      if(Number.isFinite(state.hour)) this.setHour(state.hour);
      if(typeof state.restored==='boolean') this.setRestore(state.restored);
      return true;
    },
    step(dt) { sky.uniforms.uTime.value+=dt;water.update(dt,sky); },
    dispose() {}
  };
}
