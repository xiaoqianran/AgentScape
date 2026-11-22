import { bindSceneControls } from '../ui/bindSceneControls.js';
import { bindRuntimeEvents } from '../ui/bindRuntimeEvents.js';
import { bindDebugLayers } from '../debug/bindDebugLayers.js';
import { bindAuthoringWorldControls } from '../authoring/bindAuthoringWorldControls.js';
import { createStudioStartupScope } from './createStudioStartupScope.js';

export async function activateStudioWorld({
  ui,
  world,
  scene,
  authoringWorlds,
  editor,
  worldSurface,
  taskPanel,
  lifecycle,
  inspector,
  openAuthoringWorld = (id)=>lifecycle.worldOpener.open({ kind:'authoring', id }),
  newAuthoringWorld = (options)=>lifecycle.worldOpener.open({ kind:'authoring-new', options }),
  onAuthoringSaved
}) {
  const log=(text,kind)=>taskPanel.log(text,kind);
  const scope = createStudioStartupScope();
  try {
    scope.add(bindRuntimeEvents({
      world,
      editor,
      inspector,
      taskPanel,
      ui,
      autosave:lifecycle.autosave
    }));

    await lifecycle.worldOpener.open({ kind:'current' });
    worldSurface.bindEnvironment({ identity:lifecycle.worldSession.current });

    const sceneControls = scope.add(bindSceneControls({
      world,
      scene,
      editor,
      sceneStore:lifecycle.sceneStore,
      worldSession:lifecycle.worldSession,
      log,
      setTaskState:(...args)=>taskPanel.setState(...args)
    }));
    scope.add(() => ui.attachSceneControls?.(null));
    ui.attachSceneControls?.(sceneControls);

    const authoringControls = authoringWorlds ? scope.add(bindAuthoringWorldControls({
      controller:authoringWorlds,
      openWorld:(id)=>openAuthoringWorld(id),
      newWorld:(options)=>newAuthoringWorld(options),
      onSaved:onAuthoringSaved,
      log
    })) : null;
    scope.add(() => ui.attachAuthoring?.(null));
    ui.attachAuthoring?.(authoringControls);

    scope.add(bindDebugLayers(world,{ log }));
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

    return { authoringControls, dispose:() => scope.dispose() };
  } catch (error) {
    scope.dispose();
    throw error;
  }
}
