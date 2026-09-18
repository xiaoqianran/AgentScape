import { AUTHORING_FORMAT, AUTHORING_VERSION, parseAuthoringDocument } from './AuthoringDocument.js';

export const AUTHORING_DIFF_FORMAT = 'agentscape-world-authoring-diff';
export const AUTHORING_DIFF_VERSION = 1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value)
    .sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key]))
    .join(',') + '}';
}

function same(a, b) {
  return canonical(a) === canonical(b);
}

function flatten(document) {
  const state = parseAuthoringDocument(document);
  const records = {};

  for (const [id, node] of Object.entries(state.nodesById)) {
    const parentId = state.parentIdById[id];
    const siblings = parentId == null ? [id] : state.childIdsById[parentId] || [];
    records[id] = {
      id,
      parentId,
      index: siblings.indexOf(id),
      node: clone(node)
    };
  }

  return {
    state,
    records
  };
}

function diffResourcePool(beforePool = {}, afterPool = {}) {
  const added = [];
  const removed = [];
  const updated = [];

  for (const id of Object.keys(afterPool).sort()) {
    if (!(id in beforePool)) {
      added.push({ id, value:clone(afterPool[id]) });
    } else if (!same(beforePool[id], afterPool[id])) {
      updated.push({
        id,
        before:clone(beforePool[id]),
        after:clone(afterPool[id])
      });
    }
  }

  for (const id of Object.keys(beforePool).sort()) {
    if (!(id in afterPool)) {
      removed.push({ id, value:clone(beforePool[id]) });
    }
  }

  return { added, removed, updated };
}

export function diffAuthoringDocuments(before, after) {
  if (before?.format !== AUTHORING_FORMAT || before?.version !== AUTHORING_VERSION) {
    throw new TypeError('World Authoring diff requires a valid before document');
  }
  if (after?.format !== AUTHORING_FORMAT || after?.version !== AUTHORING_VERSION) {
    throw new TypeError('World Authoring diff requires a valid after document');
  }

  const left = flatten(before);
  const right = flatten(after);
  const added = [];
  const removed = [];
  const updated = [];
  const moved = [];

  for (const id of Object.keys(right.records).sort()) {
    const next = right.records[id];
    const previous = left.records[id];

    if (!previous) {
      added.push(clone(next));
      continue;
    }

    if (!same(previous.node, next.node)) {
      updated.push({
        id,
        before:clone(previous.node),
        after:clone(next.node)
      });
    }

    if (previous.parentId !== next.parentId || previous.index !== next.index) {
      moved.push({
        id,
        from:{ parentId:previous.parentId, index:previous.index },
        to:{ parentId:next.parentId, index:next.index }
      });
    }
  }

  for (const id of Object.keys(left.records).sort()) {
    if (!right.records[id]) removed.push(clone(left.records[id]));
  }

  const geometries = diffResourcePool(left.state.geometries, right.state.geometries);
  const materials = diffResourcePool(left.state.materials, right.state.materials);
  const textures = diffResourcePool(left.state.textures, right.state.textures);

  const empty = added.length === 0
    && removed.length === 0
    && updated.length === 0
    && moved.length === 0
    && geometries.added.length === 0
    && geometries.removed.length === 0
    && geometries.updated.length === 0
    && materials.added.length === 0
    && materials.removed.length === 0
    && materials.updated.length === 0
    && textures.added.length === 0
    && textures.removed.length === 0
    && textures.updated.length === 0;

  return {
    format:AUTHORING_DIFF_FORMAT,
    version:AUTHORING_DIFF_VERSION,
    empty,
    nodes:{ added, removed, updated, moved },
    resources:{ geometries, materials, textures }
  };
}

export function areAuthoringDocumentsEqual(a, b) {
  return same(a, b);
}

export function canonicalizeAuthoringDocument(document) {
  parseAuthoringDocument(document);
  return canonical(document);
}
