import * as THREE from 'three';
import { createPortal } from './portal.js';

// Ordinary multi-file Three.js. No Asset Recipe or authoring serialization.
export function createProject({ container, state }) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101727');
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 100);
  camera.position.set(9, 7, 12); camera.lookAt(0, 1, 0);
  const renderer = container ? new THREE.WebGLRenderer({ antialias: true }) : { render() {}, extensions: { has: () => false }, dispose() {} };
  if (container) { renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); container.appendChild(renderer.domElement); }
  scene.add(new THREE.HemisphereLight(0xc5dbff, 0x26302e, 3));
  const floor = new THREE.Mesh(new THREE.BoxGeometry(18, .2, 14), new THREE.MeshStandardMaterial({ color: '#34425b' }));
  floor.position.y = -.1; scene.add(floor);
  const portal = createPortal(); scene.add(portal.mesh);
  const traveller = new THREE.Mesh(new THREE.IcosahedronGeometry(.45, 1), new THREE.MeshStandardMaterial({ color: '#ffca78', metalness: .4, roughness: .3 }));
  traveller.name = 'ProjectTraveller'; scene.add(traveller);
  let uses = state?.uses ?? 0, zone = state?.zone ?? 'entrance', elapsed = state?.elapsed ?? 0;
  const updatePosition = () => traveller.position.set(zone === 'garden' ? 4 : -4, .8, 0);
  updatePosition();
  const resize = () => {
    if (!container) return;
    const width = container.clientWidth || 800, height = container.clientHeight || 600;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  };
  const observer = container && new ResizeObserver(resize); observer?.observe(container); resize();
  return { scene, camera, renderer,
    setup({ scene: api }) {
      api.registerEntity({ id: 'portal', label: '粒子传送门', object: portal.mesh,
        description: '项目自定义传送门。传送由项目逻辑执行，不代表物理步行。', read: () => ({ uses, pulse: portal.material.uniforms.pulse.value }) });
      api.registerEntity({ id: 'traveller', label: '旅行者', object: traveller,
        read: () => ({ zone, x: traveller.position.x }) });
      api.registerAction({ target: 'portal', name: 'teleport', description: '把旅行者传送至入口或花园。',
        parameters: { type: 'object', properties: { destination: { type: 'string', enum: ['entrance', 'garden'] } }, required: ['destination'], additionalProperties: false },
        execute({ destination }) { zone = destination; uses++; updatePosition(); return { destination }; },
        verify({ before, after, args }) { return { verified: after.uses === before.uses + 1 && zone === args.destination && traveller.position.x === (zone === 'garden' ? 4 : -4), zone }; },
      });
      api.registerAction({ target: 'portal', name: 'pulse', description: '改变 Shader 亮度；没有独立验证器。',
        parameters: { type: 'object', properties: { brightness: { type: 'number', minimum: .1, maximum: 3 } }, required: ['brightness'], additionalProperties: false },
        execute({ brightness }) { portal.material.uniforms.pulse.value = brightness; },
      });
    },
    update({ dt }) { elapsed += dt; portal.material.uniforms.time.value = elapsed; portal.particles.rotation.z = elapsed * .2; traveller.rotation.y += dt; },
    serialize() { return { uses, zone, elapsed, pulse: portal.material.uniforms.pulse.value }; },
    restore(saved) { if (!saved) return; uses = saved.uses; zone = saved.zone; elapsed = saved.elapsed; portal.material.uniforms.pulse.value = saved.pulse; updatePosition(); },
    dispose() { observer?.disconnect(); scene.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); }); renderer.dispose(); },
  };
}
