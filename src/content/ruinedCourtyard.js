import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

export const RUINED_COURTYARD_ASSETS = Object.freeze({
  hdri: 'assets/ruined-courtyard/courtyard_1k.hdr',
  groundDiffuse: 'assets/ruined-courtyard/mossy_cobblestone_diff_1k.jpg',
  groundNormal: 'assets/ruined-courtyard/mossy_cobblestone_nor_gl_1k.jpg',
  wallDiffuse: 'assets/ruined-courtyard/mossy_sandstone_diff_1k.jpg'
});

const box = (halfExtents, translation, rotation = null) => ({ shape:'box', halfExtents, translation, ...(rotation ? { rotation } : {}) });
const cylinder = (radius, halfHeight, translation, rotation = null) => ({ shape:'cylinder', radius, halfHeight, translation, ...(rotation ? { rotation } : {}) });
const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
const rotateXZ = (x, z, a) => [Math.cos(a) * x + Math.sin(a) * z, -Math.sin(a) * x + Math.cos(a) * z];
const archColliders = (x, z, angle = 0) => {
  const rotation = qy(angle);
  const at = (lx, y, lz) => {
    const [dx, dz] = rotateXZ(lx, lz, angle);
    return [x + dx, y, z + dz];
  };
  return [
    box([.55, 2.4, .375], at(-2.45, 2.4, 0), rotation),
    box([.55, 2.4, .375], at(2.45, 2.4, 0), rotation),
    box([3, .5, .375], at(0, 5, 0), rotation)
  ];
};

const EAST_STEPS = Array.from({ length:6 }, (_, i) => box([.25, (i + 1) * .1, 2.1], [4.25 + i * .5, (i + 1) * .1, 4.8]));
const WEST_STEPS = Array.from({ length:4 }, (_, i) => box([.25, (i + 1) * .1, 1.8], [-5.95 - i * .5, (i + 1) * .1, -6.2]));

export const RUINED_COURTYARD_COLLIDERS = Object.freeze([
  box([18, .15, 15], [0, -.15, 0]),
  box([5.2, .6, 5.4], [12.2, .6, 4.8]),
  box([4.5, .4, 4.6], [-12.2, .4, -6.2]),
  ...EAST_STEPS,
  ...WEST_STEPS,
  box([5.8, 2.4, .28], [-11.9, 2.4, -14.6]),
  box([5.8, 2.4, .28], [11.9, 2.4, -14.6]),
  box([2.2, .75, .28], [0, 4.05, -14.6]),
  box([.28, 2.7, 5.2], [-17.6, 2.7, -7.8]),
  box([.28, 1.9, 3.1], [-17.6, 1.9, 7.8]),
  box([.28, 2.2, 4.4], [17.6, 2.2, -8.4]),
  box([.28, 1.5, 2.6], [17.6, 1.5, 8.8]),
  ...archColliders(0, -14.25),
  ...archColliders(-17.25, 1.3, Math.PI / 2),
  ...archColliders(17.25, 1.0, -Math.PI / 2),
  cylinder(2.0, .42, [0, .42, -1.8]),
  cylinder(.42, 3.2, [-6.2, .55, 3.7], qz(Math.PI / 2)),
  cylinder(.38, 2.5, [7.2, .5, -8.0], qx(Math.PI / 2)),
  box([2.1, .45, .55], [-3.8, .45, 9.6], qz(-.18)),
  box([1.7, .35, .5], [4.6, .35, 10.4], qz(.13))
]);

const mesh = (geometry, material, { position, rotation, name, castShadow = true, receiveShadow = true, navigationIgnore = false } = {}) => {
  const value = new THREE.Mesh(geometry, material);
  if (position) value.position.set(...position);
  if (rotation) value.rotation.set(...rotation);
  value.name = name || '';
  value.castShadow = castShadow;
  value.receiveShadow = receiveShadow;
  if (navigationIgnore) value.userData.navigationIgnore = true;
  return value;
};

const tile = (texture, repeat, color = false) => {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 4;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
};

