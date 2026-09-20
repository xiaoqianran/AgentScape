import * as THREE from 'three';
import { disposeObject3D } from '../modules/rendering/disposeObject3D.js';
import {
  captureAuthoringState,
  exportAuthoringDocument,
  hydrateAuthoringState,
  hydrateAuthoringStateAsync,
  parseAuthoringDocument
} from './world-authoring/AuthoringDocument.js';
import { diffAuthoringDocuments } from './world-authoring/AuthoringDiff.js';
import { patchAuthoringDocument } from './world-authoring/AuthoringPatch.js';
import { AuthoringRevisionHistory } from './world-authoring/AuthoringRevisionHistory.js';
import { markAuthoringModelRef } from './world-authoring/ModelRef.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export function createWorldAuthoringContext(
  world,
  {
    historyLimit = 64,
    now = () => new Date().toISOString()
  } = {}
) {
  if (!world?.rendering?.addDecoration || !world?.rendering?.removeDecoration) {
    throw new TypeError('World authoring requires an attached RenderingSystem');
  }

  const root = new THREE.Group();
  root.name = '$llm-world';
  root.userData.worldAuthoringRoot = true;
  root.userData.authoringId = 'root';
  world.rendering.addDecoration(root);

  const frameHandlers = new Set();
  const revisions = new AuthoringRevisionHistory({ limit:historyLimit, now });
  let disposed = false;
  let promotedNodes = new Set();
  const suppressed = new Map();
  const restoreVisibility = () => {
    for (const [object, state] of suppressed) {
      Object.defineProperty(object, 'visible', { configurable:true, enumerable:true, writable:true, value:state.visible });
    }
    suppressed.clear();
  };
  const suppressVisibility = () => {
    root.traverse(object => {
      if (promotedNodes.has(object.userData?.authoringId)) {
        if (suppressed.has(object)) return;
        const state = { visible:object.visible };
        suppressed.set(object, state);
        Object.defineProperty(object, 'visible', { configurable:true, enumerable:true,
          get:()=>false, set:value=>{ state.visible = value; } });
      }
    });
  };
  const setPromotedNodes = (ids = []) => {
    restoreVisibility();
    promotedNodes = new Set(ids);
    suppressVisibility();
  };

  const assertActive = () => {
    if (disposed) throw new Error('World authoring context is disposed');
  };
  const changed = () => world.events?.emit?.('authoring.changed', {});

  const clear = () => {
    assertActive();
    restoreVisibility();
    frameHandlers.clear();
    for (const child of [...root.children]) {
      root.remove(child);
      disposeObject3D(child);
    }
    changed();
    return true;
  };

  const onFrame = (handler) => {
    assertActive();
    if (typeof handler !== 'function') throw new TypeError('World authoring frame handler must be a function');
    frameHandlers.add(handler);
    return () => frameHandlers.delete(handler);
  };

  const update = (delta = 0, elapsed = 0) => {
    if (disposed) return false;
    restoreVisibility();
    for (const handler of [...frameHandlers]) {
      try {
        handler(delta, elapsed);
      } catch (error) {
        frameHandlers.delete(handler);
        world.events?.emit?.('authoring.frame-error', {
          message:error?.message || String(error)
        });
      }
    }
    suppressVisibility();
    return true;
  };

  const modelRef = (object, reference) => {
    assertActive();
    return markAuthoringModelRef(object, reference);
  };

  const capture = () => {
    assertActive();
    restoreVisibility();
    try { return captureAuthoringState(root); }
    finally { suppressVisibility(); }
  };

  const exportDocument = () => exportAuthoringDocument(capture());

  const applyHydratedRoot = (hydratedRoot, state) => {
    clear();

    root.name = hydratedRoot.name || '$llm-world';
    root.position.copy(hydratedRoot.position);
    root.quaternion.copy(hydratedRoot.quaternion);
    root.scale.copy(hydratedRoot.scale);
    root.visible = hydratedRoot.visible;
    root.userData = {
      ...hydratedRoot.userData,
      authoringId: state.rootId,
      worldAuthoringRoot: true,
      visualDecoration: true
    };

    while (hydratedRoot.children.length > 0) {
      root.add(hydratedRoot.children[0]);
    }
    suppressVisibility();
    changed();
    return root;
  };

  const applyDocument = (document) => {
    const state = parseAuthoringDocument(document);
    const hydratedRoot = hydrateAuthoringState(state);
    return applyHydratedRoot(hydratedRoot, state);
  };

  const applyDocumentAsync = async (document, { resolveModel } = {}) => {
    const state = parseAuthoringDocument(document);
    const hydratedRoot = await hydrateAuthoringStateAsync(state, { resolveModel });
    return applyHydratedRoot(hydratedRoot, state);
  };

  const load = (document, { label = 'Loaded world' } = {}) => {
    assertActive();
    const result = applyDocument(document);
    revisions.reset(document, { label, source:'load' });
    return result;
  };

  const loadAsync = async (document, { resolveModel, label = 'Loaded world' } = {}) => {
    assertActive();
    const result = await applyDocumentAsync(document, { resolveModel });
    revisions.reset(document, { label, source:'load' });
    return result;
  };

  const normalizeCommitOptions = (options) => {
    if (typeof options === 'string') return { label:options };
    return options || {};
  };

  const commit = (options = {}) => {
    assertActive();
    const normalized = normalizeCommitOptions(options);
    return revisions.commit(exportDocument(), {
      ...normalized,
      source:normalized.source || 'manual'
    });
  };

  const patch = (changes, { label = 'Patch' } = {}) => {
    assertActive();
    const document = patchAuthoringDocument(exportDocument(), changes);
    applyDocument(document);
    revisions.commit(document, { label, source:'patch' });
    return document;
  };

  const patchAsync = async (changes, { resolveModel, label = 'Patch' } = {}) => {
    assertActive();
    const document = patchAuthoringDocument(exportDocument(), changes);
    await applyDocumentAsync(document, { resolveModel });
    revisions.commit(document, { label, source:'patch' });
    return document;
  };

  const history = () => {
    assertActive();
    return revisions.list();
  };

  const currentRevision = () => {
    assertActive();
    return revisions.current();
  };

  const diff = (fromRevisionId = null, toRevisionId = null) => {
    assertActive();

    if (fromRevisionId && toRevisionId) {
      return revisions.diff(fromRevisionId, toRevisionId);
    }

    const before = fromRevisionId
      ? revisions.getDocument(fromRevisionId)
      : revisions.currentDocument();

    if (!before) throw new Error('World Authoring has no committed revision');

    const after = toRevisionId
      ? revisions.getDocument(toRevisionId)
      : exportDocument();

    return diffAuthoringDocuments(before, after);
  };

  const undo = () => {
    assertActive();
    const result = revisions.undo();
    if (!result) return null;
    try {
      applyDocument(result.document);
      return result.revision;
    } catch (error) {
      revisions.redo();
      throw error;
    }
  };

  const redo = () => {
    assertActive();
    const result = revisions.redo();
    if (!result) return null;
    try {
      applyDocument(result.document);
      return result.revision;
    } catch (error) {
      revisions.undo();
      throw error;
    }
  };

  const undoAsync = async ({ resolveModel } = {}) => {
    assertActive();
    const result = revisions.undo();
    if (!result) return null;
    try {
      await applyDocumentAsync(result.document, { resolveModel });
      return result.revision;
    } catch (error) {
      revisions.redo();
      throw error;
    }
  };

  const redoAsync = async ({ resolveModel } = {}) => {
    assertActive();
    const result = revisions.redo();
    if (!result) return null;
    try {
      await applyDocumentAsync(result.document, { resolveModel });
      return result.revision;
    } catch (error) {
      revisions.undo();
      throw error;
    }
  };

  const canUndo = () => revisions.canUndo();
  const canRedo = () => revisions.canRedo();

  const get = (id) => {
    assertActive();
    if (typeof id !== 'string' || !id) return null;
    if (root.userData.authoringId === id) return root;
    let found = null;
    root.traverse((object) => {
      if (!found && object.userData?.authoringId === id) found = object;
    });
    return found;
  };

  revisions.reset(exportDocument(), {
    label:'Initial world',
    source:'init'
  });

  return {
    THREE,
    scene: root,
    clear,
    onFrame,
    update,
    modelRef,
    capture,
    export: exportDocument,
    load,
    loadAsync,
    commit,
    history,
    currentRevision,
    diff,
    patch,
    patchAsync,
    patchDocument: patchAuthoringDocument,
    undo,
    redo,
    undoAsync,
    redoAsync,
    canUndo,
    canRedo,
    get,
    setPromotedNodes,
    async run(source) {
      assertActive();
      if (typeof source !== 'string' || !source.trim()) throw new TypeError('World authoring source is required');
      const execute = new AsyncFunction(
        'THREE',
        'scene',
        'clear',
        'onFrame',
        'modelRef',
        `'use strict';\n${source}`
      );
      restoreVisibility();
      try { return await execute(THREE, root, clear, onFrame, modelRef); }
      finally { restoreVisibility(); suppressVisibility(); changed(); }
    },
    dispose() {
      if (disposed) return false;
      clear();
      disposed = true;
      return world.rendering.removeDecoration(root);
    }
  };
}
