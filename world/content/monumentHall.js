import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export const MONUMENT_HALL_ASSETS = Object.freeze({
  hdri: 'assets/monument-hall/solitude_interior_1k.hdr',
  marbleDiffuse: 'assets/monument-hall/marble_diff_1k.jpg',
  marbleNormal: 'assets/monument-hall/marble_nor_gl_1k.jpg',
  marbleRoughness: 'assets/monument-hall/marble_rough_1k.jpg'
});

const COLUMN_Z = [-8, -4, 0, 4, 8];
const stoneColor = 0xb9b8b2;
const box = (halfExtents, translation) => ({ shape: 'box', halfExtents, translation });
const cylinder = (radius, halfHeight, translation) => ({ shape: 'cylinder', radius, halfHeight, translation });

export const MONUMENT_HALL_COLLIDERS = Object.freeze([
  box([16, 0.15, 12], [0, -0.15, 0]),
  box([0.2, 4.5, 12], [-15.8, 4.5, 0]),
  box([0.2, 4.5, 12], [15.8, 4.5, 0]),
  box([6.625, 4.5, 0.2], [-9.375, 4.5, -11.8]),
  box([6.625, 4.5, 0.2], [9.375, 4.5, -11.8]),
  box([2.75, 1.8, 0.2], [0, 7.2, -11.8]),
  ...[-8, 8].flatMap((x) => COLUMN_Z.map((z) => cylinder(0.48, 3.8, [x, 3.8, z]))),
  cylinder(2.2, 0.35, [0, 0.35, -5])
]);

const mesh = (geometry, material, { position, name, castShadow = true, receiveShadow = true, navigationIgnore = false } = {}) => {
  const value = new THREE.Mesh(geometry, material);
  if (position) value.position.set(...position);
  value.name = name || '';
  value.castShadow = castShadow;
  value.receiveShadow = receiveShadow;
  if (navigationIgnore) value.userData.navigationIgnore = true;
  return value;
};

const prepareTiling = (texture, repeat, color = false) => {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
};

