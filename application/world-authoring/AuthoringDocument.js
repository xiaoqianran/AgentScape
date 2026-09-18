import * as THREE from 'three';
import { cloneAuthoringModelRef, getAuthoringModelRef } from './ModelRef.js';

export const AUTHORING_FORMAT = 'agentscape-world-authoring';
export const AUTHORING_VERSION = 1;

const ROOT_ID = 'root';
const RESERVED_USER_DATA = new Set([
  'authoringId',
  'authoringGeometryId',
  'authoringMaterialId',
  'authoringTextureId',
  'authoringSource',
  'authoringModelRef',
  'instanceId',
  'visualDecoration',
  'visualDecorationRoot',
  'worldAuthoringRoot'
]);

const PRIMITIVE_GEOMETRIES = new Set([
  'BoxGeometry',
  'SphereGeometry',
  'PlaneGeometry',
  'CylinderGeometry',
  'ConeGeometry',
  'TorusGeometry'
]);

const MATERIAL_TYPES = new Set([
  'MeshBasicMaterial',
  'MeshStandardMaterial',
  'MeshPhysicalMaterial'
]);

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'alphaMap',
  'aoMap'
];

function makeId(prefix) {
  return `${prefix}_${THREE.MathUtils.generateUUID().toLowerCase()}`;
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureObjectId(object, usedIds, isRoot = false) {
  object.userData ||= {};
  let id = isRoot ? ROOT_ID : object.userData.authoringId;
  if (
    typeof id !== 'string'
    || !id.trim()
    || (usedIds.has(id) && usedIds.get(id) !== object)
  ) {
    id = isRoot ? ROOT_ID : makeId('node');
  }
  object.userData.authoringId = id;
  usedIds.set(id, object);
  return id;
}

function ensureResourceId(resource, key, prefix, usedIds) {
  resource.userData ||= {};
  let id = resource.userData[key];
  if (
    typeof id !== 'string'
    || !id.trim()
    || (usedIds.has(id) && usedIds.get(id) !== resource)
  ) {
    id = makeId(prefix);
  }
  resource.userData[key] = id;
  usedIds.set(id, resource);
  return id;
}

function toJsonValue(value, seen = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    const result = value.map(item => toJsonValue(item, seen)).filter(item => item !== undefined);
    seen.delete(value);
    return result;
  }
  if (typeof value !== 'object' || value?.isObject3D || value?.isMaterial || value?.isTexture) return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (RESERVED_USER_DATA.has(key)) continue;
    const converted = toJsonValue(entry, seen);
    if (converted !== undefined) result[key] = converted;
  }
  seen.delete(value);
  return result;
}

function captureMetadata(object) {
  const metadata = toJsonValue(object.userData);
  return metadata && Object.keys(metadata).length > 0 ? metadata : undefined;
}

function transformComponent(object) {
  return {
    type: 'Transform',
    properties: {
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray()
    }
  };
}

function geometryDefinition(geometry) {
  if (PRIMITIVE_GEOMETRIES.has(geometry.type) && geometry.parameters) {
    return {
      type: geometry.type,
      parameters: structuredCloneJson(geometry.parameters)
    };
  }

  const json = geometry.toJSON();
  delete json.metadata;
  delete json.uuid;
  delete json.userData;
  return {
    type: 'BufferGeometry',
    sourceType: geometry.type,
    json
  };
}

function textureSource(texture) {
  const explicit = texture.userData?.authoringSource;
  if (explicit && typeof explicit === 'object') {
    const source = toJsonValue(explicit);
    if (source?.type === 'url' && typeof source.uri === 'string' && source.uri) return source;
  }

  const image = texture.image;
  const uri = image?.currentSrc || image?.src;
  if (typeof uri === 'string' && uri) return { type: 'url', uri };

  if (image?.data && Number.isFinite(image.width) && Number.isFinite(image.height)) {
    const data = Array.from(image.data);
    return {
      type: 'data',
      width: image.width,
      height: image.height,
      dataType: image.data.constructor?.name || 'Uint8Array',
      data
    };
  }

  throw new TypeError('World Authoring texture requires a URL or DataTexture source');
}

