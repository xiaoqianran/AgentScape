import * as THREE from 'three';
import { AgentScape } from '../../sdk/typescript/src/index.ts';

/**
 * Framework-neutral example host. React and Vue only own mount/unmount;
 * the existing Three.js renderer, loop and resources stay host-owned.
 */
export function createNativeWorldHost(container, reportStatus) {
  if (!container) throw new TypeError('Native world needs a mounted container');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#1c2e3b');
  const width = Math.max(container.clientWidth, 320);
  const height = 420;
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 80);
  camera.position.set(7, 5, 9);
  camera.lookAt(0, 1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(16, 0.2, 16),
    new THREE.MeshStandardMaterial({ color: '#637c70' })
  );
  floor.position.y = -0.1;
  floor.name = 'FrameworkFloor';
  scene.add(floor, new THREE.HemisphereLight(0xffffff, 0x61717d, 2));

  const landmark = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 2, 0.8),
    new THREE.MeshStandardMaterial({ color: '#edbc6c' })
  );
  landmark.name = 'FrameworkLandmark';
  landmark.position.set(-2, 1, -1);
  scene.add(landmark);

  let session = null;
  let pending = null;
  let frameId = null;
  let disposed = false;
  let cleaned = false;
  const report = value => { if (!disposed) reportStatus(value); };

  const tick = time => {
    if (disposed) return;
    landmark.rotation.y = time / 2200;
    session?.scene.frame(time);
    renderer.render(scene, camera);
    frameId = requestAnimationFrame(tick);
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    session?.close();
    session = null;
    scene.remove(floor, landmark);
    floor.geometry.dispose();
    floor.material.dispose();
    landmark.geometry.dispose();
    landmark.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  const host = {
    scene, camera, renderer, landmark,
    get session() { return session; },
    start() {
      if (pending) return pending;
      frameId = requestAnimationFrame(tick);
      pending = (async () => {
        try {
          const attached = await AgentScape.attach({
            scene, camera, renderer, autoStart: false,
            walkableMesh: floor,
            nativeObjects: [{
              id: 'host:landmark', object: landmark, label: '原生地标',
              activate: () => landmark.material.color.set('#65bcf2')
            }]
          });
          if (disposed) { attached.close(); return; }
          session = attached;
          await attached.scene.addModel({
            id: 'framework_cup', asset: 'builtin://cup', position: [1, 2, 0]
          });
          report('ready');
        } catch (error) {
          report('error:' + (error.code || error.message));
        } finally {
          if (disposed) cleanup();
        }
      })();
      return pending;
    },
    detach() {
      if (!session || disposed) return;
      session.close();
      session = null;
      report('detached');
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId != null) cancelAnimationFrame(frameId);
      if (!pending) cleanup();
      else void pending.finally(cleanup);
    }
  };
  return host;
}
