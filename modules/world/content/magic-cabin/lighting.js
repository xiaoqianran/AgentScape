import * as THREE from 'three';

// A bounded native-light rig works on the production WebGPU/WebGL material path.
// Decorative glows retain the source animation; only these three emit local light.
export function createCabinLighting(root, uniforms) {
  const group=new THREE.Group();group.name='CabinLighting';
  const sky=new THREE.HemisphereLight(0xfff3dd,0x78819a,1.5);
  const sun=new THREE.DirectionalLight(0xffedcc,2.2);
  sun.position.set(7,12,-8);sun.castShadow=true;
  sun.shadow.mapSize.set(1024,1024);
  Object.assign(sun.shadow.camera,{left:-9,right:9,top:9,bottom:-9,near:1,far:35});
  sun.shadow.normalBias=.025;
  const fire=new THREE.PointLight(0xffaa66,0,6,2);
  const chandelier=new THREE.PointLight(0xffd29d,0,4,2);
  const table=new THREE.PointLight(0xffb066,0,3,2);
  fire.name='CabinFireLight';chandelier.name='CabinChandelierLight';table.name='CabinTableLight';
  group.add(sky,sun,fire,chandelier,table);root.add(group);
  return {
    update() {
      fire.position.copy(uniforms.uFireCenter.value);fire.intensity=12*uniforms.uFireStrength.value;
      chandelier.position.copy(uniforms.uLampCenter.value);chandelier.intensity=9*uniforms.uLampStrength.value;
      table.position.copy(uniforms.uPtPos.value[0]);table.intensity=6*uniforms.uPtCfg.value[0].y;
    },
    dispose() {sun.shadow.dispose();group.removeFromParent();}
  };
}
