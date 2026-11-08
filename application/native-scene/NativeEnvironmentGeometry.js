import * as THREE from 'three';

const fail = code => Object.assign(new Error(code), { code });
const MAX_MESHES = 32;
const MAX_TRIANGLES = 100_000;
const MAX_VERTICES = 200_000;

/**
 * Opt-in static environment geometry. Do not infer from arbitrary scene
 * children: host animations and dynamically moved meshes are not physics.
 * Source geometry and materials remain entirely owned by the host.
 */
export function extractNativeStaticColliders(scene, { staticMeshes = [], walkableMesh = null } = {}) {
  if (!Array.isArray(staticMeshes) || staticMeshes.length > MAX_MESHES)
    throw fail('NATIVE_STATIC_MESH_LIMIT');
  const meshes = [...staticMeshes];
  if (walkableMesh != null && !meshes.includes(walkableMesh)) meshes.push(walkableMesh);
  if (meshes.length > MAX_MESHES || new Set(meshes).size !== meshes.length)
    throw fail('NATIVE_STATIC_MESH_LIMIT');
  scene.updateMatrixWorld(true);
  const colliders = [];
  let triangles = 0, vertexCount = 0;
  for (const mesh of meshes) {
    if (!mesh?.isMesh || mesh.isSkinnedMesh || mesh.isInstancedMesh ||
        mesh.morphTargetInfluences?.length || mesh.userData?.agentscapeDynamic)
      throw fail('NATIVE_STATIC_MESH_UNSUPPORTED');
    let parent = mesh;
    while (parent && parent !== scene) parent = parent.parent;
    if (parent !== scene) throw fail('NATIVE_STATIC_MESH_NOT_IN_SCENE');
    const attribute = mesh.geometry?.getAttribute('position');
    const index = mesh.geometry?.getIndex();
    if (!attribute || attribute.itemSize !== 3 || !Number.isSafeInteger(attribute.count) ||
        attribute.count < 3 || (index && index.count % 3 !== 0) ||
        (!index && attribute.count % 3 !== 0))
      throw fail('NATIVE_STATIC_GEOMETRY_INVALID');
    const count = index ? index.count : attribute.count;
    vertexCount += attribute.count;
    if (vertexCount > MAX_VERTICES) throw fail('NATIVE_STATIC_VERTEX_LIMIT');
    triangles += count / 3;
    if (triangles > MAX_TRIANGLES) throw fail('NATIVE_STATIC_TRIANGLE_LIMIT');
    const vertices = new Array(attribute.count * 3);
    const point = new THREE.Vector3();
    for (let i = 0; i < attribute.count; i++) {
      point.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld);
      if (![point.x, point.y, point.z].every(Number.isFinite) ||
          Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(point.z)) > 10_000)
        throw fail('NATIVE_STATIC_GEOMETRY_INVALID');
      vertices[i * 3] = point.x;
      vertices[i * 3 + 1] = point.y;
      vertices[i * 3 + 2] = point.z;
    }
    const indices = new Array(count);
    for (let i = 0; i < count; i++) {
      const vertex = index ? index.getX(i) : i;
      if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= attribute.count)
        throw fail('NATIVE_STATIC_GEOMETRY_INVALID');
      indices[i] = vertex;
    }
    colliders.push({ shape: 'trimesh', vertices, indices });
  }
  return colliders;
}
