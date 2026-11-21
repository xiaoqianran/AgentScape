import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import shaderSource from './shaders/pulse.glsl?raw';

/** The same source runs in ordinary Vite and in AgentScape Code Project. */
export function createProject({ container }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#101827');
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(2, 2, 4);
  camera.lookAt(0, 0, 0);
  const mainPart = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const detail = new THREE.BoxGeometry(0.35, 0.35, 0.35).translate(0, 1.0, 0);
  const geometry = mergeGeometries([mainPart, detail]);
  mainPart.dispose(); detail.dispose();
  const bvh = new MeshBVH(geometry);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshNormalMaterial());
  mesh.name = 'NpmBVHExample';
  scene.add(mesh);
  const renderer = container ? new THREE.WebGLRenderer({ antialias: true })
    : { render() {}, extensions: { has: () => false } };
  if (container) {
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 360);
    container.appendChild(renderer.domElement);
  }
  let turns = 0;
  return {
    scene, camera, renderer,
    setup({ scene: api }) {
      api.registerEntity({ id: 'npm_sculpture', object: mesh,
        read: () => ({ turns, shaderLength: shaderSource.length, bvhReady: Boolean(bvh) }) });
      api.registerAction({ target: 'npm_sculpture', name: 'spin',
        async execute() {
          const { spin } = await import('./lazy.js');
          spin(mesh); turns++;
        },
        verify({ before, after }) { return after.turns === before.turns + 1; }
      });
    },
    update({ dt }) { mesh.rotation.y += dt * 0.25; },
    serialize() { return { turns }; },
    restore(state) { turns = state.turns; },
    dispose() { geometry.dispose(); mesh.material.dispose(); renderer.dispose?.(); }
  };
}
