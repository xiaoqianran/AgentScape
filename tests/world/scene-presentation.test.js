import { expect,it } from 'vitest';
import * as THREE from 'three';
import { ScenePresentation } from '../../modules/world/runtime/ScenePresentation.js';
import { SceneSerializer } from '../../modules/world/runtime/SceneSerializer.js';

it('owns one live rig without mutating the viewport or environment lights',()=>{
  const scene=new THREE.Scene(),environmentLight=new THREE.AmbientLight();
  scene.add(environmentLight);
  const rig=new ScenePresentation(scene);
  const camera={name:'Shot',position:[4,3,2],target:[0,0,0],fov:40};
  const light={type:'directional',name:'Sun',position:[2,5,2],target:[0,0,0],intensity:3};
  const state=rig.replace({camera,lights:[light]});
  const root=scene.getObjectByName('AgentScapePresentation');
  expect(root.children).toHaveLength(2);
  expect(root.getObjectByName('Shot').isPerspectiveCamera).toBe(true);
  expect(root.getObjectByName('Sun').isDirectionalLight).toBe(true);
  state.camera.position[0]=999;
  expect(rig.snapshot().camera.position).toEqual([4,3,2]);
  expect(()=>rig.replace({camera:{...camera,near:10,far:1}})).toThrow('SCENE_EXPORT_CAMERA_INVALID');
  expect(scene.getObjectByName('AgentScapePresentation')).toBe(root);
  rig.replace({lights:[light]});
  expect(scene.children).toHaveLength(2);
  expect(root.parent).toBeNull();
  expect(scene.getObjectByName('Shot')).toBeUndefined();
  rig.replace({});
  expect(scene.children).toEqual([environmentLight]);
  expect(rig.snapshot()).toBeNull();
  rig.replace({camera});
  rig.dispose();
  expect(scene.children).toEqual([environmentLight]);
});

it('validates presentation before an imported snapshot can mutate its world',()=>{
  const serializer=new SceneSerializer();
  const base={schema:'agentscape.scene',schemaVersion:1,objects:[],assets:[]};
  expect(serializer.validate(base)).toBe(base);
  expect(()=>serializer.validate({...base,presentation:{camera:{position:[0,0,0],target:[0,0,0]}}})).toThrow('SCENE_EXPORT_DIRECTION_INVALID');
  expect(()=>serializer.validate({...base,presentation:{lights:[{type:'point',position:[0,0,0],intensity:-1}]}})).toThrow();
});
