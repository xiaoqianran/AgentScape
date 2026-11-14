import { AssetPlacementController } from '../editor/AssetPlacementController.js';
import { MechanicalAssetController } from '../assets/MechanicalAssetController.js';
import { StudioResources } from '../resources/StudioResources.js';
import { BuildSession } from '../build/BuildSession.js';
import { StudioBuildController } from '../build/StudioBuildController.js';
import { AssetAgentVerifier } from '../agent/AssetAgentVerifier.js';
import { EditorCommandQueue } from '../editor/EditorCommandQueue.js';
import { InspectorProjection } from '../inspect/InspectorProjection.js';
import { createSceneFacade } from '../../../application/scene/SceneFacade.js';

export function createStudioContent({
  ui,
  environmentDefinition,
  environments,
  world,
  authoring = null,
  studioTools,
  editor,
  taskPanel,
  openBuiltinWorld,
  openGeneratedWorld
}) {
  const log = (text,kind)=>taskPanel.log(text,kind);
  const placement = new AssetPlacementController({
    world,
    tools:studioTools,
    editor,
    log
  });

  ui.addDockAction?.({
    id:'generation-anchor',
    label:'生成落点',
    title:'在当前世界指定生成物落点',
    onClick:()=>{
      const ready = ui.getLatestBuildOutput?.('asset') || null;
      if (ready && placement.armGroundPlacement(ready.primaryId)) {
        log(`点击地面放置生成物：${ready.prompt || ready.primaryId}`,'tool');
        return;
      }
      if (placement.anchor) {
        placement.clearAnchor();
        log('已清除生成落点','result');
        return;
      }
      placement.armGenerationAnchor();
    }
  });

  const resources = new StudioResources({
    assetModule:world.assetModule,
    artifactModule:world.generation.artifacts,
    events:world.events,
    getEnvironment:()=>world.environment,
    environments
  });

  const mechanicalCreator = new MechanicalAssetController({
    assets:world.assetModule,resources,placement,log
  });

  const buildController = new StudioBuildController({
    generation:world.generation,
    events:world.events,
    syncGenerationState:(state)=>{ world.generationState=state; },
    placement,
    openGeneratedWorld,
    log
  });
  const buildSession = new BuildSession({ mode:'image' });
  const agentVerifier = new AssetAgentVerifier({
    world,
    tools:studioTools,
    actorId:'agent_01',
    log
  });

  const scene = createSceneFacade(world);
  const inspectorProjection = new InspectorProjection({ world, authoring, scene });
  const editorCommands = new EditorCommandQueue({
    tools:studioTools,
    scene,
    authoring,
    log,
    legacyAction:async(target)=>{
      const item=world.environment?.interactions?.find(item=>!item.contractId && item.id===target);
      if(!item)throw new Error('旧式交互对象已不存在');
      await item.activate();
      world.events.emit('environment.interaction',{environmentId:world.environment.id,id:target});
    },
    onCommitted:(command)=>{
      if (command.source === 'runtime' && ui.getSelection?.()?.source==='runtime' && ui.getSelection().id===command.id) ui.syncInspector?.(command.id);
      else ui.refreshInspector?.();
    }
  });

  const stopActionReset=['environment.replaced','scene.restored','scene.cleared'].map(event=>world.events.on(event,()=>editorCommands.actions.reset()));

  ui.selectRuntimeObject?.(editor.selectedId ?? null);

  const inspector = {
    render(id) {
      ui.syncInspector?.(id);
    }
  };

  ui.attachContent?.({
    sceneExplorer:{
      world,
      editor,
      authoring,
      environmentDefinition,
      resources,
      placement,
      setStyle: async reference => {
        try { return await createSceneFacade(world).setStyle(reference); }
        catch(error) { log(`风格错误：${error.code || error.message} ${error.cause?.message || ''}`,'error'); throw error; }
      },
      getStyle: () => createSceneFacade(world).observe().style?.id || null,
      openLibrary:()=>ui.setView('resources'),
      openCreate:()=>ui.setView('create'),
      openInspect:()=>ui.setView('inspect')
    },
    buildWorkbench:{
      resources,
      session:buildSession,
      controller:buildController,
      environmentDefinition,
      log
    },
    resourceLibrary:{
      resources,
      creator:mechanicalCreator,
      experiment:input=>scene.thermalExperiment(input),
      placement,
      log,
      openEnvironment:openBuiltinWorld,
      openGeneratedWorld
    },
    inspector:{
      projection:inspectorProjection,
      commands:editorCommands,
      log
    },
    artifactTray:{
      resources,
      controller:buildController,
      agentVerifier,
      openBuild:()=>ui.setView('create'),
      log
    }
  });

  return {
    inspector,
    dispose() {
      stopActionReset.forEach(stop=>stop?.());
      editorCommands.actions.reset();
      ui.attachContent?.(null);
      placement.dispose();
    }
  };
}
