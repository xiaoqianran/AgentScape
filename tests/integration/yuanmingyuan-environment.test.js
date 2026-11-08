import { describe, expect, it } from 'vitest';
import { createYuanmingyuanEnvironment } from '../../modules/world/content/yuanmingyuan/index.js';
import { openScene } from '../../application/scene/SceneFacade.js';
import { openScenePackage } from '../../application/scene/ScenePackage.js';

const sceneProject = {
  schema:'agentscape.scene-project',schemaVersion:1,name:'Yuanmingyuan integration',
  environment:{type:'builtin',id:'yuanmingyuan-western-mansions'},objects:[]
};

describe('Yuanmingyuan original-world integration', () => {
  it('exposes original procedural geometry as an AgentScape Environment', () => {
    const environment = createYuanmingyuanEnvironment({quality:'low'});
    let meshes = 0;
    let instances = 0;
    environment.root.traverse(node => {
      if (node.isMesh) meshes++;
      if (node.isInstancedMesh) instances++;
    });
    expect(environment.id).toBe('yuanmingyuan-western-mansions');
    expect(meshes).toBeGreaterThan(200);
    expect(instances).toBeGreaterThan(5);
    expect(environment.colliders[0].shape).toBe('trimesh');
    expect(environment.navigationRoot.children).toHaveLength(1);
    expect(environment.views).toHaveLength(8);
    expect(environment.snapshot().hour).toBe(16.4);
    environment.setRestore(false);
    expect(environment.snapshot().restored).toBe(false);
    environment.dispose();
  });

  it('opens, saves and restores the environment through SceneFacade', async () => {
    const scene = await openScene({project:sceneProject});
    let restored;
    try {
      expect(scene.snapshot().metadata.environment).toBe('yuanmingyuan-western-mansions');
      const saved = await scene.save();
      expect(saved.status).toBe('succeeded');
      expect(saved.value.project.environment.id).toBe('yuanmingyuan-western-mansions');
      restored = await openScenePackage(saved.value);
      expect(restored.snapshot().metadata.environment).toBe('yuanmingyuan-western-mansions');
    } finally {
      restored?.close();
      scene.close();
    }
  }, 30_000);
});
