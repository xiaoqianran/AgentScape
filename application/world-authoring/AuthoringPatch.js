import {
  exportAuthoringDocument,
  parseAuthoringDocument
} from './AuthoringDocument.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeObject(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && result[key]
      && typeof result[key] === 'object'
      && !Array.isArray(result[key])
    ) {
      result[key] = mergeObject(result[key], value);
    } else {
      result[key] = clone(value);
    }
  }
  return result;
}

function removeSubtree(state, id) {
  if (id === state.rootId) throw new TypeError('World Authoring patch cannot remove the root');
  const node = state.nodesById[id];
  if (!node) throw new TypeError(`World Authoring patch node not found: ${id}`);

  for (const childId of [...(state.childIdsById[id] || [])]) {
    removeSubtree(state, childId);
  }

  const parentId = state.parentIdById[id];
  if (parentId && state.childIdsById[parentId]) {
    state.childIdsById[parentId] = state.childIdsById[parentId].filter(childId => childId !== id);
  }

  delete state.nodesById[id];
  delete state.childIdsById[id];
  delete state.parentIdById[id];
}

function insertNode(state, node, parentId, index) {
  if (!state.nodesById[parentId]) {
    throw new TypeError(`World Authoring patch parent not found: ${parentId}`);
  }
  if (state.nodesById[parentId].components?.modelRef) {
    throw new TypeError('World Authoring patch cannot add authored children to ModelRef');
  }
  if (!node || typeof node.id !== 'string' || !node.id) {
    throw new TypeError('World Authoring patch added node requires an id');
  }
  if (state.nodesById[node.id]) {
    throw new TypeError(`World Authoring patch duplicate node id: ${node.id}`);
  }

  const { children = [], ...record } = clone(node);
  state.nodesById[node.id] = record;
  state.parentIdById[node.id] = parentId;
  state.childIdsById[node.id] = [];

  const siblings = state.childIdsById[parentId];
  const insertAt = Number.isInteger(index) ? Math.max(0, Math.min(index, siblings.length)) : siblings.length;
  siblings.splice(insertAt, 0, node.id);

  for (const child of children) {
    insertNode(state, child, node.id);
  }
}

function mergeResources(target, additions, label) {
  for (const [id, definition] of Object.entries(additions || {})) {
    if (target[id] && JSON.stringify(target[id]) !== JSON.stringify(definition)) {
      throw new TypeError(`World Authoring patch ${label} id conflict: ${id}`);
    }
    target[id] = clone(definition);
  }
}

export function patchAuthoringDocument(document, patch = {}) {
  const state = parseAuthoringDocument(document);

  mergeResources(state.geometries, patch.geometries, 'geometry');
  mergeResources(state.materials, patch.materials, 'material');
  mergeResources(state.textures, patch.textures, 'texture');

  for (const change of patch.update || []) {
    if (!change || typeof change.id !== 'string') {
      throw new TypeError('World Authoring patch update requires an id');
    }
    const node = state.nodesById[change.id];
    if (!node) throw new TypeError(`World Authoring patch node not found: ${change.id}`);

    const { id, ...updates } = change;
    state.nodesById[id] = mergeObject(node, updates);
    state.nodesById[id].id = id;
  }

  for (const id of patch.remove || []) {
    removeSubtree(state, id);
  }

  for (const addition of patch.add || []) {
    if (!addition || typeof addition.parentId !== 'string' || !addition.node) {
      throw new TypeError('World Authoring patch add requires parentId and node');
    }
    insertNode(state, addition.node, addition.parentId, addition.index);
  }

  return exportAuthoringDocument(state);
}
