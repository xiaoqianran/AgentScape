import { sceneError } from './SceneContracts.js';

const REVISION_EVENTS = ['history.recorded', 'history.applied', 'scene.restored'];

/** Owns Scene API lifecycle state shared by mutation, jobs and persistence services. */
export function createSceneLifecycle(world) {
  let busy = false;
  let closed = false;
  let revision = 0;
  const unsubscribe = REVISION_EVENTS.map(event => world.events.on(event, () => { revision++; }));

  const assertOpen = () => {
    if (closed) throw sceneError('SCENE_CLOSED');
  };
  const assertIdle = () => {
    assertOpen();
    if (busy || world.mutationOwner) throw sceneError('SCENE_BUSY');
  };
  const exclusive = async operation => {
    assertIdle();
    busy = true;
    try {
      return await operation();
    } finally {
      busy = false;
    }
  };
  const result = (operation, value, extra = {}) => ({
    schema: 'agentscape.scene-result',
    schemaVersion: 1,
    operation,
    status: 'succeeded',
    revision,
    admission: null,
    verification: { status: 'not-requested', evidence: null },
    diagnostics: [],
    value,
    ...extra
  });

  return {
    getRevision: () => revision,
    incrementRevision: () => { revision++; },
    setBusy: value => { busy = value; },
    assertOpen,
    assertIdle,
    exclusive,
    result,
    close() {
      if (closed) return false;
      assertIdle();
      closed = true;
      unsubscribe.forEach(fn => fn());
      return true;
    }
  };
}
