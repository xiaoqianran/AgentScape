import * as THREE from 'three';

const ONE = new THREE.Vector3(1, 1, 1);

export function rigidInverse(node) {
  if (!node) return new THREE.Matrix4();
  const world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  world.decompose(position, rotation, scale);
  return new THREE.Matrix4().compose(position, rotation, ONE).invert();
}

function expandMeshBounds(target, meshNode, ownerInverse) {
  const mesh = meshNode.getMesh();
  if (!mesh) return 0;
  const transform = ownerInverse.clone().multiply(new THREE.Matrix4().fromArray(meshNode.getWorldMatrix()));
  const point = new THREE.Vector3();
  const element = [0, 0, 0];
  let visited = 0;

  for (const primitive of mesh.listPrimitives()) {
    const position = primitive.getAttribute('POSITION');
    if (!position) continue;
    const indices = primitive.getIndices();
    const count = indices ? indices.getCount() : position.getCount();
    for (let i = 0; i < count; i++) {
      const index = indices ? indices.getScalar(i) : i;
      position.getElement(index, element);
      point.fromArray(element).applyMatrix4(transform);
      target.expandByPoint(point);
      visited += 1;
    }
  }
  return visited;
}

export function boxCollidersForNodes(nodes, ownerNode = null) {
  const ownerInverse = rigidInverse(ownerNode);
  const colliders = [];
  for (const node of nodes) {
    if (!node.getMesh()) continue;
    const box = new THREE.Box3();
    if (!expandMeshBounds(box, node, ownerInverse) || box.isEmpty()) continue;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    colliders.push({
      shape: 'box',
      halfExtents: [Math.max(size.x / 2, 0.005), Math.max(size.y / 2, 0.005), Math.max(size.z / 2, 0.005)],
      translation: center.toArray()
    });
  }
  return colliders;
}

export function sceneMeshOwnership(scene, partNodes) {
  const owners = new Map();
  const partByNode = new Map(Object.entries(partNodes).map(([id, node]) => [node, id]));
  for (const root of scene.listChildren()) {
    root.traverse((node) => {
      if (!node.getMesh()) return;
      let owner = null;
      for (let current = node; current; current = current.getParentNode?.()) {
        if (partByNode.has(current)) { owner = partByNode.get(current); break; }
      }
      if (!owners.has(owner)) owners.set(owner, []);
      owners.get(owner).push(node);
    });
  }
  return owners;
}
