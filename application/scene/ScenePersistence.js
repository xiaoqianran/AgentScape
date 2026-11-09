import { sceneObjectIdSchema as id } from './SceneProject.js';
import { sceneError } from './SceneContracts.js';

/** Scene snapshots, project packages and content-addressed world archives. */
export function createScenePersistence(world, { name, styles, assertIdle, exclusive, result }) {
  return {
    snapshot() { assertIdle(); return world.serialize({ name }); },
    async save(options = {}) {
      return exclusive(async () => {
        const { exportScenePackage } = await import('./ScenePackage.js');
        return result('save', await exportScenePackage(world, { ...options, name, style: styles.export() }));
      });
    },
    /** Bounded streaming world archive; storage is an injected hash-block backend. */
    async exportWorld(storage, writer, options = {}) {
      return exclusive(async () => {
        const { exportWorld } = await import('./WorldIO.js');
        return result('exportWorld', await exportWorld(world, storage, writer, { name, ...options }));
      });
    },
    async prepareWorld(storage, root, options = {}) {
      assertIdle();
      const { prepareWorld } = await import('./WorldIO.js');
      const prepared = await prepareWorld(storage, root, { active:'bounded', ...options });
      // Never expose the private Runtime simply to commit a validated world.
      return { summary:prepared.summary, commit:()=>exclusive(()=>prepared.commit(world)), dispose:()=>prepared.dispose() };
    },
    async importWorld(storage, source, options = {}) {
      return exclusive(async () => {
        const { importWorld } = await import('./WorldIO.js');
        return result('importWorld', await importWorld(world, storage, source, { active:'bounded', ...options }));
      });
    },
    async restoreSnapshot(snapshot, { prepared = false } = {}) {
      return exclusive(async () => {
        const copy = structuredClone(snapshot); world.serializer.validate(copy);
        if (copy.assets.length || (!prepared && (copy.configuration?.behaviorBundle || copy.configuration?.physicsRequirements || copy.metadata?.environmentState || copy.metadata?.worldRevision))) throw sceneError('UNSUPPORTED_SAVE');
        for (const object of copy.objects) { id.parse(object.id); if (!world.assetModule.hasAsset(object.assetId)) throw sceneError('ASSET_UNAVAILABLE'); }
        await world.restore(copy); return result('restore', { objects: copy.objects.length });
      });
    },
    async setStyle(input, options = {}) { return exclusive(async () => result('setStyle', await styles.set(input, options))); },
    async importProject(input) {
      return exclusive(async () => {
        const { importScenePackageInto } = await import('./ScenePackage.js');
        return result('importProject', await importScenePackageInto(world, input, { getStyle: () => styles.export(), applyStyle: pack => pack ? styles.set(pack) : styles.clear() }));
      });
    },
  };
}
