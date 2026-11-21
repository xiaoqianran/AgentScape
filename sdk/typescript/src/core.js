/**
 * A framework-agnostic semantic extension for a user-owned Three.js scene.
 * It never creates a renderer, starts a loop, rewrites Object3D or executes code.
 * Policies, transports, persistence, physics and agent tooling belong to plugins.
 */
const isObject = object => object?.isObject3D === true;
const fail = message => { throw new TypeError(message); };

function actionOf(value) {
  if (typeof value === 'function') return { execute: value, description: '', available: null };
  if (!value || typeof value.execute !== 'function') fail('Action requires a function or { execute }');
  if (value.available != null && typeof value.available !== 'function') fail('Action available must be a function');
  return { execute: value.execute, description: value.description || '', available: value.available || null };
}

function parseActions(actions) {
  if (actions == null) return new Map();
  if (typeof actions !== 'object' || Array.isArray(actions)) fail('Actions must be a name-to-handler object');
  const result = new Map();
  for (const [name, action] of Object.entries(actions)) {
    if (!name.trim()) fail('Action name must be non-empty');
    result.set(name, actionOf(action));
  }
  return result;
}

function inside(root, object) {
  for (let current = object; current; current = current.parent) {
    if (current === root) return true;
  }
  return false;
}

/**
 * Attach semantic metadata and callable actions to an existing THREE.Scene.
 * Native Three.js behavior and ownership remain entirely with the caller.
 *
 * @param {import('./core.d.ts').SemanticScene} scene
 * @returns {import('./core.d.ts').SemanticWorld}
 */
export function attach(scene) {
  if (!isObject(scene) || scene.isScene !== true) fail('attach(scene) requires a THREE.Scene');
  const entries = new Map();
  const objects = new WeakMap();
  const listeners = new Set();
  const plugins = [];
  let disposed = false;
  const ensureOpen = () => { if (disposed) throw new Error('SEMANTIC_WORLD_DISPOSED'); };
  let world;

  const find = value => typeof value === 'string' ? entries.get(value) : objects.get(value);
  const emit = (type, id) => {
    for (const listener of [...listeners]) {
      try { listener({ type, id, world }); }
      catch { /* A plugin must not break its host scene. */ }
    }
  };
  const describe = entry => ({
    id: entry.id,
    name: entry.object.name || '',
    type: entry.type,
    label: entry.label,
    description: entry.description,
    properties: entry.properties,
    attached: inside(scene, entry.object),
    state: entry.read ? entry.read() : {},
    actions: [...entry.actions].map(([name, action]) => ({
      name,
      description: action.description,
      available: action.available ? Boolean(action.available({ object: entry.object, world })) : true
    }))
  });

  function unregister(target) {
    ensureOpen();
    const entry = find(target);
    if (!entry) return false;
    entries.delete(entry.id);
    objects.delete(entry.object);
    emit('entity.unregistered', entry.id);
    return true;
  }

  function register(object, definition = {}) {
    ensureOpen();
    if (!isObject(object)) fail('register(object) requires a THREE.Object3D');
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) fail('Invalid semantic definition');
    const id = definition.id ?? object.uuid;
    if (typeof id !== 'string' || !id.trim()) fail('Entity id must be a non-empty string');
    if (entries.has(id) || objects.has(object)) fail('SEMANTIC_ENTITY_CONFLICT');
    if (definition.read != null && typeof definition.read !== 'function') fail('Entity read must be a function');
    const actions = parseActions(definition.actions);
    const entry = {
      id, object,
      type: definition.type || '',
      label: definition.label || object.name || id,
      description: definition.description || '',
      properties: definition.properties ?? {},
      read: definition.read || null,
      actions
    };
    entries.set(id, entry);
    objects.set(object, entry);
    emit('entity.registered', id);
    return () => entries.get(id) === entry && unregister(id);
  }

  function registerAction(target, name, value) {
    ensureOpen();
    const entry = find(target);
    if (!entry) fail('SEMANTIC_ENTITY_NOT_FOUND');
    if (typeof name !== 'string' || !name.trim()) fail('Action name must be non-empty');
    if (entry.actions.has(name)) fail('SEMANTIC_ACTION_CONFLICT');
    const action = actionOf(value);
    entry.actions.set(name, action);
    emit('action.registered', entry.id);
    return () => {
      if (entries.get(entry.id) !== entry || entry.actions.get(name) !== action) return false;
      entry.actions.delete(name);
      emit('action.unregistered', entry.id);
      return true;
    };
  }

  async function invoke(target, name, args = {}, options = {}) {
    ensureOpen();
    const entry = find(target);
    if (!entry) fail('SEMANTIC_ENTITY_NOT_FOUND');
    const action = entry.actions.get(name);
    if (!action) fail('SEMANTIC_ACTION_NOT_FOUND');
    const context = { object: entry.object, world, signal: options.signal };
    if (action.available && !action.available(context)) fail('SEMANTIC_ACTION_UNAVAILABLE');
    const value = await action.execute(args, context);
    emit('action.invoked', entry.id);
    return value;
  }

  function uninstall(pluginEntry) {
    if (!pluginEntry.active) return false;
    pluginEntry.active = false;
    plugins.splice(plugins.indexOf(pluginEntry), 1);
    pluginEntry.teardown?.();
    return true;
  }

  world = {
    scene,
    register,
    unregister,
    registerAction,
    getObject(target) {
      ensureOpen();
      return find(target)?.object || null;
    },
    inspect(target) {
      ensureOpen();
      const entry = find(target);
      return entry ? describe(entry) : null;
    },
    list({ attachedOnly = false } = {}) {
      ensureOpen();
      return [...entries.values()].filter(entry => !attachedOnly || inside(scene, entry.object)).map(describe);
    },
    invoke,
    subscribe(listener) {
      ensureOpen();
      if (typeof listener !== 'function') fail('Listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    use(plugin, options) {
      ensureOpen();
      const install = typeof plugin === 'function' ? plugin : plugin?.install?.bind(plugin);
      if (typeof install !== 'function') fail('Plugin requires an install(world, options) function');
      const result = install(world, options);
      const teardown = typeof result === 'function' ? result : result?.dispose?.bind(result);
      const entry = { active: true, teardown };
      plugins.push(entry);
      return () => uninstall(entry);
    },
    dispose() {
      if (disposed) return;
      for (const entry of [...plugins].reverse()) {
        try { uninstall(entry); } catch { /* Host scene disposal must remain reliable. */ }
      }
      for (const id of [...entries.keys()]) unregister(id);
      disposed = true;
      emit('disposed', null);
      listeners.clear();
    }
  };
  return world;
}