const addArch = (root, material, x, z, rotationY = 0, name = 'Arch') => {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(x, 0, z);
  group.rotation.y = rotationY;
  group.add(
    mesh(new THREE.BoxGeometry(1.1, 4.8, .75), material, { position:[-2.45, 2.4, 0] }),
    mesh(new THREE.BoxGeometry(1.1, 4.8, .75), material, { position:[2.45, 2.4, 0] }),
    mesh(new THREE.BoxGeometry(6, 1.0, .75), material, { position:[0, 5.0, 0] }),
    mesh(new THREE.TorusGeometry(2.45, .28, 10, 48, Math.PI), material, { position:[0, 4.25, 0], rotation:[0, 0, Math.PI], navigationIgnore:true })
  );
  root.add(group);
};

const addGrass = (root) => {
  const geometry = new THREE.ConeGeometry(.08, .55, 5);
  const material = new THREE.MeshStandardMaterial({ color:0x405d31, roughness:.9 });
  const patches = [[-14,0,11],[-11,0,7],[-7,0,12],[-3,0,11],[3,0,12],[8,0,11],[12,1.2,5],[14,1.2,2],[-13,.8,-5],[-11,.8,-9],[14,0,-10],[8,0,-12]];
  const instanced = new THREE.InstancedMesh(geometry, material, patches.length * 9);
  instanced.name = 'CourtyardGrass';
  instanced.userData.navigationIgnore = true;
  instanced.castShadow = true;
  instanced.receiveShadow = true;
  const matrix = new THREE.Matrix4();
  let index = 0;
  for (const [x, y, z] of patches) {
    for (let i = 0; i < 9; i++) {
      const px = x + ((i * 37) % 7 - 3) * .16;
      const pz = z + ((i * 53) % 7 - 3) * .15;
      const scale = .55 + ((i * 29) % 5) * .12;
      matrix.compose(new THREE.Vector3(px, y + .25 * scale, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * .77), new THREE.Vector3(scale, scale, scale));
      instanced.setMatrixAt(index++, matrix);
    }
  }
  instanced.instanceMatrix.needsUpdate = true;
  root.add(instanced);
};