function textureDefinition(texture) {
  return {
    source: textureSource(texture),
    mapping: texture.mapping,
    wrapS: texture.wrapS,
    wrapT: texture.wrapT,
    magFilter: texture.magFilter,
    minFilter: texture.minFilter,
    anisotropy: texture.anisotropy,
    format: texture.format,
    type: texture.type,
    colorSpace: texture.colorSpace,
    flipY: texture.flipY,
    premultiplyAlpha: texture.premultiplyAlpha,
    generateMipmaps: texture.generateMipmaps,
    offset: texture.offset.toArray(),
    repeat: texture.repeat.toArray(),
    center: texture.center.toArray(),
    rotation: texture.rotation
  };
}

function captureMaterial(
  material,
  textureIds,
  textures
) {
  if (!MATERIAL_TYPES.has(material.type)) {
    throw new TypeError(`Unsupported World Authoring material: ${material.type}`);
  }

  const json = material.toJSON();
  delete json.metadata;
  delete json.uuid;
  delete json.userData;
  delete json.textures;
  delete json.images;

  for (const slot of TEXTURE_SLOTS) {
    const texture = material[slot];
    if (!texture) {
      delete json[slot];
      continue;
    }
    const textureId = ensureResourceId(texture, 'authoringTextureId', 'tex', textureIds);
    if (!textures[textureId]) textures[textureId] = textureDefinition(texture);
    json[slot] = textureId;
  }

  return json;
}

function lightComponent(object) {
  if (!(object.isAmbientLight || object.isHemisphereLight || object.isDirectionalLight || object.isPointLight || object.isSpotLight)) return null;

  const base = {
    color: `#${object.color.getHexString()}`,
    intensity: object.intensity
  };

  if (object.isAmbientLight) return { type: 'AmbientLight', properties: base };
  if (object.isHemisphereLight) {
    return {
      type: 'HemisphereLight',
      properties: {
        ...base,
        groundColor: `#${object.groundColor.getHexString()}`
      }
    };
  }
  if (object.isDirectionalLight) {
    return {
      type: 'DirectionalLight',
      properties: {
        ...base,
        target: object.target.position.toArray(),
        castShadow: object.castShadow
      }
    };
  }
  if (object.isPointLight) {
    return {
      type: 'PointLight',
      properties: {
        ...base,
        distance: object.distance,
        decay: object.decay,
        castShadow: object.castShadow
      }
    };
  }
  if (object.isSpotLight) {
    return {
      type: 'SpotLight',
      properties: {
        ...base,
        distance: object.distance,
        angle: object.angle,
        penumbra: object.penumbra,
        decay: object.decay,
        target: object.target.position.toArray(),
        castShadow: object.castShadow
      }
    };
  }
  return null;
}

function captureMeshResources(
  object,
  geometryIds,
  materialIds,
  textureIds,
  geometries,
  materials,
  textures
) {
  if (Array.isArray(object.material)) {
    throw new TypeError('World Authoring v1 does not persist multi-material Mesh');
  }

  const geometryId = ensureResourceId(object.geometry, 'authoringGeometryId', 'geo', geometryIds);
  const materialId = ensureResourceId(object.material, 'authoringMaterialId', 'mat', materialIds);

  if (!geometries[geometryId]) geometries[geometryId] = geometryDefinition(object.geometry);
  if (!materials[materialId]) {
    materials[materialId] = captureMaterial(object.material, textureIds, textures);
  }

  return { geometryId, materialId };
}

function captureInstancedMesh(object) {
  const matrices = Array.from(object.instanceMatrix.array);
  const colors = object.instanceColor ? Array.from(object.instanceColor.array) : undefined;
  return {
    type: 'InstancedMesh',
    properties: {
      count: object.count,
      matrices,
      ...(colors ? { colors } : {}),
      castShadow: object.castShadow,
      receiveShadow: object.receiveShadow
    }
  };
}

