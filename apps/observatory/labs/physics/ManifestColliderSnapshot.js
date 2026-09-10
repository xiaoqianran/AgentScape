import * as THREE from "three";

const ROOT_PART = "$root";
const identity = [0, 0, 0, 1];

const normalizeShape = (spec = {}) => {
  if (spec.shape === "box") {
    const [x = 0, y = 0, z = 0] = spec.halfExtents || [];
    return { kind: "box", halfExtents: { x, y, z } };
  }
  if (spec.shape === "cylinder") return { kind: "cylinder", halfHeight: spec.halfHeight ?? 0, radius: spec.radius ?? 0 };
  if (spec.shape === "capsule") return { kind: "capsule", halfHeight: spec.halfHeight ?? 0, radius: spec.radius ?? 0 };
  if (spec.shape === "convexHull") return { kind: "convexHull", vertices: [...(spec.vertices || [])] };
  return { kind: spec.shape || "unknown" };
};

const worldPose = (node, spec) => {
  node.updateWorldMatrix(true, false);
  const worldPosition = new THREE.Vector3();
  const worldRotation = new THREE.Quaternion();
  node.getWorldPosition(worldPosition);
  node.getWorldQuaternion(worldRotation);

  const localPosition = new THREE.Vector3(...(spec.translation || [0, 0, 0]));
  const localRotation = new THREE.Quaternion(...(spec.rotation || identity)).normalize();
  localPosition.applyQuaternion(worldRotation).add(worldPosition);
  worldRotation.multiply(localRotation).normalize();
  return { position: localPosition.toArray(), rotation: worldRotation.toArray() };
};

const addColliders = (out, { objectId, partName, node, specs }) => {
  for (const [colliderIndex, spec] of (specs || []).entries()) {
    const pose = worldPose(node, spec);
    out.push({
      source: "manifest",
      objectId,
      partName,
      colliderIndex,
      position: pose.position,
      rotation: pose.rotation,
      shape: normalizeShape(spec)
    });
  }
};

export function manifestColliderSnapshot(store) {
  const colliders = [];
  for (const record of store?.values?.() || []) {
    if (!record?.object || !record?.manifest) continue;
    addColliders(colliders, {
      objectId: record.id,
      partName: ROOT_PART,
      node: record.object,
      specs: record.manifest.physics?.colliders
    });
    for (const [partName, part] of Object.entries(record.manifest.parts || {})) {
      const node = part.node ? record.object.getObjectByName(part.node) : null;
      if (!node) continue;
      addColliders(colliders, {
        objectId: record.id,
        partName,
        node,
        specs: part.physics?.colliders
      });
    }
  }
  return { schemaVersion: 1, source: "manifest", colliders };
}

const keyFor = (collider) => `${collider.objectId}:${collider.partName || ROOT_PART}:${collider.colliderIndex ?? 0}`;
const vecDistance = (a, b) => Array.isArray(a) && Array.isArray(b)
  ? Math.hypot(...a.map((value, index) => value - (b[index] ?? 0)))
  : null;
const rotationDelta = (a, b) => {
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const qa = new THREE.Quaternion(...a).normalize();
  const qb = new THREE.Quaternion(...b).normalize();
  return 2 * Math.acos(Math.min(1, Math.abs(qa.dot(qb))));
};
const shapeDelta = (a, b) => {
  if (!a || !b || a.kind !== b.kind) return null;
  if (a.kind === "box") return Math.max(
    Math.abs((a.halfExtents?.x || 0) - (b.halfExtents?.x || 0)),
    Math.abs((a.halfExtents?.y || 0) - (b.halfExtents?.y || 0)),
    Math.abs((a.halfExtents?.z || 0) - (b.halfExtents?.z || 0))
  );
  if (a.kind === "cylinder" || a.kind === "capsule") return Math.max(
    Math.abs((a.halfHeight || 0) - (b.halfHeight || 0)),
    Math.abs((a.radius || 0) - (b.radius || 0))
  );
  return 0;
};

export function compareManifestToPhysics(manifestSnapshot, physicsSnapshot) {
  const physics = new Map((physicsSnapshot?.colliders || []).map((collider) => [keyFor(collider), collider]));
  const rows = (manifestSnapshot?.colliders || []).map((manifest) => {
    const actual = physics.get(keyFor(manifest));
    return {
      key: keyFor(manifest),
      objectId: manifest.objectId,
      partName: manifest.partName,
      colliderIndex: manifest.colliderIndex,
      present: Boolean(actual),
      shapeKindEqual: Boolean(actual) && manifest.shape?.kind === actual.shape?.kind,
      manifestPosition: [...manifest.position],
      physicsPosition: actual?.position ? [...actual.position] : null,
      manifestRotation: [...manifest.rotation],
      physicsRotation: actual?.rotation ? [...actual.rotation] : null,
      positionDelta: actual ? vecDistance(manifest.position, actual.position) : null,
      rotationDelta: actual ? rotationDelta(manifest.rotation, actual.rotation) : null,
      shapeDelta: actual ? shapeDelta(manifest.shape, actual.shape) : null
    };
  });
  const max = (field) => {
    const values = rows.map((row) => row[field]).filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  };
  return {
    rows,
    summary: {
      manifestCount: manifestSnapshot?.colliders?.length || 0,
      physicsCount: physicsSnapshot?.colliders?.length || 0,
      missingCount: rows.filter((row) => !row.present).length,
      shapeMismatchCount: rows.filter((row) => row.present && !row.shapeKindEqual).length,
      maxPositionDelta: max("positionDelta"),
      maxRotationDelta: max("rotationDelta"),
      maxShapeDelta: max("shapeDelta")
    }
  };
}
