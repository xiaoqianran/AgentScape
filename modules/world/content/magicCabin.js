import * as THREE from 'three';
import { createMagicCabinContents } from './magic-cabin/cabinContents.js';
import { disposeObject3D } from '../../rendering/disposeObject3D.js';
import { createCabinLighting } from './magic-cabin/lighting.js';

export function meshCollider(mesh, inverse = null) {
  const geometry = mesh.geometry;
  const positions = geometry.getAttribute('position');
  const matrix = inverse ? inverse.clone().multiply(mesh.matrixWorld) : mesh.matrixWorld;
  const point = new THREE.Vector3();
  const vertices = [];
  for (let i=0;i<positions.count;i++) point.fromBufferAttribute(positions,i).applyMatrix4(matrix).toArray(vertices,i*3);
  return { shape:'trimesh', vertices, indices:geometry.index ? Array.from(geometry.index.array) : Array.from({length:positions.count},(_,i)=>i) };
}

export function createMagicCabin(options = {}) {
  const content = createMagicCabinContents(options);
  const { root } = content;
  root.name = 'MagicCabin';
  root.userData.environment = 'magic-cabin';
  const palette=new Set();
  root.traverse(node=>{
    if(node.isMesh && node.material?.isMeshStandardMaterial)node.receiveShadow=true;
    for(const material of (Array.isArray(node.material)?node.material:[node.material])) {
      if(material?.uniforms?.uTint) palette.add(material);
    }
  });
  const lighting=createCabinLighting(root,[...palette][0].uniforms);
  root.updateMatrixWorld(true);
  // Only architecture and explicit furniture volumes feed navigation. Tiny animated
  // ornaments must not turn the navigation build into tens of thousands of obstacles.
  root.traverse(node => { node.userData.navigationIgnore = true; });
  const colliders = [];
  for (const object of content.architectureRoots) object.traverse(node => {
    node.updateMatrix();
    node.matrixAutoUpdate=false;
    if (!node.isMesh) return;
    node.castShadow=true;
    node.userData.navigationIgnore = false;
    colliders.push(meshCollider(node));
  });
  const floor = root.children.find(node=>node.isMesh && node.geometry.type==='PlaneGeometry');
  const proxies = new THREE.Group();
  proxies.name = 'CabinFurnitureCollision';
  const proxyMaterial = new THREE.MeshBasicMaterial({ visible:false });
  for (const box of content.platformBoxes) {
    const bottom = box.bot || 0;
    const size = [box.x2-box.x1,box.top-bottom,box.z2-box.z1];
    const position = [(box.x1+box.x2)/2,(bottom+box.top)/2,(box.z1+box.z2)/2];
    colliders.push({shape:'box',halfExtents:size.map(value=>value/2),translation:position});
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(...size),proxyMaterial);
    proxy.position.set(...position);
    proxy.userData.cabinCollisionProxy = true;
    proxies.add(proxy);
  }
  root.add(proxies);
  // Hinge geometry is kept out of the static bake and follows its source animation.
  const moving = content.interactions.filter(item=>item.id.startsWith('cabin:hinge:')).map(item=>{
    const inverse = item.object.matrixWorld.clone().invert();
    const shapes = [];
    item.object.traverse(node=>{if(node.isMesh) { node.userData.navigationIgnore=false; shapes.push(meshCollider(node,inverse)); }});
    return {...item,shapes,body:null,lastPosition:new THREE.Vector3(Infinity,Infinity,Infinity),lastRotation:new THREE.Quaternion()};
  });
  for(const [index,platform] of content.movingPlatforms.entries()) {
    const bottom=platform.bot || 0;
    const half=[platform.hx,(platform.top-bottom)/2,platform.hz];
    const proxy=new THREE.Mesh(new THREE.BoxGeometry(...half.map(value=>value*2)),proxyMaterial);
    proxy.userData.cabinCollisionProxy=true;
    proxy.position.set(platform.g.position.x,(bottom+platform.top)/2,platform.g.position.z);
    proxies.add(proxy);
    moving.push({id:`cabin:platform:${index}`,object:proxy,platform,body:null,lastPosition:new THREE.Vector3(Infinity,Infinity,Infinity),lastRotation:new THREE.Quaternion(),shapes:[{shape:'box',halfExtents:half}]});
  }
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  let cutaway = true;
  let physicsWorld=null;
  const work={steps:0,colliderPoseUpdates:0,navigationInvalidations:0};
  const environment = {
    id:'magic-cabin',root,floor,colliders,
    layout:{bounds:{min:[-11,-11],max:[11,11]},groundY:0,margin:1},
    camera:{position:[13,10,-15],target:[0,2.5,0]},
    rendering:{background:0xfdfbf6,fog:{color:0xfdfbf6,near:40,far:80},exposure:1},
    // 旋转楼梯步进偏高；Recast 需允许更大爬升，否则 character controller 上不了二楼。
    navigation:{ maxClimb:0.65, maxSlope:55, maxSnapDistance:0.75, endTolerance:0.35, agentRadius:0.28, agentHeight:1.75 },
    // Rapier/KCC 默认 autostep 0.3m，旋转楼梯上不去。
    physics:{ characterController:{ autostepHeight:0.55, autostepMinWidth:0.22, snapToGround:0.45, maxSlopeClimbAngle:1.0 } },
    interactions:content.interactions,
    affordances:content.affordances,
    setCamera:content.setCamera,
    views:[['全景',[13,10,-15],[0,2.5,0]],['一楼',[7,3,-7],[0,1.1,0]],['二楼',[7,7,-7],[0,4.1,0]]].map(([label,position,target])=>({label,position,target})),
    catalog:{
      label:'寻找可交互物件',
      // Repeated fireplace nodes share one catalog entry; small props are labeled by storey.
      groupOf:(item)=>item.id.startsWith('cabin:fire:')?'cabin:fire':null,
      labelOf:(item,center)=>center.y>=3.1?'二楼':'一楼 / 屋外'
    },
    storageKey:'agentscape.cabin.text.v1',
    setCutaway(value) { cutaway=Boolean(value); content.setCutaway(cutaway); },
    snapshot() { return {schemaVersion:1,cutaway,text:content.textState(),affordances:Object.fromEntries(content.affordances.map(entry=>[entry.id,entry.capture()]))}; },
    validateSnapshot(state) {
      if(state?.schemaVersion!==1 || typeof state.cutaway!=='boolean')throw new TypeError('Invalid cabin snapshot');
      if(state.text!=null && (typeof state.text!=='object' || Array.isArray(state.text)))throw new TypeError('Invalid cabin text');
      if(state.affordances!=null && (typeof state.affordances!=='object' || Array.isArray(state.affordances)))throw new TypeError('Invalid cabin affordances');
      if(state.text?.notes!=null && !Array.isArray(state.text.notes))throw new TypeError('Invalid cabin notes');
      for(const entry of content.affordances) {
        const saved=state.affordances?.[entry.id];
        if(saved!==undefined && !entry.validateSnapshot(saved))throw new TypeError(`Invalid affordance snapshot: ${entry.id}`);
      }
      return true;
    },
    restore(state) { if(state?.schemaVersion===1) {
      environment.validateSnapshot(state);
      content.resetPendingAnimations();
      environment.setCutaway(state.cutaway); content.restoreText(state.text || {});
      for(const entry of content.affordances) if(state.affordances?.[entry.id])entry.restore(state.affordances[entry.id]);
      return true;
    } },
    diagnostics() {return {...work,affordanceCount:content.affordances.length,movingColliderGroups:moving.length};},
    step(dt, {physics,navigation} = {}) {
      work.steps++;
      if(physics && physicsWorld!==physics.world) {
        physicsWorld=physics.world;
        for(const item of moving){item.body=null;item.lastPosition.set(Infinity,Infinity,Infinity);}
      }
      content.update(dt);
      lighting.update();
      for(const material of palette) material.color.copy(material.uniforms.uTint.value).multiply(material.uniforms.uColor.value);
      for(const item of moving) if(item.platform) {
        const platform=item.platform;
        item.object.position.set(platform.g.position.x,((platform.bot || 0)+platform.top)/2,platform.g.position.z);
      }
      let navigationChanged=false;
      for (const item of moving) {
        item.object.getWorldPosition(position);
        item.object.getWorldQuaternion(rotation);
        if (!item.body && physics) item.body = physics.addEnvironment(item.shapes,{id:item.id});
        if (item.body && (position.distanceToSquared(item.lastPosition)>1e-8 || rotation.angleTo(item.lastRotation)>1e-4)) {
          physics.setEnvironmentPose(item.body,{position:position.toArray(),rotation:rotation.toArray()});
          item.lastPosition.copy(position);item.lastRotation.copy(rotation);
          work.colliderPoseUpdates++;
          navigationChanged=true;
        }
      }
      if(navigationChanged){navigation?.invalidate('environment-interaction');work.navigationInvalidations++;}
    },
    dispose() { lighting.dispose();content.dispose(); disposeObject3D(root); }
  };
  return environment;
}