function captureNode(
  object,
  geometryIds,
  materialIds,
  textureIds,
  geometries,
  materials,
  textures
) {
  const components = { transform: transformComponent(object) };

  const modelRef = getAuthoringModelRef(object);
  if (modelRef) {
    components.modelRef = {
      type: 'ModelRef',
      properties: cloneAuthoringModelRef(modelRef)
    };
  } else if (object.isInstancedMesh) {
    const { geometryId, materialId } = captureMeshResources(
      object,
      geometryIds,
      materialIds,
      textureIds,
      geometries,
      materials,
      textures
    );
    components.instancedMesh = captureInstancedMesh(object);
    components.geometry = { type: 'GeometryRef', properties: { geometryId } };
    components.material = { type: 'MaterialRef', properties: { materialId } };
  } else if (object.isMesh) {
    const { geometryId, materialId } = captureMeshResources(
      object,
      geometryIds,
      materialIds,
      textureIds,
      geometries,
      materials,
      textures
    );
    components.mesh = {
      type: 'Mesh',
      properties: {
        castShadow: object.castShadow,
        receiveShadow: object.receiveShadow
      }
    };
    components.geometry = { type: 'GeometryRef', properties: { geometryId } };
    components.material = { type: 'MaterialRef', properties: { materialId } };
  } else {
    const light = lightComponent(object);
    if (light) {
      components.light = light;
    } else if (!(object.isGroup || object.type === 'Object3D')) {
      throw new TypeError(`Unsupported World Authoring object: ${object.type}`);
    }
  }

  const node = {
    id: object.userData.authoringId,
    name: object.name || undefined,
    visible: object.visible === false ? false : undefined,
    components
  };
  const metadata = captureMetadata(object);
  if (metadata) node.metadata = metadata;
  return node;
}

export function captureAuthoringState(root) {
  if (!root?.isObject3D) throw new TypeError('World Authoring capture requires an Object3D root');

  const state = {
    version: AUTHORING_VERSION,
    rootId: ROOT_ID,
    nodesById: {},
    childIdsById: {},
    parentIdById: {},
    geometries: {},
    materials: {},
    textures: {}
  };

  const objectIds = new Map();
  const geometryIds = new Map();
  const materialIds = new Map();
  const textureIds = new Map();

  function visit(object, parentId = null, isRoot = false) {
    const id = ensureObjectId(object, objectIds, isRoot);
    const node = captureNode(
      object,
      geometryIds,
      materialIds,
      textureIds,
      state.geometries,
      state.materials,
      state.textures
    );
    node.id = id;

    state.nodesById[id] = node;
    state.parentIdById[id] = parentId;
    state.childIdsById[id] = [];

    if (!node.components.modelRef) {
      for (const child of object.children) {
        const childId = visit(child, id, false);
        state.childIdsById[id].push(childId);
      }
    }
    return id;
  }

  state.rootId = visit(root, null, true);
  return state;
}

function denormalizeNode(id, state) {
  const node = state.nodesById[id];
  if (!node) throw new TypeError(`Missing World Authoring node: ${id}`);
  const childIds = state.childIdsById[id] || [];
  if (node.components?.modelRef && childIds.length > 0) {
    throw new TypeError('World Authoring ModelRef node cannot contain authored children');
  }
  const children = childIds.map(childId => denormalizeNode(childId, state));
  return {
    ...structuredCloneJson(node),
    ...(children.length ? { children } : {})
  };
}

export function exportAuthoringDocument(state) {
  if (!state || state.version !== AUTHORING_VERSION || !state.rootId) {
    throw new TypeError('Invalid World Authoring state');
  }
  return {
    format: AUTHORING_FORMAT,
    version: AUTHORING_VERSION,
    root: denormalizeNode(state.rootId, state),
    ...(Object.keys(state.geometries || {}).length ? { geometries: structuredCloneJson(state.geometries) } : {}),
    ...(Object.keys(state.materials || {}).length ? { materials: structuredCloneJson(state.materials) } : {}),
    ...(Object.keys(state.textures || {}).length ? { textures: structuredCloneJson(state.textures) } : {})
  };
}

