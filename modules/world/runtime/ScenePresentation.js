import * as THREE from 'three';
import * as z from 'zod/v4';

const vector=z.tuple([z.number().finite().min(-100000).max(100000),z.number().finite().min(-100000).max(100000),z.number().finite().min(-100000).max(100000)]);
const name=z.string().trim().min(1).max(100);
const color=z.string().regex(/^#[a-fA-F0-9]{6}$/);
const lightBase={name:name.optional(),color:color.default('#ffffff'),intensity:z.number().finite().min(0).max(100000),position:vector};
const directed={target:vector};
const lightSchema=z.discriminatedUnion('type',[
  z.object({...lightBase,...directed,type:z.literal('directional')}).strict(),
  z.object({...lightBase,type:z.literal('point'),distance:z.number().finite().min(0).default(0)}).strict(),
  z.object({...lightBase,...directed,type:z.literal('spot'),distance:z.number().finite().min(0).default(0),
    angle:z.number().positive().max(Math.PI/2).default(Math.PI/4),penumbra:z.number().min(0).max(1).default(0)}).strict()
]);
export const presentationCameraSchema=z.object({
  name:name.default('Camera'),position:vector,target:vector,fov:z.number().min(10).max(110).default(45),
  aspect:z.number().positive().max(10).default(16/9),near:z.number().positive().default(.1),far:z.number().positive().default(1000)
}).strict();
export const presentationLightsSchema=z.array(lightSchema).max(16);
export const scenePresentationSchema=z.object({
  camera:presentationCameraSchema.nullable().default(null),
  lights:presentationLightsSchema.default([])
}).strict();

const fail=code=>Object.assign(new Error(code),{code});
const coincident=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))<1e-6;
export function parseScenePresentation(input={}){
  const state=scenePresentationSchema.parse(input);
  if(state.camera){
    if(state.camera.far<=state.camera.near)throw fail('SCENE_EXPORT_CAMERA_INVALID');
    if(coincident(state.camera.position,state.camera.target))throw fail('SCENE_EXPORT_DIRECTION_INVALID');
  }
  for(const light of state.lights)
    if(light.target&&coincident(light.position,light.target))throw fail('SCENE_EXPORT_DIRECTION_INVALID');
  return state;
}

function aim(object,target){
  object.lookAt(new THREE.Vector3(...target));
  if(object.target){object.target.position.set(0,0,-1);object.add(object.target);}
}

/** Same construction for a live world and its detached visual export. */
export function buildPresentationGroup(input){
  const state=parseScenePresentation(input);
  const root=new THREE.Group();
  root.name='AgentScapePresentation';
  if(state.camera){
    const c=state.camera;
    const camera=new THREE.PerspectiveCamera(c.fov,c.aspect,c.near,c.far);
    camera.name=c.name;camera.position.fromArray(c.position);aim(camera,c.target);root.add(camera);
  }
  for(const l of state.lights){
    const light=l.type==='directional'?new THREE.DirectionalLight(l.color,l.intensity):
      l.type==='point'?new THREE.PointLight(l.color,l.intensity,l.distance,2):
      new THREE.SpotLight(l.color,l.intensity,l.distance,l.angle,l.penumbra,2);
    light.name=l.name??l.type;light.position.fromArray(l.position);
    if(l.target)aim(light,l.target);
    root.add(light);
  }
  return {state,root};
}

/** World-owned rig, independent of navigation cameras and environment-owned lighting.
 * Data is authoritative; Three objects are a replaceable projection of that data. */
export class ScenePresentation {
  #state=null;
  #root=null;
  constructor(scene){this.scene=scene;}
  snapshot(){return this.#state?structuredClone(this.#state):null;}
  replace(input={}){
    const {state,root}=buildPresentationGroup(input);
    this.#root?.removeFromParent();
    this.#root=root.children.length?root:null;
    this.#state=this.#root?state:null;
    if(this.#root)this.scene.add(this.#root);
    return this.snapshot();
  }
  dispose(){
    this.#root?.removeFromParent();this.#root=null;this.#state=null;
  }
}
