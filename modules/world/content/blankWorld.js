import * as THREE from 'three';

// A minimal physical environment: no architecture or pre-existing furniture.
// Furniture and the Agent are spawned separately through the world bootstrap API.
export function createBlankWorld({ id = 'blank-world' } = {}) {
  const root = new THREE.Group();
  root.name = 'BlankWorld';
  root.userData.environment = id;

  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(24, 0.24, 24),
    new THREE.MeshStandardMaterial({ color:0x899d8c, roughness:0.92 })
  );
  floor.name = 'Ground';
  floor.position.y = -0.12;
  floor.receiveShadow = true;
  root.add(floor);

  root.add(new THREE.HemisphereLight(0xffffff, 0x626b76, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left:-14, right:14, top:14, bottom:-14, near:0.5, far:32 });
  root.add(sun);

  return {
    id, root, floor,
    colliders:[{ shape:'box', halfExtents:[12,0.12,12], translation:[0,-0.12,0] }],
    layout:{ bounds:{min:[-11,-11],max:[11,11]}, groundY:0, margin:1 },
    camera:['house-world','house-door-world'].includes(id) ? { position:[11,7,8], target:[2.4,1.5,-4] } : { position:[7,5.5,9], target:[0,0,-1] },
    rendering:{ background:0xa9c5d6, exposure:1.05 },
    dispose() {}
  };
}