export function parseAuthoringDocument(document) {
  if (!document || document.format !== AUTHORING_FORMAT) {
    throw new TypeError(`World Authoring document format must be ${AUTHORING_FORMAT}`);
  }
  if (document.version !== AUTHORING_VERSION) {
    throw new TypeError(`Unsupported World Authoring document version: ${document.version}`);
  }
  if (!document.root || typeof document.root.id !== 'string') {
    throw new TypeError('World Authoring document requires a root node');
  }

  const state = {
    version: AUTHORING_VERSION,
    rootId: document.root.id,
    nodesById: {},
    childIdsById: {},
    parentIdById: {},
    geometries: structuredCloneJson(document.geometries || {}),
    materials: structuredCloneJson(document.materials || {}),
    textures: structuredCloneJson(document.textures || {})
  };

  function insert(node, parentId) {
    if (!node || typeof node.id !== 'string' || !node.id) throw new TypeError('World Authoring node id is required');
    if (state.nodesById[node.id]) throw new TypeError(`Duplicate World Authoring node id: ${node.id}`);
    const { children = [], ...record } = node;
    if (record.components?.modelRef && children.length > 0) {
      throw new TypeError('World Authoring ModelRef node cannot contain authored children');
    }
    state.nodesById[node.id] = structuredCloneJson(record);
    state.parentIdById[node.id] = parentId;
    state.childIdsById[node.id] = [];
    for (const child of children) {
      insert(child, node.id);
      state.childIdsById[node.id].push(child.id);
    }
  }

  insert(document.root, null);
  return state;
}

function createPrimitiveGeometry(definition) {
  const p = definition.parameters || {};
  switch (definition.type) {
    case 'BoxGeometry':
      return new THREE.BoxGeometry(p.width, p.height, p.depth, p.widthSegments, p.heightSegments, p.depthSegments);
    case 'SphereGeometry':
      return new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments, p.phiStart, p.phiLength, p.thetaStart, p.thetaLength);
    case 'PlaneGeometry':
      return new THREE.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments);
    case 'CylinderGeometry':
      return new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
    case 'ConeGeometry':
      return new THREE.ConeGeometry(p.radius, p.height, p.radialSegments, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
    case 'TorusGeometry':
      return new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments, p.arc);
    default:
      return null;
  }
}

function hydrateGeometries(definitions) {
  const geometries = {};
  for (const [id, definition] of Object.entries(definitions || {})) {
    let geometry = createPrimitiveGeometry(definition);
    if (!geometry && definition.type === 'BufferGeometry' && definition.json) {
      geometry = new THREE.BufferGeometryLoader().parse(definition.json);
    }
    if (!geometry) throw new TypeError(`Unsupported World Authoring geometry: ${definition.type}`);
    geometry.userData ||= {};
    geometry.userData.authoringGeometryId = id;
    geometries[id] = geometry;
  }
  return geometries;
}

const TYPED_ARRAYS = {
  Uint8Array,
  Uint8ClampedArray,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  Float32Array,
  Float64Array
};

function hydrateTextureSource(source) {
  if (source?.type === 'data') {
    const ArrayType = TYPED_ARRAYS[source.dataType] || Uint8Array;
    const texture = new THREE.DataTexture(
      new ArrayType(source.data || []),
      source.width,
      source.height
    );
    texture.needsUpdate = true;
    return texture;
  }

  if (source?.type === 'url' && typeof source.uri === 'string' && source.uri) {
    let texture;
    if (typeof document !== 'undefined') {
      texture = new THREE.TextureLoader().load(source.uri);
    } else {
      texture = new THREE.Texture();
    }
    texture.userData ||= {};
    texture.userData.authoringSource = structuredCloneJson(source);
    return texture;
  }

  throw new TypeError('Unsupported World Authoring texture source');
}

