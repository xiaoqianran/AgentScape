import * as THREE from 'three';
import { makeBook } from './book.js';
import { makeCooker } from './cooker.js';

export function createProject({container}) {
  const scene=new THREE.Scene();scene.background=new THREE.Color('#182431');
  const camera=new THREE.PerspectiveCamera(48,1,.1,100);
  camera.position.set(5,5,8);camera.lookAt(0,.75,0);
  const renderer=container?new THREE.WebGLRenderer({antialias:true})
    : {render(){},extensions:{has:()=>false},dispose(){}};
  if(container) {
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1,2));
    container.appendChild(renderer.domElement);
  }
  scene.add(new THREE.HemisphereLight(0xe5f5ff,0x45504e,2.8));
  const sunlight=new THREE.DirectionalLight(0xffe6c2,2.4);
  sunlight.position.set(3,8,6);scene.add(sunlight);
  const floor=new THREE.Mesh(new THREE.BoxGeometry(8,.18,5),
    new THREE.MeshStandardMaterial({color:'#3c5164',roughness:.9}));
  floor.position.y=-.09;scene.add(floor);
  const book=makeBook(),cooker=makeCooker();
  scene.add(book.object,cooker.object);
  let bookMachine,cookerMachine;
  const resize=()=>{
    if(!container)return;
    const width=container.clientWidth||800,height=container.clientHeight||600;
    renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
  };
  const observer=container && typeof ResizeObserver==='function'?new ResizeObserver(resize):null;
  observer?.observe(container);resize();
  return {scene,camera,renderer,
    setup({scene:api}) {
      bookMachine=api.registerStateMachine(book.machine);
      cookerMachine=api.registerStateMachine(cooker.machine);
    },
    update({dt}) { cookerMachine?.advance(Math.min(dt,10)); },
    // Deliberately no serialize/restore methods: both machines persist through
    // the host's project-owned machine snapshot, not a per-demo state hack.
    dispose() {
      observer?.disconnect();
      scene.traverse(object=>{object.geometry?.dispose();object.material?.dispose();});
      renderer.dispose();
    }
  };
}
