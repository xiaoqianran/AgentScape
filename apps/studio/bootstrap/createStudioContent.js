import { AssetPlacementController } from '../editor/AssetPlacementController.js';
import { StudioResources } from '../resources/StudioResources.js';
import { BuildSession } from '../build/BuildSession.js';
import { StudioBuildController } from '../build/StudioBuildController.js';
import { AssetAgentVerifier } from '../agent/AssetAgentVerifier.js';
import { ResourceLibrary } from '../ui/resources/ResourceLibrary.js';
import { mountSceneExplorer } from '../react/scene/SceneExplorer.tsx';
import { mountObjectInspector } from '../react/inspect/ObjectInspector.tsx';
import { mountBuildWorkbench } from '../react/build/BuildWorkbench.tsx';
import { mountArtifactTray } from '../react/artifacts/ArtifactTray.tsx';
import { useStudioStore } from '../react/state/studioStore.ts';

export function createStudioContent({
  app,
  ui,
  environmentDefinition,
  environments,
  world,
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
      const ready = useStudioStore.getState().buildOutputs.find((output)=>output.kind === 'asset');
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

  const sceneExplorer = mountSceneExplorer({
    root:ui.scenePanel,
    world,
    editor,
    environmentDefinition,
    resources,
    placement,
    openLibrary:()=>ui.setView('resources'),
    openCreate:()=>ui.setView('create')
  });

  const buildController = new StudioBuildController({
    generation:world.generation,
    events:world.events,
    syncGenerationState:(state)=>{ world.generationState=state; },
    placement,
    openGeneratedWorld,
    log
  });
  const buildWorkbench = mountBuildWorkbench({
    root:ui.panel,
    resources,
    session:new BuildSession({ mode:'image' }),
    controller:buildController,
    environmentDefinition,
    log
  });

  const resourceLibrary = new ResourceLibrary({
    root:ui.panel,
    resources,
    placement,
    log,
    openEnvironment:openBuiltinWorld,
    openGeneratedWorld
  }).init();

  const inspector = mountObjectInspector({
    root:ui.panel,
    world,
    tools:studioTools,
    log
  });

  const artifactTray = mountArtifactTray({
    root:app,
    resources,
    controller:buildController,
    agentVerifier:new AssetAgentVerifier({
      world,
      tools:studioTools,
      actorId:'agent_01',
      log
    }),
    openBuild:()=>ui.setView('create'),
    log
  });

  return {
    inspector,
    dispose() {
      artifactTray.destroy();
      buildWorkbench.destroy();
      sceneExplorer.destroy();
      inspector.destroy();
      resourceLibrary.destroy();
      placement.dispose();
    }
  };
}