function hydrateTextures(definitions) {
  const textures = {};
  for (const [id, definition] of Object.entries(definitions || {})) {
    const texture = hydrateTextureSource(definition.source);
    texture.mapping = definition.mapping ?? texture.mapping;
    texture.wrapS = definition.wrapS ?? texture.wrapS;
    texture.wrapT = definition.wrapT ?? texture.wrapT;
    texture.magFilter = definition.magFilter ?? texture.magFilter;
    texture.minFilter = definition.minFilter ?? texture.minFilter;
    texture.anisotropy = definition.anisotropy ?? texture.anisotropy;
    texture.format = definition.format ?? texture.format;
    texture.type = definition.type ?? texture.type;
    texture.colorSpace = definition.colorSpace ?? texture.colorSpace;
    texture.flipY = definition.flipY ?? texture.flipY;
    texture.premultiplyAlpha = definition.premultiplyAlpha ?? texture.premultiplyAlpha;
    texture.generateMipmaps = definition.generateMipmaps ?? texture.generateMipmaps;
    if (Array.isArray(definition.offset)) texture.offset.fromArray(definition.offset);
    if (Array.isArray(definition.repeat)) texture.repeat.fromArray(definition.repeat);
    if (Array.isArray(definition.center)) texture.center.fromArray(definition.center);
    if (Number.isFinite(definition.rotation)) texture.rotation = definition.rotation;
    texture.userData ||= {};
    texture.userData.authoringTextureId = id;
    if (definition.source) texture.userData.authoringSource = structuredCloneJson(definition.source);
    textures[id] = texture;
  }
  return textures;
}

function hydrateMaterials(definitions, textures) {
  const materials = {};
  const loader = new THREE.MaterialLoader();
  loader.setTextures(textures);
  for (const [id, definition] of Object.entries(definitions || {})) {
    if (!MATERIAL_TYPES.has(definition.type)) {
      throw new TypeError(`Unsupported World Authoring material: ${definition.type}`);
    }
    const material = loader.parse(definition);
    material.userData ||= {};
    material.userData.authoringMaterialId = id;
    materials[id] = material;
  }
  return materials;
}

function applyTransform(object, component) {
  const p = component?.properties || {};
  if (Array.isArray(p.position) && p.position.length === 3) object.position.fromArray(p.position);
  if (Array.isArray(p.quaternion) && p.quaternion.length === 4) object.quaternion.fromArray(p.quaternion);
  if (Array.isArray(p.scale) && p.scale.length === 3) object.scale.fromArray(p.scale);
}

function createLight(component) {
  const p = component.properties || {};
  const color = p.color ?? '#ffffff';
  let light;
  switch (component.type) {
    case 'AmbientLight':
      light = new THREE.AmbientLight(color, p.intensity);
      break;
    case 'HemisphereLight':
      light = new THREE.HemisphereLight(color, p.groundColor ?? '#ffffff', p.intensity);
      break;
    case 'DirectionalLight':
      light = new THREE.DirectionalLight(color, p.intensity);
      if (Array.isArray(p.target)) light.target.position.fromArray(p.target);
      light.castShadow = Boolean(p.castShadow);
      break;
    case 'PointLight':
      light = new THREE.PointLight(color, p.intensity, p.distance, p.decay);
      light.castShadow = Boolean(p.castShadow);
      break;
    case 'SpotLight':
      light = new THREE.SpotLight(color, p.intensity, p.distance, p.angle, p.penumbra, p.decay);
      if (Array.isArray(p.target)) light.target.position.fromArray(p.target);
      light.castShadow = Boolean(p.castShadow);
      break;
    default:
      throw new TypeError(`Unsupported World Authoring light: ${component.type}`);
  }
  return light;
}

function requiredMeshResources(components, geometries, materials) {
  const geometryId = components.geometry?.properties?.geometryId;
  const materialId = components.material?.properties?.materialId;
  const geometry = geometries[geometryId];
  const material = materials[materialId];
  if (!geometry) throw new TypeError(`Missing World Authoring geometry: ${geometryId}`);
  if (!material) throw new TypeError(`Missing World Authoring material: ${materialId}`);
  return { geometry, material };
}

