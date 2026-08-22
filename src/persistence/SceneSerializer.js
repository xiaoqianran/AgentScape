export const SCENE_SCHEMA = 'agentscape.scene';
export const SCENE_VERSION = 1;

const clone = (value) => JSON.parse(JSON.stringify(value));

export class SceneSerializer {
  serialize(runtime, { name = 'Untitled World' } = {}) {
    const usedAssets = new Set();
    const objects = runtime.store.list().map(([id, record]) => {
      usedAssets.add(record.assetId);
      const o = record.object;
      return {
        id,
        assetId: record.assetId,
        transform: {
          position: o.position.toArray(),
          quaternion: o.quaternion.toArray(),
          scale: o.scale.toArray()
        },
        state: clone(record.state || {})
      };
    });

    const manifests = [...usedAssets]
      .map((assetId) => runtime.assets.getManifest(assetId))
      .filter((manifest) => manifest.source?.kind === 'glb')
      .map(clone);

    return {
      schema: SCENE_SCHEMA,
      schemaVersion: SCENE_VERSION,
      metadata: {
        name,
        savedAt: new Date().toISOString(),
        generator: `AgentScape/${runtime.version || 'unknown'}`
      },
      assets: manifests,
      objects,
      camera: {
        position: runtime.camera.position.toArray(),
        target: runtime.controls.target.toArray()
      }
    };
  }

  validate(scene) {
    if (!scene || typeof scene !== 'object') throw new Error('Scene must be an object');
    if (scene.schema !== SCENE_SCHEMA) throw new Error(`Unsupported scene schema: ${scene.schema || 'missing'}`);
    if (scene.schemaVersion !== SCENE_VERSION) throw new Error(`Unsupported scene version: ${scene.schemaVersion}`);
    if (!Array.isArray(scene.objects)) throw new Error('Scene objects must be an array');
    if (!Array.isArray(scene.assets)) throw new Error('Scene assets must be an array');
    for (const object of scene.objects) {
      if (!object.id || !object.assetId) throw new Error('Scene object requires id and assetId');
      if (object.transform?.position?.length !== 3) throw new Error(`${object.id}: invalid position`);
      if (object.transform?.quaternion?.length !== 4) throw new Error(`${object.id}: invalid quaternion`);
      if (object.transform?.scale?.length !== 3) throw new Error(`${object.id}: invalid scale`);
    }
    return scene;
  }

  async restore(runtime, input) {
    const scene = this.validate(clone(input));
    runtime.clearObjects();

    for (const manifest of scene.assets) {
      if (!runtime.assets.has(manifest.id)) runtime.assets.registerManifest(manifest);
    }

    for (const item of scene.objects) {
      if (!runtime.assets.has(item.assetId)) throw new Error(`Scene references unknown asset: ${item.assetId}`);
      await runtime.spawn(item.assetId, { id: item.id, position: item.transform.position });
      const record = runtime.store.get(item.id);
      record.object.quaternion.fromArray(item.transform.quaternion);
      record.object.scale.fromArray(item.transform.scale);
      record.state = clone(item.state || {});
      record.object.updateMatrixWorld(true);
      runtime.physics.syncTransform(item.id, record.object);
      runtime.restoreObjectState(item.id, record.state);
    }

    if (scene.camera?.position?.length === 3) runtime.camera.position.fromArray(scene.camera.position);
    if (scene.camera?.target?.length === 3) runtime.controls.target.fromArray(scene.camera.target);
    runtime.controls.update();
    runtime.events.emit('scene.restored', { objects: scene.objects.length });
    return scene;
  }
}
