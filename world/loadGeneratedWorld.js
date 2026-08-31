import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';

const SUPPORTED_MESH_FORMATS = new Set(['ply']);
const SUPPORTED_COORDINATE_SYSTEMS = new Set(['y-up', 'z-up']);

const asBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
};

const asSource = (value, name) => {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim()) return { url:value.trim() };
  if (typeof value !== 'object') throw new TypeError(`${name} must be a URL string, { url }, or { data, format }`);
  if (typeof value.url === 'string' && value.url.trim()) return { ...value, url:value.url.trim() };
  const data = asBytes(value.data);
  if (data && typeof value.format === 'string' && value.format.trim()) return { ...value, data, format:value.format.trim().toLowerCase() };
  throw new TypeError(`${name} must be a URL string, { url }, or { data, format }`);
};

const sourceFormat = (source) => {
  const explicit = source.format?.toLowerCase();
  if (explicit) return explicit;
  const path = source.url?.split(/[?#]/, 1)[0] || '';
  return path.slice(path.lastIndexOf('.') + 1).toLowerCase();
};

const sourceDescriptor = (source) => source
  ? { ...(source.url ? { url:source.url } : {}), ...(source.format ? { format:sourceFormat(source) } : {}), ...(source.data ? { bytes:source.data.byteLength } : {}) }
  : null;

const toRuntimeCoordinates = (geometry, coordinateSystem) => {
  if (coordinateSystem === 'z-up') geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  return geometry;
};

const loadSemantics = async (source) => {
  if (!source) return null;
  if (source.data) return JSON.parse(new TextDecoder().decode(source.data));
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`Failed to load generated world semantics: ${response.status}`);
  return response.json();
};

export function geometryToTrimeshCollider(geometry) {
  const position = geometry?.getAttribute?.('position');
  if (!position || position.itemSize !== 3 || position.count < 3) throw new TypeError('Generated world mesh requires triangle positions');
  const vertices = Array.from(position.array);
  if (!vertices.every(Number.isFinite)) throw new TypeError('Generated world mesh contains non-finite vertices');

  const sourceIndex = geometry.getIndex();
  const indices = sourceIndex ? Array.from(sourceIndex.array) : Array.from({ length:position.count }, (_, index) => index);
  if (indices.length < 3 || indices.length % 3 !== 0 || !indices.every((value) => Number.isInteger(value) && value >= 0 && value < position.count)) {
    throw new TypeError('Generated world mesh requires valid triangle indices');
  }
  return { shape:'trimesh', vertices, indices };
}

async function loadMesh(source, coordinateSystem) {
  const format = sourceFormat(source);
  if (!SUPPORTED_MESH_FORMATS.has(format)) throw new TypeError(`Unsupported generated world mesh format: ${format || 'unknown'}`);
  const loader = new PLYLoader();
  const geometry = source.data
    ? loader.parse(source.data.buffer.slice(source.data.byteOffset, source.data.byteOffset + source.data.byteLength))
    : await loader.loadAsync(source.url);
  toRuntimeCoordinates(geometry, coordinateSystem);
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  return geometry;
}

/**
 * Load externally generated world files into AgentScape's existing runtime.
 * Generation stays outside AgentScape; this function only turns artifacts into
 * the Environment shape already consumed by Rendering, Physics and Navigation.
 */
export async function loadGeneratedWorld({
  id = 'generated-world',
  mesh,
  visual = null,
  semantics = null,
  coordinateSystem = 'y-up'
} = {}) {
  const meshSource = asSource(mesh, 'mesh');
  if (!meshSource) throw new TypeError('loadGeneratedWorld requires mesh');
  if (!SUPPORTED_COORDINATE_SYSTEMS.has(coordinateSystem)) throw new TypeError('coordinateSystem must be y-up or z-up');

  const visualSource = asSource(visual, 'visual');
  const semanticsSource = asSource(semantics, 'semantics');
  const [geometry, semanticData] = await Promise.all([
    loadMesh(meshSource, coordinateSystem),
    loadSemantics(semanticsSource)
  ]);

  const collider = geometryToTrimeshCollider(geometry);
  const root = new THREE.Group();
  root.name = 'GeneratedWorld';
  root.userData.generatedSemantics = semanticData;

  const floor = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    vertexColors:Boolean(geometry.getAttribute('color')),
    roughness:1,
    metalness:0
  }));
  floor.name = 'GeneratedWorldMesh';
  floor.receiveShadow = true;
  root.add(floor);

  return {
    id,
    root,
    floor,
    colliders:[collider],
    semantics:semanticData,
    generated:{
      mesh:sourceDescriptor(meshSource),
      visual:visualSource ? { ...sourceDescriptor(visualSource), status:'deferred' } : null,
      semantics:semanticsSource ? { ...sourceDescriptor(semanticsSource), data:semanticData } : null,
      coordinateSystem
    }
  };
}

