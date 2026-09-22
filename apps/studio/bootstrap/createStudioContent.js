import { AssetPlacementController } from '../editor/AssetPlacementController.js';
import { StudioResources } from '../resources/StudioResources.js';
import { BuildSession } from '../build/BuildSession.js';
import { StudioBuildController } from '../build/StudioBuildController.js';
import { AssetAgentVerifier } from '../agent/AssetAgentVerifier.js';
import { EditorCommandQueue } from '../editor/EditorCommandQueue.js';
import { InspectorProjection } from '../inspect/InspectorProjection.js';

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

  const inspectorProjection = new InspectorProjection({ world, authoring });
  const editorCommands = new EditorCommandQueue({
    tools:studioTools,
    authoring,
    log,
    onCommitted:(command)=>{
      if (command.source === 'runtime') ui.syncInspector?.(command.id);
      else ui.refreshInspector?.();
    }
  });

  ui.selectRuntimeObject?.(editor.selectedId ?? null);

  const inspector = {
    render(id) {
      if (id && world.queries.hasObject(id)) world.queries.describeObjectRelations(id);
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
      ui.attachContent?.(null);
      placement.dispose();
    }
  };
}
