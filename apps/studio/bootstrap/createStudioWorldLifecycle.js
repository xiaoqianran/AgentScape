import { materializePersistedWorldEnvironment } from '../../../application/generation/PromptHybridWorldOrchestrator.js';
import { ENVIRONMENTS } from '../../../modules/world/content/environments.js';
import { AutosaveController } from '../persistence/AutosaveController.js';
import { LocalSceneStore } from '../persistence/LocalSceneStore.js';
import { StudioWorldOpener } from '../runtime/StudioWorldOpener.js';
import { WorldSession } from '../runtime/WorldSession.js';

export function createStudioWorldLifecycle({
  world,
  studioTools,
  environmentDefinition,
  environmentMaterializer,
  authoringWorlds,
  worldSurface,
  taskPanel
}) {
  const sceneStore = new LocalSceneStore();
  const autosave = new AutosaveController({
    runtime:world,
    store:sceneStore,
    delayMs:600
  }).start();

  const worldSession = new WorldSession({
    world,
    tools:studioTools,
    store:sceneStore,
    autosave,
    builtins:ENVIRONMENTS,
    fallback:environmentDefinition,
    onIdentityChange:(identity)=>worldSurface.setIdentity(identity),
    onEnvironmentChange:(event)=>worldSurface.bindEnvironment(event),
    log:(text,kind)=>taskPanel.log(text,kind)
  });

  const worldOpener = new StudioWorldOpener({
    session:worldSession,
    builtins:ENVIRONMENTS,
    materializeBuiltin:(definition)=>environmentMaterializer.materialize(definition,{ scene:world.scene }),
    materializeGenerated:(artifactId)=>materializePersistedWorldEnvironment(world,artifactId),
    authoring:authoringWorlds
  });

  const openGeneratedWorld = async (manifestArtifactId) => {
    const result = await worldOpener.open({ kind:'generated', artifactId:manifestArtifactId });
    taskPanel.log(
      `已打开生成世界：${result.environmentId || manifestArtifactId} · 清理 ${result.clearedObjects || 0} 个对象`,
      'result'
    );
    return result;
  };

  const openBuiltinWorld = async (id) => {
    const result = await worldOpener.open({ kind:'builtin', id });
    taskPanel.log(`已打开内置世界：${worldSession.current.title}`,'result');
    return result;
  };

  if (!worldSession.current.generated && worldSession.current.id === 'monument-hall' && !sceneStore.has()) {
    const legacy = new LocalSceneStore();
    if (legacy.has()) sceneStore.save(legacy.load());
  }

  return {
    sceneStore,
    autosave,
    worldSession,
    worldOpener,
    openGeneratedWorld,
    openBuiltinWorld,
    dispose() {
      worldSession.dispose();
    }
  };
}