function createInstancedMesh(component, geometry, material) {
  const p = component.properties || {};
  const count = Number(p.count);
  if (!Number.isInteger(count) || count < 0) throw new TypeError('Invalid World Authoring InstancedMesh count');
  const object = new THREE.InstancedMesh(geometry, material, count);
  const matrices = p.matrices || [];
  if (matrices.length !== count * 16) {
    throw new TypeError('Invalid World Authoring InstancedMesh matrix data');
  }
  object.instanceMatrix.array.set(matrices);
  object.instanceMatrix.needsUpdate = true;
  if (Array.isArray(p.colors)) {
    if (p.colors.length !== count * 3) throw new TypeError('Invalid World Authoring InstancedMesh color data');
    object.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(p.colors), 3);
    object.instanceColor.needsUpdate = true;
  }
  object.castShadow = Boolean(p.castShadow);
  object.receiveShadow = Boolean(p.receiveShadow);
  return object;
}

function createObjectForNode(node, geometries, materials) {
  const components = node.components || {};
  let object;

  if (components.modelRef) {
    throw new TypeError('World Authoring ModelRef requires loadAsync()');
  } else if (components.instancedMesh) {
    const { geometry, material } = requiredMeshResources(components, geometries, materials);
    object = createInstancedMesh(components.instancedMesh, geometry, material);
  } else if (components.mesh) {
    const { geometry, material } = requiredMeshResources(components, geometries, materials);
    object = new THREE.Mesh(geometry, material);
    object.castShadow = Boolean(components.mesh.properties?.castShadow);
    object.receiveShadow = Boolean(components.mesh.properties?.receiveShadow);
  } else if (components.light) {
    object = createLight(components.light);
  } else {
    object = new THREE.Group();
  }

  object.name = node.name || '';
  object.visible = node.visible !== false;
  object.userData = {
    authoringId: node.id,
    ...(node.metadata ? structuredCloneJson(node.metadata) : {})
  };
  applyTransform(object, components.transform);
  return object;
}

export function hydrateAuthoringState(state) {
  if (!state || state.version !== AUTHORING_VERSION) throw new TypeError('Invalid World Authoring state');

  const geometries = hydrateGeometries(state.geometries);
  const textures = hydrateTextures(state.textures);
  const materials = hydrateMaterials(state.materials, textures);

  function build(id) {
    const node = state.nodesById[id];
    if (!node) throw new TypeError(`Missing World Authoring node: ${id}`);
    const object = createObjectForNode(node, geometries, materials);
    for (const childId of state.childIdsById[id] || []) object.add(build(childId));
    return object;
  }

  return build(state.rootId);
}



async function createObjectForNodeAsync(node, geometries, materials, resolveModel) {
  const components = node.components || {};
  if (!components.modelRef) return createObjectForNode(node, geometries, materials);
  if (typeof resolveModel !== 'function') {
    throw new TypeError('World Authoring loadAsync requires resolveModel for ModelRef');
  }

  const reference = cloneAuthoringModelRef(components.modelRef.properties);
  const resolved = await resolveModel(reference, node);
  if (!resolved?.isObject3D) {
    throw new TypeError('World Authoring ModelRef resolver must return an Object3D');
  }

  const object = new THREE.Group();
  object.name = node.name || '';
  object.visible = node.visible !== false;
  object.userData = {
    authoringId: node.id,
    authoringModelRef: reference,
    ...(node.metadata ? structuredCloneJson(node.metadata) : {})
  };
  applyTransform(object, components.transform);
  object.add(resolved);
  return object;
}

export async function hydrateAuthoringStateAsync(state, { resolveModel } = {}) {
  if (!state || state.version !== AUTHORING_VERSION) throw new TypeError('Invalid World Authoring state');

  const geometries = hydrateGeometries(state.geometries);
  const textures = hydrateTextures(state.textures);
  const materials = hydrateMaterials(state.materials, textures);

  async function build(id) {
    const node = state.nodesById[id];
    if (!node) throw new TypeError('Missing World Authoring node: ' + id);
    const object = await createObjectForNodeAsync(node, geometries, materials, resolveModel);
    for (const childId of state.childIdsById[id] || []) object.add(await build(childId));
    return object;
  }

  return build(state.rootId);
}
