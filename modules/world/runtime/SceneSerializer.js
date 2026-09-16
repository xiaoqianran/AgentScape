import { uniformScaleValue } from './ObjectTransform.js';

export const SCENE_SCHEMA = 'agentscape.scene';
export const SCENE_VERSION = 1;

const clone = (value) => JSON.parse(JSON.stringify(value));
const isFiniteVec = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);

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
    const cameraState=runtime.rendering?.cameraState?.() || null;
    return {
      schema: SCENE_SCHEMA,
      schemaVersion: SCENE_VERSION,
      metadata: {
        name,
        savedAt: new Date().toISOString(),
        generator: `AgentScape/${runtime.version || 'unknown'}`,
        environment: runtime.environment?.id || null,
        ...(runtime.environment?.snapshot ? {environmentState:clone(runtime.environment.snapshot())} : {}),
        ...(worldRevision?{worldRevision}:{})
      },
      assets,
      objects,
      relations: runtime.sceneGraph?.list?.() || [],
      ...(acceptanceEvidence?{verification:{acceptanceEvidence}}:{}),
      ...(cameraState?{camera:cameraState}:{})
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
    // 先只收集并校验标识，后续 heldBy 引用需要完整的 id 集合。
    const objectIds = new Set();
    for (const object of scene.objects) {
      if (!object.id || !object.assetId) throw new Error('Scene object requires id and assetId');
      if (objectIds.has(object.id)) throw new Error(`Duplicate scene object id: ${object.id}`);
      objectIds.add(object.id);
    }
    const heldOwners = new Set();
    for (const object of scene.objects) {
      if (!isFiniteVec(object.transform?.position, 3)) throw new Error(`${object.id}: invalid position`);
      if (!isFiniteVec(object.transform?.quaternion, 4)) throw new Error(`${object.id}: invalid quaternion`);
      if (!isFiniteVec(object.transform?.scale, 3)) throw new Error(`${object.id}: invalid scale`);
      uniformScaleValue(object.transform.scale);
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
    if(scene.metadata?.environmentState)runtime.environment?.validateSnapshot?.(scene.metadata.environmentState);

    // 预检已通过，从这里开始才会破坏当前世界。失败时恢复加载前的场景，而不是留下半个世界。
    const previous = typeof runtime.snapshot === 'function' ? runtime.snapshot() : null;
    if (!previous) return this.applyScene(runtime, scene);
    try {
      return await this.applyScene(runtime, scene);
    } catch (error) {
      try {
        await this.applyScene(runtime, previous);
      } catch (rollbackError) {
        const failure = new AggregateError([error, rollbackError], 'Scene restore rollback failed', { cause:error });
        failure.code = 'SCENE_RESTORE_ROLLBACK_FAILED';
        failure.rollbackError = rollbackError;
        throw failure;
      }
      throw error;
    }
  }

  // 破坏性应用。调用方必须保证 scene 已经 validate 并通过全部预检。
  async applyScene(runtime, scene) {
    runtime.affordances?.cancel('SCENE_RESTORE');

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
        await runtime.spawn(item.assetId, {
          id:item.id,
          position:item.transform.position,
          quaternion:item.transform.quaternion,
          scale:item.transform.scale
        });
        const record = runtime.store.get(item.id);
        record.state = clone(item.state || {});
        runtime.restoreObjectState(item.id, record.state);
      }
      runtime.interactions?.rebuildHeldOwnership?.();
      runtime.sceneGraph.changed();
    });

    if(scene.metadata?.environmentState) runtime.environment?.restore?.(scene.metadata.environmentState);
    runtime.navigation?.invalidate?.('scene-restored');
    if (scene.camera) runtime.rendering?.applyCameraState?.(scene.camera);
    runtime.currentWorldRevision=scene.metadata?.worldRevision ? clone(scene.metadata.worldRevision) : null;
    runtime.restoredAcceptanceEvidence=scene.verification?.acceptanceEvidence ? clone(scene.verification.acceptanceEvidence) : null;
    runtime.lastAcceptanceBundle=null;
    runtime.events.emit('scene.restored', { objects: scene.objects.length, worldRevisionId:runtime.currentWorldRevision?.revision?.id || null, hasAcceptanceEvidence:Boolean(runtime.restoredAcceptanceEvidence) });
    return scene;
  }
}
