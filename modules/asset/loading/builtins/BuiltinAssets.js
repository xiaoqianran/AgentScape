import * as THREE from 'three';

const createAgent = async () => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 1.06, 8, 16),
    new THREE.MeshStandardMaterial({ color:0x567fbd, roughness:0.28, metalness:0.48 })
  );
  body.position.y = 0.85;
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.12, 0.06),
    new THREE.MeshBasicMaterial({ color:0xa9d5ff, toneMapped:false })
  );
  visor.position.set(0, 1.12, -0.29);
  group.add(visor);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.42, 0.025, 8, 32),
    new THREE.MeshBasicMaterial({ color:0x7db4ff, toneMapped:false })
  );
  ring.position.y = 0.08;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const hold = new THREE.Group();
  hold.name = 'HoldAnchor';
  hold.position.set(0, 0.95, -0.62);
  group.add(hold);
  return group;
};

const createChair = async () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color:0x71806a, roughness:0.75 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.1, 0.76), material);
  seat.position.y = 0.72;
  seat.castShadow = seat.receiveShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.9, 0.1), material);
  back.position.set(0, 1.16, -0.33);
  back.castShadow = back.receiveShadow = true;
  group.add(back);

  for (const x of [-0.3, 0.3]) for (const z of [-0.3, 0.3]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.68, 0.08), material);
    leg.position.set(x, 0.34, z);
    leg.castShadow = leg.receiveShadow = true;
    group.add(leg);
  }
  return group;
};

const createCup = async () => {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.13, 0.32, 28),
    new THREE.MeshStandardMaterial({ color:0xe9edf5, roughness:0.35 })
  );
  body.position.y = 0.16;
  body.castShadow = body.receiveShadow = true;
  group.add(body);
  return group;
};

const createTable = async () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color:0x9a6a43, roughness:0.72 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 1.25), material);
  top.position.y = 1;
  top.castShadow = top.receiveShadow = true;
  group.add(top);

  for (const x of [-1.02, 1.02]) for (const z of [-0.46, 0.46]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.94, 0.14), material);
    leg.position.set(x, 0.47, z);
    leg.castShadow = leg.receiveShadow = true;
    group.add(leg);
  }
  return group;
};

export const builtinAssetFactories = Object.freeze({
  agent: createAgent,
  chair: createChair,
  cup: createCup,
  table: createTable
});
