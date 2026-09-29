const objectIds = new WeakMap();

export function getAuthoringObjectId(object) {
  if (!object?.isObject3D) return null;
  const sidecarId = objectIds.get(object);
  if (sidecarId) return sidecarId;
  const legacyId = object.userData?.authoringId;
  return typeof legacyId === 'string' && legacyId.trim() ? legacyId : null;
}

export function setAuthoringObjectId(object, id) {
  if (!object?.isObject3D) throw new TypeError('World Authoring identity target must be an Object3D');
  const value = String(id || '').trim();
  if (!value) throw new TypeError('World Authoring identity requires a non-empty id');
  objectIds.set(object, value);
  return value;
}
