import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export async function mountModelPreview({ host, url, onReady = () => {} } = {}) {
  if (!host || !url) throw new TypeError('mountModelPreview requires host and url');
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.01, 1000);
  const renderer = new WebGLRenderer({ antialias:true, alpha:true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.replaceChildren(renderer.domElement);

  scene.add(new HemisphereLight(0xffffff, 0x25202c, 2.2));
  const key = new DirectionalLight(0xffffff, 3.2);
  key.position.set(3, 5, 4);
  scene.add(key);

  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;
  const box = new Box3().setFromObject(model);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  model.position.sub(center);
  scene.add(model);
  const extent = Math.max(size.x, size.y, size.z, 0.1);
  camera.near = Math.max(extent / 100, 0.01);
  camera.far = Math.max(extent * 30, 100);
  camera.position.set(extent * 1.45, extent * 0.95, extent * 1.55);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 0, 0);
  controls.update();

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  let disposed = false;
  let frame = 0;
  const render = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  onReady();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    controls.dispose();
    scene.traverse((object) => {
      object.geometry?.dispose?.();
      const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose?.();
        }
        material.dispose?.();
      }
    });
    renderer.dispose();
    host.replaceChildren();
  };
}