export function createMonumentHall({ scene, loadAssets = true } = {}) {
  const root = new THREE.Group();
  root.name = 'MonumentHall';
  root.userData.environment = 'monument-hall';

  const marble = new THREE.MeshStandardMaterial({ color: 0xc8c5bd, roughness: 0.42, metalness: 0.02 });
  const stone = new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.68, metalness: 0.01 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.76 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x8b6840, roughness: 0.28, metalness: 0.72 });
  const coreMaterial = new THREE.MeshPhysicalMaterial({ color: 0x19243a, roughness: 0.15, metalness: 0.88, clearcoat: 0.8, clearcoatRoughness: 0.12 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x91b8ff, emissive: 0x3e72c5, emissiveIntensity: 5.2, metalness: 0.35, roughness: 0.22 });

  const floor = mesh(new THREE.BoxGeometry(32, 0.3, 24), marble, { position: [0, -0.15, 0], name: 'MonumentFloor', castShadow: false });
  root.add(floor);

  const sideWallGeometry = new THREE.BoxGeometry(0.4, 9, 24);
  root.add(
    mesh(sideWallGeometry, darkStone, { position: [-15.8, 4.5, 0], name: 'WestWall', castShadow: false }),
    mesh(sideWallGeometry.clone(), darkStone, { position: [15.8, 4.5, 0], name: 'EastWall', castShadow: false })
  );

  const backPanel = new THREE.BoxGeometry(13.25, 9, 0.4);
  root.add(
    mesh(backPanel, stone, { position: [-9.375, 4.5, -11.8], name: 'BackWallWest', castShadow: false }),
    mesh(backPanel.clone(), stone, { position: [9.375, 4.5, -11.8], name: 'BackWallEast', castShadow: false }),
    mesh(new THREE.BoxGeometry(5.5, 3.6, 0.4), darkStone, { position: [0, 7.2, -11.8], name: 'PortalLintel', castShadow: false })
  );

  const columnGeometry = new THREE.CylinderGeometry(0.48, 0.55, 7.6, 24);
  const plinthGeometry = new THREE.CylinderGeometry(0.72, 0.78, 0.22, 24);
  for (const x of [-8, 8]) {
    for (const z of COLUMN_Z) {
      root.add(
        mesh(columnGeometry.clone(), stone, { position: [x, 3.8, z], name: `Column_${x}_${z}` }),
        mesh(plinthGeometry.clone(), bronze, { position: [x, 0.11, z], name: `Plinth_${x}_${z}`, castShadow: false })
      );
    }
  }

  const beamGeometry = new THREE.BoxGeometry(17.2, 0.32, 0.45);
  for (const z of [-8, 0, 8]) {
    root.add(mesh(beamGeometry.clone(), darkStone, { position: [0, 8.1, z], name: `Beam_${z}`, navigationIgnore: true }));
    root.add(mesh(new THREE.BoxGeometry(10, 0.035, 0.08), glow, { position: [0, 7.92, z], name: `LightLine_${z}`, castShadow: false, receiveShadow: false, navigationIgnore: true }));
  }

  const dais = mesh(new THREE.CylinderGeometry(2.2, 2.35, 0.7, 48), stone, { position: [0, 0.35, -5], name: 'MonumentDais' });
  root.add(dais);

  const sculpture = new THREE.Group();
  sculpture.name = 'AstraMonument';
  sculpture.position.set(0, 3.05, -5);
  sculpture.userData.navigationIgnore = true;
  const core = mesh(new THREE.IcosahedronGeometry(1.15, 3), coreMaterial, { name: 'AstraCore', navigationIgnore: true });
  core.rotation.set(0.35, 0.55, -0.2);
  sculpture.add(core);
  for (const [radius, tube, rx, ry] of [[1.7, 0.055, 1.15, 0.3], [2.0, 0.045, 0.55, -0.7], [1.45, 0.04, -0.6, 0.95]]) {
    const ring = mesh(new THREE.TorusGeometry(radius, tube, 12, 72), glow, { castShadow: false, receiveShadow: false, navigationIgnore: true });
    ring.rotation.set(rx, ry, 0);
    sculpture.add(ring);
  }
  const spire = mesh(new THREE.CylinderGeometry(0.09, 0.16, 3.6, 16), bronze, { position: [0, -1.7, 0], navigationIgnore: true });
  sculpture.add(spire);
  root.add(sculpture);

  const hemi = new THREE.HemisphereLight(0xc6dbff, 0x14171d, 1.35);
  root.add(hemi);
  const key = new THREE.DirectionalLight(0xf3f6ff, 3.2);
  key.position.set(-8, 12, 10);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -18, right: 18, top: 16, bottom: -16, near: 1, far: 45 });
  root.add(key);

  for (const [x, z] of [[-10, 6], [10, 6], [-10, -6], [10, -6]]) {
    const light = new THREE.SpotLight(0xffd6a1, 55, 18, Math.PI / 5, 0.55, 1.2);
    light.position.set(x, 6.5, z);
    light.target.position.set(x * 0.45, 1.2, z * 0.35);
    root.add(light, light.target);
  }
  const coreLight = new THREE.PointLight(0x77aaff, 28, 10, 1.7);
  coreLight.position.set(0, 3.2, -5);
  root.add(coreLight);

  let active = true;
  let environmentTexture = null;
  const textureLoader = loadAssets ? new THREE.TextureLoader() : null;
  const loadTexture = (url, configure, apply) => textureLoader?.load(url, (texture) => {
    if (!active) { texture.dispose(); return; }
    configure?.(texture);
    apply(texture);
  });

  if (loadAssets) {
    loadTexture(MONUMENT_HALL_ASSETS.marbleDiffuse, (t) => prepareTiling(t, [10, 7.5], true), (t) => { marble.map = t; marble.needsUpdate = true; });
    loadTexture(MONUMENT_HALL_ASSETS.marbleNormal, (t) => prepareTiling(t, [10, 7.5]), (t) => { marble.normalMap = t; marble.normalScale.set(0.32, 0.32); marble.needsUpdate = true; });
    loadTexture(MONUMENT_HALL_ASSETS.marbleRoughness, (t) => prepareTiling(t, [10, 7.5]), (t) => { marble.roughnessMap = t; marble.needsUpdate = true; });
    new RGBELoader().load(MONUMENT_HALL_ASSETS.hdri, (texture) => {
      if (!active) { texture.dispose(); return; }
      environmentTexture = texture;
        texture.mapping = THREE.EquirectangularReflectionMapping;
      if (scene) scene.environment = texture;
    });
  }

  return {
    id: 'monument-hall',
    root,
    floor,
    colliders: MONUMENT_HALL_COLLIDERS.map((value) => structuredClone(value)),
    layout:{bounds:{min:[-15,-11],max:[15,11]},groundY:0,margin:1},
    camera: { position: [11.8, 6.8, 16.5], target: [0, 2.4, -4.4] },
    rendering:{ background:0x080b10, fog:{ color:0x080b10, near:22, far:58 }, exposure:1.15 },
    dispose() {
      active = false;
      if (scene?.environment === environmentTexture) scene.environment = null;
      environmentTexture?.dispose();
      environmentTexture = null;
    }
  };
}
