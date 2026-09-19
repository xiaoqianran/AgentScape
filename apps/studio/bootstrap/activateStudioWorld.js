import { bindSceneControls } from '../ui/bindSceneControls.js';
import { bindRuntimeEvents } from '../ui/bindRuntimeEvents.js';
import { bindDebugLayers } from '../debug/bindDebugLayers.js';
import { bindAuthoringWorldControls } from '../authoring/bindAuthoringWorldControls.js';

export async function activateStudioWorld({
  app,
  ui,
  world,
  authoringWorlds,
  editor,
  worldSurface,
  taskPanel,
  lifecycle,
  inspector
}) {
  const log=(text,kind)=>taskPanel.log(text,kind);
  const runtimeEvents=bindRuntimeEvents({
    world,
    editor,
    inspector,
    taskPanel,
    ui,
    autosave:lifecycle.autosave
  });
  const debugLayers=bindDebugLayers(world,{ log });

  await lifecycle.worldOpener.open({ kind:'current' });
  worldSurface.bindEnvironment({ identity:lifecycle.worldSession.current });

  const sceneControls=bindSceneControls({
    root:app,
    world,
    editor,
    sceneStore:lifecycle.sceneStore,
    worldSession:lifecycle.worldSession,
    log,
    setTaskState:(...args)=>taskPanel.setState(...args)
  });

  const authoringControls=authoringWorlds ? bindAuthoringWorldControls({
    root:app,
    controller:authoringWorlds,
    openWorld:(id)=>lifecycle.worldOpener.open({ kind:'authoring', id }),
    newWorld:(options)=>lifecycle.worldOpener.open({ kind:'authoring-new', options }),
    log
  }) : null;

  inspector.render(null);
  world.history.clear();

  const rendering=world.rendering?.diagnostics?.() || {};
  const backend=rendering.backend === 'webgpu'
    ? 'WebGPU'
    : (rendering.backend === 'webgl2' ? 'WebGL2' : '未知后端');

  ui.setRuntimeStatus('ready',`就绪 · ${backend}`);
  log(
    `场景已就绪 · ${world.queries.listObjects().length} 个对象 · ${rendering.renderer || 'Renderer'} / ${backend}${rendering.fallback ? ' fallback' : ''}`,
    'result'
  );

  return {
    dispose() {
      authoringControls?.dispose();
      sceneControls?.dispose?.();
      debugLayers?.dispose?.();
      runtimeEvents?.dispose?.();
    }
  };
}
