import * as THREE from 'three';

// Built-in mechanical fixture: two independent hinged doors and two sliding drawers.
// The named pivot groups are the physics anchors referenced by the Asset Manifest.
const box = (parent, name, size, position, material) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

const cylinder = (parent, name, radius, height, position, material) => {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 12), material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
};

export async function createIndustrialCabinet() {
  const root = new THREE.Group();
  root.name = 'IndustrialCabinet';

  const shell = new THREE.MeshStandardMaterial({ color: '#344451', metalness: 0.7, roughness: 0.4 });
  const frame = new THREE.MeshStandardMaterial({ color: '#1a2833', metalness: 0.78, roughness: 0.36 });
  const doorFinish = new THREE.MeshStandardMaterial({ color: '#526e82', metalness: 0.63, roughness: 0.42 });
  const drawerFinish = new THREE.MeshStandardMaterial({ color: '#667d8c', metalness: 0.68, roughness: 0.4 });
  const inset = new THREE.MeshStandardMaterial({ color: '#2b4050', metalness: 0.46, roughness: 0.53 });
  const steel = new THREE.MeshStandardMaterial({ color: '#b5c2ca', metalness: 0.9, roughness: 0.27 });
  const dark = new THREE.MeshStandardMaterial({ color: '#101c26', metalness: 0.23, roughness: 0.7 });
  const accent = new THREE.MeshStandardMaterial({ color: '#e2a84b', metalness: 0.55, roughness: 0.33 });

  // Hollow fixed carcass: colliders deliberately leave room for the moving parts.
  box(root, 'Body', [1.84, 0.08, 0.73], [0, 0.18, 0], shell);
  box(root, 'Roof', [1.84, 0.08, 0.73], [0, 2.09, 0], shell);
  box(root, 'LeftWall', [0.08, 1.88, 0.73], [-0.88, 1.12, 0], shell);
  box(root, 'RightWall', [0.08, 1.88, 0.73], [0.88, 1.12, 0], shell);
  box(root, 'RearWall', [1.76, 1.88, 0.056], [0, 1.12, -0.35], frame);
  box(root, 'CabinetDivider', [1.72, 0.08, 0.68], [0, 1.12, 0], frame);
  box(root, 'UpperShelf', [1.72, 0.045, 0.66], [0, 1.61, -0.01], shell);

  for (const x of [-0.74, 0.74]) {
    for (const z of [-0.25, 0.25]) {
      box(root, 'AdjustableFoot', [0.16, 0.13, 0.16], [x, 0.065, z], dark);
      box(root, 'FootTrim', [0.17, 0.025, 0.17], [x, 0.14, z], steel);
    }
  }

  box(root, 'UpperFrontTrim', [1.80, 0.045, 0.035], [0, 2.04, 0.345], frame);
  box(root, 'MiddleFrontTrim', [1.80, 0.042, 0.035], [0, 1.105, 0.345], frame);
  box(root, 'LowerFrontTrim', [1.80, 0.038, 0.035], [0, 0.225, 0.345], frame);
  box(root, 'BrandPlate', [0.38, 0.065, 0.008], [0, 2.14, 0.365], accent);

  for (const [side, name] of [[-1, 'LeftDoorHinge'], [1, 'RightDoorHinge']]) {
    const door = new THREE.Group();
    door.name = name;
    door.position.set(side * 0.81, 1.59, 0.393);
    root.add(door);
    const direction = -side;

    box(door, side === -1 ? 'LeftDoor' : 'RightDoor', [0.774, 0.86, 0.056], [direction * 0.395, 0, 0], doorFinish);
    box(door, 'DoorInset', [0.67, 0.67, 0.011], [direction * 0.395, 0, 0.034], inset);
    box(door, 'InsetHeader', [0.59, 0.015, 0.012], [direction * 0.395, 0.26, 0.044], steel);
    for (let n = 0; n < 5; n++) {
      box(door, 'VentSlot', [0.40, 0.019, 0.012], [direction * 0.395, -0.12 + n * 0.048, 0.044], dark);
    }
    const handleX = direction * 0.694;
    box(door, 'DoorHandle', [0.027, 0.23, 0.032], [handleX, -0.02, 0.10], steel);
    for (const y of [-0.135, 0.095]) {
      box(door, 'HandleMount', [0.045, 0.038, 0.065], [handleX, y, 0.067], frame);
    }
    for (const y of [1.27, 1.91]) {
      cylinder(root, 'HingePin', 0.029, 0.15, [side * 0.81, y, 0.407], steel);
    }
  }

  for (const [name, y] of [['UpperDrawerSlide', 0.81], ['LowerDrawerSlide', 0.41]]) {
    const drawer = new THREE.Group();
    drawer.name = name;
    drawer.position.set(0, y, 0);
    root.add(drawer);

    box(drawer, 'DrawerFloor', [1.45, 0.035, 0.62], [0, -0.137, 0.065], steel);
    box(drawer, 'DrawerRear', [1.45, 0.25, 0.035], [0, -0.002, -0.245], frame);
    for (const side of [-1, 1]) {
      box(drawer, 'DrawerSide', [0.036, 0.25, 0.61], [side * 0.716, -0.002, 0.065], frame);
    }
    box(drawer, 'DrawerFront', [1.55, 0.32, 0.054], [0, 0, 0.393], drawerFinish);
    box(drawer, 'DrawerInset', [1.37, 0.226, 0.012], [0, 0, 0.427], inset);
    box(drawer, 'DrawerPull', [0.35, 0.033, 0.035], [0, 0.013, 0.485], steel);
    for (const x of [-0.15, 0.15]) {
      box(drawer, 'PullMount', [0.04, 0.058, 0.070], [x, 0.013, 0.453], steel);
    }
    box(drawer, 'DrawerLabel', [0.19, 0.035, 0.013], [0.46, 0.095, 0.438], accent);
  }

  root.updateMatrixWorld(true);
  return root;
}
