import * as THREE from 'three';

export const ASSET_DRAG_MIME = 'application/x-agentscape-asset';

const UP = new THREE.Vector3(0, 1, 0);
const DEFAULT_HALF_EXTENTS = new THREE.Vector3(0.35, 0.35, 0.35);
const CLEARANCE = 0.02;

const finiteVec3 = (value, fallback = [0, 0, 0]) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) ? value : fallback;

function colliderHalfExtents(collider = {}) {
  if (collider.shape === 'box' && Array.isArray(collider.halfExtents)) return new THREE.Vector3(...collider.halfExtents);
  if (collider.shape === 'cylinder') return new THREE.Vector3(collider.radius, collider.halfHeight, collider.radius);
  if (collider.shape === 'capsule') return new THREE.Vector3(collider.radius, collider.halfHeight + collider.radius, collider.radius);
  if (collider.shape === 'convexHull' && Array.isArray(collider.vertices) && collider.vertices.length >= 3) {
    const box = new THREE.Box3();
    for (let i = 0; i + 2 < collider.vertices.length; i += 3) box.expandByPoint(new THREE.Vector3(collider.vertices[i], collider.vertices[i + 1], collider.vertices[i + 2]));
    if (!box.isEmpty()) return box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  }
  return DEFAULT_HALF_EXTENTS.clone();
}

function colliderBounds(collider = {}) {
  const half = colliderHalfExtents(collider);
  const center = new THREE.Vector3(...finiteVec3(collider.translation));
  const rotation = Array.isArray(collider.rotation) && collider.rotation.length === 4 && collider.rotation.every(Number.isFinite)
    ? new THREE.Quaternion(...collider.rotation).normalize()
    : new THREE.Quaternion();
  const box = new THREE.Box3();
  for (const x of [-half.x, half.x]) {
    for (const y of [-half.y, half.y]) {
      for (const z of [-half.z, half.z]) {
        box.expandByPoint(new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(center));
      }
    }
  }
  return box;
}

export function placementBounds(manifest = {}) {
  const colliders = manifest.physics?.colliders || [];
  const box = new THREE.Box3();
  for (const collider of colliders) box.union(colliderBounds(collider));
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, DEFAULT_HALF_EXTENTS.y, 0), DEFAULT_HALF_EXTENTS.clone().multiplyScalar(2));
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: box.min.toArray(),
    max: box.max.toArray(),
    size: size.toArray(),
    center: center.toArray(),
    bottomCenter: [center.x, box.min.y, center.z]
  };
}

