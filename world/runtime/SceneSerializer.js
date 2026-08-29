export const SCENE_SCHEMA = 'agentscape.scene';
export const SCENE_VERSION = 1;

const clone = (value) => JSON.parse(JSON.stringify(value));

export class SceneSerializer {
  serialize(runtime, { name = 'Untitled World' } = {}) {
    runtime.sceneGraph?.update?.();
    const usedAssets = new Set();
    const objects = runtime.store.list().map(([id, record]) => {
      usedAssets.add(record.assetId);
      const object = record.object;
      return {
        id,
        assetId: record.assetId,
        transform: {
          position: object.position.toArray(),
          quaternion: object.quaternion.toArray(),
          scale: object.scale.toArray()
        },
        state: clone(record.state || {})
      };
    });

    const assets = [...usedAssets]
      .map((assetId) => runtime.assets.getManifest(assetId))
      .filter((manifest) => ['glb', 'compiled'].includes(manifest.source?.kind))
      .map(clone);

    const worldRevision=runtime.currentWorldRevision ? clone(runtime.currentWorldRevision) : null;
    const acceptanceEvidence=runtime.lastAcceptanceBundle ? clone(runtime.lastAcceptanceBundle) : null;
    return {
      schema: SCENE_SCHEMA,
      schemaVersion: SCENE_VERSION,
      metadata: {
        name,
        savedAt: new Date().toISOString(),
        generator: `AgentScape/${runtime.version || 'unknown'}`,
        environment: runtime.environment?.id || null,
        ...(worldRevision?{worldRevision}:{})
      },
      assets,
      objects,
      relations: runtime.sceneGraph?.list?.() || [],
      ...(acceptanceEvidence?{verification:{acceptanceEvidence}}:{}),
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
    if (scene.relations != null && !Array.isArray(scene.relations)) throw new Error('Scene relations must be an array');
    const worldRevision=scene.metadata?.worldRevision;
    if (worldRevision != null) {
      if (!worldRevision || typeof worldRevision !== 'object' || Array.isArray(worldRevision)) throw new Error('Scene worldRevision must be an object');
      if (!worldRevision.revision?.id) throw new Error('Scene worldRevision requires revision.id');
      if (!worldRevision.provenance?.source) throw new Error('Scene worldRevision requires provenance.source');
    }
    const acceptanceEvidence=scene.verification?.acceptanceEvidence;
    if (acceptanceEvidence != null) {
      if (acceptanceEvidence.schema !== 'agentscape.acceptance-evidence' || acceptanceEvidence.schemaVersion !== 1) throw new Error('Unsupported acceptance evidence');
      if (!Array.isArray(acceptanceEvidence.criteria) || !acceptanceEvidence.result || typeof acceptanceEvidence.result !== 'object') throw new Error('Invalid acceptance evidence payload');
      const revisionId=worldRevision?.revision?.id || null;
      if (revisionId && acceptanceEvidence.worldRevisionId && acceptanceEvidence.worldRevisionId !== revisionId) throw new Error(`Acceptance evidence revision mismatch: ${acceptanceEvidence.worldRevisionId} != ${revisionId}`);
    }
    const objectIds = new Set(scene.objects.map((object) => object.id));
    const heldOwners = new Set();
    for (const object of scene.objects) {
      if (!object.id || !object.assetId) throw new Error('Scene object requires id and assetId');
      if (object.transform?.position?.length !== 3) throw new Error(`${object.id}: invalid position`);
      if (object.transform?.quaternion?.length !== 4) throw new Error(`${object.id}: invalid quaternion`);
      if (object.transform?.scale?.length !== 3) throw new Error(`${object.id}: invalid scale`);
      const heldBy = object.state?.heldBy;
      if (heldBy) {
        if (!['human','agent'].includes(heldBy.kind)) throw new Error(`${object.id}: invalid heldBy.kind`);
        const ownerKey = heldBy.kind === 'human' ? 'human' : `agent:${heldBy.id}`;
        if (heldBy.kind === 'agent' && (!heldBy.id || !objectIds.has(heldBy.id))) throw new Error(`${object.id}: heldBy agent is missing`);
        if (heldOwners.has(ownerKey)) throw new Error(`${ownerKey}: multiple held objects are not supported`);
        heldOwners.add(ownerKey);
      }
    }
    return scene;
  }

  async restore(runtime, input) {
    const scene = this.validate(clone(input));
    const sceneEnvironment = scene.metadata?.environment;
    const runtimeEnvironment = runtime.environment?.id;
    if (sceneEnvironment && runtimeEnvironment && sceneEnvironment !== runtimeEnvironment) {
      throw new Error(`Scene environment mismatch: ${sceneEnvironment} != ${runtimeEnvironment}`);
    }

    // 先完成所有不会破坏当前世界的检查。
    for (const manifest of scene.assets) runtime.assets.assertCompatibleManifest(manifest);
    for (const item of scene.objects) {
      if (!runtime.assets.has(item.assetId)) throw new Error(`Scene references unknown asset: ${item.assetId}`);
    }

    if (typeof runtime.physics?.resetWorld === 'function') {
      runtime.locomotion?.cancelAll?.();
      runtime.interactions?.cancelPending?.('SCENE_RESTORE');
      runtime.physics.resetWorld();
      if (runtime.environment?.colliders?.length) {
        runtime.physics.addEnvironment(runtime.environment.colliders,{id:runtime.environment.id});
      }
    }

    await runtime.sceneGraph.batch(async () => {
      await runtime.clearObjects({silent:true});
      for (const item of scene.objects) {
        await runtime.spawn(item.assetId, { id: item.id, position: item.transform.position });
        const record = runtime.store.get(item.id);
        record.object.quaternion.fromArray(item.transform.quaternion);
        record.object.scale.fromArray(item.transform.scale);
        record.state = clone(item.state || {});
        record.object.updateMatrixWorld(true);
        runtime.physics.syncTransform(item.id, record.object);
        runtime.restoreObjectState(item.id, record.state);
      }
      runtime.interactions?.rebuildHeldOwnership?.();
      runtime.sceneGraph.changed();
    });

    if (scene.camera?.position?.length === 3) runtime.camera.position.fromArray(scene.camera.position);
    if (scene.camera?.target?.length === 3) runtime.controls.target.fromArray(scene.camera.target);
    runtime.controls.update();
    runtime.currentWorldRevision=scene.metadata?.worldRevision ? clone(scene.metadata.worldRevision) : null;
    runtime.restoredAcceptanceEvidence=scene.verification?.acceptanceEvidence ? clone(scene.verification.acceptanceEvidence) : null;
    runtime.lastAcceptanceBundle=null;
    runtime.events.emit('scene.restored', { objects: scene.objects.length, worldRevisionId:runtime.currentWorldRevision?.revision?.id || null, hasAcceptanceEvidence:Boolean(runtime.restoredAcceptanceEvidence) });
    return scene;
  }
}