export function createRuinedCourtyard({ scene, loadAssets = true } = {}) {
  const root = new THREE.Group();
  root.name = 'RuinedCourtyard';
  root.userData.environment = 'ruined-courtyard';

  const ground = new THREE.MeshStandardMaterial({ color:0x66655a, roughness:.94, metalness:0 });
  const sandstone = new THREE.MeshStandardMaterial({ color:0x777568, roughness:.92 });
  const darkStone = new THREE.MeshStandardMaterial({ color:0x343932, roughness:.98 });
  const water = new THREE.MeshPhysicalMaterial({ color:0x203f43, roughness:.2, transmission:.08, transparent:true, opacity:.72 });

  const floor = mesh(new THREE.BoxGeometry(36, .3, 30), ground, { position:[0, -.15, 0], name:'CourtyardFloor', castShadow:false });
  root.add(floor);
  root.add(
    mesh(new THREE.BoxGeometry(10.4, 1.2, 10.8), darkStone, { position:[12.2, .6, 4.8], name:'EastTerrace' }),
    mesh(new THREE.BoxGeometry(9, .8, 9.2), darkStone, { position:[-12.2, .4, -6.2], name:'WestTerrace' })
  );

  for (let i = 0; i < 6; i++) root.add(mesh(new THREE.BoxGeometry(.5, (i + 1) * .2, 4.2), ground, { position:[4.25 + i * .5, (i + 1) * .1, 4.8], name:`EastStep_${i}` }));
  for (let i = 0; i < 4; i++) root.add(mesh(new THREE.BoxGeometry(.5, (i + 1) * .2, 3.6), ground, { position:[-5.95 - i * .5, (i + 1) * .1, -6.2], name:`WestStep_${i}` }));

  const wall = (size, position, name) => root.add(mesh(new THREE.BoxGeometry(...size), sandstone, { position, name, castShadow:false }));
  wall([11.6, 4.8, .56], [-11.9, 2.4, -14.6], 'NorthWallWest');
  wall([11.6, 4.8, .56], [11.9, 2.4, -14.6], 'NorthWallEast');
  wall([4.4, 1.5, .56], [0, 4.05, -14.6], 'NorthLintel');
  wall([.56, 5.4, 10.4], [-17.6, 2.7, -7.8], 'WestWallNorth');
  wall([.56, 3.8, 6.2], [-17.6, 1.9, 7.8], 'WestWallSouth');
  wall([.56, 4.4, 8.8], [17.6, 2.2, -8.4], 'EastWallNorth');
  wall([.56, 3.0, 5.2], [17.6, 1.5, 8.8], 'EastWallSouth');

  addArch(root, sandstone, 0, -14.25, 0, 'NorthGate');
  addArch(root, sandstone, -17.25, 1.3, Math.PI / 2, 'WestArcade');
  addArch(root, sandstone, 17.25, 1.0, -Math.PI / 2, 'EastArcade');

  root.add(
    mesh(new THREE.CylinderGeometry(2, 2.25, .84, 40), darkStone, { position:[0, .42, -1.8], name:'DryFountain' }),
    mesh(new THREE.CylinderGeometry(1.55, 1.55, .06, 40), water, { position:[0, .87, -1.8], name:'FountainWater', castShadow:false, receiveShadow:false, navigationIgnore:true }),
    mesh(new THREE.CylinderGeometry(.42, .46, 6.4, 18), sandstone, { position:[-6.2, .55, 3.7], rotation:[0, 0, Math.PI / 2], name:'FallenColumnWest' }),
    mesh(new THREE.CylinderGeometry(.38, .42, 5, 18), sandstone, { position:[7.2, .5, -8], rotation:[Math.PI / 2, 0, 0], name:'FallenColumnEast' }),
    mesh(new THREE.BoxGeometry(4.2, .9, 1.1), sandstone, { position:[-3.8, .45, 9.6], rotation:[0, 0, -.18], name:'CollapsedBeamWest' }),
    mesh(new THREE.BoxGeometry(3.4, .7, 1), sandstone, { position:[4.6, .35, 10.4], rotation:[0, 0, .13], name:'CollapsedBeamEast' })
  );

  for (const [x, y, z, s] of [[-14,.82,9,.65],[-9,.2,10,.45],[-3,.2,12,.5],[5,.2,12,.4],[13,1.35,7,.5],[-13,1.0,-10,.55],[12,.2,-11,.5]]) {
    const rock = mesh(new THREE.DodecahedronGeometry(s, 0), darkStone, { position:[x, y, z], name:'Rubble', navigationIgnore:true });
    rock.rotation.set(.2 + x * .01, .4 + z * .02, .15);
    root.add(rock);
  }
  addGrass(root);

  const hemi = new THREE.HemisphereLight(0xc8d6c2, 0x263127, 1.9);
  const sun = new THREE.DirectionalLight(0xffe0ad, 4.1);
  sun.position.set(-11, 17, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left:-24, right:24, top:20, bottom:-20, near:1, far:55 });
  const fill = new THREE.DirectionalLight(0x91aec4, .8);
  fill.position.set(12, 8, -14);
  root.add(hemi, sun, fill);

  let active = true;
  let environmentTexture = null;
  const loader = loadAssets ? new THREE.TextureLoader() : null;
  const loadTexture = (url, configure, apply) => loader?.load(url, (texture) => {
    if (!active) { texture.dispose(); return; }
    configure?.(texture);
    apply(texture);
  });
  if (loadAssets) {
    loadTexture(RUINED_COURTYARD_ASSETS.groundDiffuse, (t) => tile(t, [12, 10], true), (t) => { ground.map = t; ground.needsUpdate = true; });
    loadTexture(RUINED_COURTYARD_ASSETS.groundNormal, (t) => tile(t, [12, 10]), (t) => { ground.normalMap = t; ground.normalScale.set(.42, .42); ground.needsUpdate = true; });
    loadTexture(RUINED_COURTYARD_ASSETS.wallDiffuse, (t) => tile(t, [5, 3], true), (t) => { sandstone.map = t; sandstone.needsUpdate = true; });
    new RGBELoader().load(RUINED_COURTYARD_ASSETS.hdri, (texture) => {
      if (!active) { texture.dispose(); return; }
      environmentTexture = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      if (scene) scene.environment = texture;
    });
  }

  return {
    id:'ruined-courtyard',
    root,
    floor,
    colliders:RUINED_COURTYARD_COLLIDERS.map((value) => structuredClone(value)),
    camera:{ position:[16.8, 8.8, 19.5], target:[0, 1.2, -2.6] },
    rendering:{ background:0x667160, fog:{ color:0x667160, near:24, far:72 }, exposure:1.08 },
    dispose() {
      active = false;
      if (scene?.environment === environmentTexture) scene.environment = null;
      environmentTexture?.dispose();
      environmentTexture = null;
    }
  };
}