function createGhost(bounds) {
  const size = new THREE.Vector3(...bounds.size).max(new THREE.Vector3(0.05, 0.05, 0.05));
  const center = new THREE.Vector3(...bounds.center);
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.MeshBasicMaterial({
    color: 0xd9b36c,
    wireframe: true,
    transparent: true,
    opacity: 0.72,
    depthTest: false,
    toneMapped: false
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.renderOrder = 1000;
  mesh.userData.editorPlacementGhost = true;
  const group = new THREE.Group();
  group.name = '$asset-placement-preview';
  group.userData.editorPlacementGhost = true;
  group.add(mesh);
  return { group, mesh, geometry, material };
}

export class AssetPlacementController {
  constructor({ world, tools, editor = null, log = () => {} } = {}) {
    if (!world?.rendering?.viewport || !world?.assets || !world?.physics) throw new TypeError('AssetPlacementController requires initialized WorldRuntime');
    if (!tools?.call) throw new TypeError('AssetPlacementController requires AgentTools');
    this.world = world;
    this.tools = tools;
    this.editor = editor;
    this.log = log;
    const viewport = world.rendering.viewport();
    this.camera = viewport.camera;
    this.element = viewport.element;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.fallbackPlane = new THREE.Plane(UP, 0);
    this.activeAssetId = null;
    this.manifest = null;
    this.bounds = null;
    this.preview = null;
    this.position = null;
    this.pose = null;
    this.surface = null;

    this.onDragEnter = (event) => this.handleDragOver(event);
    this.onDragOver = (event) => this.handleDragOver(event);
    this.onDragLeave = (event) => {
      if (event.relatedTarget && this.element.contains?.(event.relatedTarget)) return;
      this.element.classList.remove('asset-drop-target');
    };
    this.onDrop = (event) => this.handleDrop(event);
    this.element.addEventListener('dragenter', this.onDragEnter);
    this.element.addEventListener('dragover', this.onDragOver);
    this.element.addEventListener('dragleave', this.onDragLeave);
    this.element.addEventListener('drop', this.onDrop);
  }

  beginDrag(assetId) {
    const id = String(assetId || '').trim();
    if (!id || !this.world.assetCatalog?.has?.(id)) return false;
    this.cancelDrag();
    this.activeAssetId = id;
    this.manifest = this.world.assets.getManifest(id);
    this.bounds = placementBounds(this.manifest);
    this.preview = createGhost(this.bounds);
    this.world.scene.add(this.preview.group);
    this.preview.group.visible = false;
    this.world.events.emit('editor.asset-placement-started', { assetId:id });
    return true;
  }

  assetIdFromTransfer(dataTransfer) {
    const direct = String(dataTransfer?.getData?.(ASSET_DRAG_MIME) || '').trim();
    return direct || this.activeAssetId || null;
  }

  transferAcceptsAsset(dataTransfer) {
    const types = [...(dataTransfer?.types || [])];
    return Boolean(this.activeAssetId || types.includes(ASSET_DRAG_MIME));
  }

  handleDragOver(event) {
    if (!this.transferAcceptsAsset(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    if (!this.activeAssetId) {
      const assetId = this.assetIdFromTransfer(event.dataTransfer);
      if (!assetId || !this.beginDrag(assetId)) return;
    }
    this.element.classList.add('asset-drop-target');
    this.updateCandidate(event.clientX, event.clientY);
  }

  surfacePoint(clientX, clientY) {
    const rect = this.element.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const targets = [
      this.world.environment?.root,
      ...this.world.store.list().map(([, record]) => record.object)
    ].filter(Boolean);
    for (const hit of this.raycaster.intersectObjects(targets, true)) {
      if (!hit.face) continue;
      const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      if (normal.dot(UP) < 0.45) continue;
      return { point:hit.point.clone(), normal, object:hit.object };
    }
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.fallbackPlane, point)
      ? { point, normal:UP.clone(), object:null }
      : null;
  }

  updateCandidate(clientX, clientY) {
    if (!this.activeAssetId || !this.preview || !this.bounds) return null;
    const surface = this.surfacePoint(clientX, clientY);
    if (!surface) {
      this.preview.group.visible = false;
      this.position = null;
      this.pose = null;
      return null;
    }
    const rootPosition = surface.point.clone().addScaledVector(surface.normal, CLEARANCE);
    const position = rootPosition.toArray();
    const pose = this.world.physics.manifestPoseClear(this.manifest, position);
    const valid = pose.checked ? pose.clear : true;
    this.preview.group.position.copy(rootPosition);
    this.preview.group.visible = true;
    this.preview.material.color.setHex(pose.checked ? (valid ? 0x6ecf98 : 0xdf7f86) : 0xd9b36c);
    this.preview.material.opacity = valid ? 0.72 : 0.9;
    this.position = position;
    this.pose = { ...pose, valid };
    this.surface = surface;
    this.world.events.emit('editor.asset-placement-preview', { assetId:this.activeAssetId, position:[...position], valid, checked:Boolean(pose.checked), blockedBy:[...(pose.blockedBy || [])] });
    return { position, pose:this.pose, surface };
  }

  async handleDrop(event) {
    if (!this.transferAcceptsAsset(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.activeAssetId) {
      const assetId = this.assetIdFromTransfer(event.dataTransfer);
      if (!assetId || !this.beginDrag(assetId)) return;
    }
    this.updateCandidate(event.clientX, event.clientY);
    await this.commit();
  }

  async commit() {
    const assetId = this.activeAssetId;
    const position = this.position ? [...this.position] : null;
    const pose = this.pose ? { ...this.pose, blockedBy:[...(this.pose.blockedBy || [])] } : null;
    if (!assetId || !position) {
      this.cancelDrag();
      return { status:'placement-cancelled', reason:'NO_SURFACE' };
    }
    if (pose?.checked && !pose.valid) {
      const blockedBy = pose.blockedBy?.join(', ') || 'collision';
      this.log(`无法放置 ${assetId}：${blockedBy}`, 'error');
      this.world.events.emit('editor.asset-placement-blocked', { assetId, position, blockedBy:pose.blockedBy || [] });
      this.cancelDrag();
      return { status:'placement-blocked', assetId, position, blockedBy:pose.blockedBy || [] };
    }
    this.clearPreview();
    this.activeAssetId = null;
    this.manifest = null;
    this.bounds = null;
    this.position = null;
    this.pose = null;
    this.surface = null;
    try {
      const result = await this.tools.call('spawnAsset', { assetId, position });
      const id = typeof result === 'string' ? result : result?.id;
      if (id) this.editor?.select?.(id);
      this.log(`已放置资产：${assetId}`, 'result');
      this.world.events.emit('editor.asset-placement-committed', { assetId, id:id || null, position, provisional:typeof result !== 'string' });
      return { status:'placement-committed', assetId, id:id || null, position, result };
    } catch (error) {
      this.log(`放置资产失败：${error.message}`, 'error');
      this.world.events.emit('editor.asset-placement-failed', { assetId, position, code:error.code || null, message:error.message });
      throw error;
    }
  }

  async placeAtCenter(assetId) {
    if (!this.beginDrag(assetId)) return { status:'placement-cancelled', reason:'ASSET_NOT_FOUND' };
    const rect = this.element.getBoundingClientRect();
    this.updateCandidate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return this.commit();
  }

  clearPreview() {
    this.element.classList.remove('asset-drop-target');
    if (!this.preview) return;
    this.world.scene.remove(this.preview.group);
    this.preview.geometry.dispose();
    this.preview.material.dispose();
    this.preview = null;
  }

  cancelDrag() {
    if (this.activeAssetId) this.world.events.emit('editor.asset-placement-cancelled', { assetId:this.activeAssetId });
    this.clearPreview();
    this.activeAssetId = null;
    this.manifest = null;
    this.bounds = null;
    this.position = null;
    this.pose = null;
    this.surface = null;
  }

  dispose() {
    this.cancelDrag();
    this.element.removeEventListener('dragenter', this.onDragEnter);
    this.element.removeEventListener('dragover', this.onDragOver);
    this.element.removeEventListener('dragleave', this.onDragLeave);
    this.element.removeEventListener('drop', this.onDrop);
  }
}
