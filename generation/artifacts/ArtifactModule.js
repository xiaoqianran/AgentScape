import { ArtifactRegistry } from './ArtifactRegistry.js';
import { ArtifactContractError } from './ArtifactDescriptor.js';
import { sha256ArtifactHash } from './IncrementalSha256.js';
import { MemoryArtifactByteStore } from './MemoryArtifactByteStore.js';
import { IndexedDbArtifactStore } from './storage/IndexedDbArtifactStore.js';

const localCacheLocations = (descriptor) => (descriptor.locations || []).filter((location) =>
  location.kind === 'local-cache' &&
  location.state === 'available' &&
  location.access?.kind === 'cache-key'
);

const persistedEntryFor = (descriptor, entriesByKey) => {
  const locations = localCacheLocations(descriptor);
  for (const location of locations) {
    const entry = entriesByKey.get(location.access.key);
    if (entry) return { location, entry };
  }
  return null;
};

const assertVerifiedPersistence = (descriptor, entry) => {
  const mismatches = [];
  if (!(entry?.data instanceof Uint8Array)) mismatches.push('data');
  if (entry?.artifactId !== descriptor.id) mismatches.push('artifactId');
  if (entry?.hash !== descriptor.hash) mismatches.push('hash');
  if (entry?.mime !== descriptor.mime) mismatches.push('mime');
  if (entry?.bytes !== descriptor.bytes || entry?.data?.byteLength !== descriptor.bytes) mismatches.push('bytes');
  if (!mismatches.length && sha256ArtifactHash([entry.data]) !== descriptor.hash) mismatches.push('contentHash');
  if (mismatches.length) {
    throw new ArtifactContractError(
      'ARTIFACT_PERSISTENCE_INTEGRITY_MISMATCH',
      'Persisted Artifact bytes do not match the verified descriptor',
      { artifactId: descriptor.id, mismatches }
    );
  }
};

export function createArtifactModule({
  registry = null,
  byteStore = null,
  persistentStore = undefined,
  now = () => Date.now()
} = {}) {
  const artifactRegistry = registry || new ArtifactRegistry({ now });
  const artifactByteStore = byteStore || new MemoryArtifactByteStore();
  const durableStore = persistentStore === undefined
    ? (globalThis.indexedDB ? new IndexedDbArtifactStore() : null)
    : persistentStore;
  let hydrated = false;

  return Object.freeze({
    registry: artifactRegistry,
    byteStore: artifactByteStore,
    persistentStore: durableStore,

    async hydrate() {
      if (hydrated) return { artifacts: artifactRegistry.list().length, restored: false };
      if (!durableStore?.load) {
        hydrated = true;
        return { artifacts: artifactRegistry.list().length, restored: false };
      }
      const snapshot = await durableStore.load();
      const entriesByKey = new Map((snapshot.entries || []).map((entry) => [entry.key, entry]));
      for (const descriptor of snapshot.descriptors || []) {
        const integrity = descriptor.integrity || { state: 'declared' };
        const nonLocalLocations = (descriptor.locations || []).filter((location) => location.kind !== 'local-cache');
        let verifiedPersistence = null;
        if (integrity.state === 'verified') {
          verifiedPersistence = persistedEntryFor(descriptor, entriesByKey);
          if (!verifiedPersistence) {
            throw new ArtifactContractError(
              'ARTIFACT_PERSISTENCE_INTEGRITY_MISMATCH',
              'Verified persisted Artifact has no matching local byte entry',
              { artifactId: descriptor.id }
            );
          }
          assertVerifiedPersistence(descriptor, verifiedPersistence.entry);
        }
        artifactRegistry.register({
          ...descriptor,
          locations: nonLocalLocations,
          integrity: { state: 'declared' }
        });
        if (integrity.state === 'verified') {
          artifactByteStore.restore(verifiedPersistence.entry);
          artifactRegistry.updateLocation(descriptor.id, verifiedPersistence.location);
          artifactRegistry.verifyIntegrity(descriptor.id, {
            hash: sha256ArtifactHash([verifiedPersistence.entry.data]),
            bytes: verifiedPersistence.entry.data.byteLength,
            mime: verifiedPersistence.entry.mime,
            verifiedAt: new Date(now()).toISOString(),
            method: 'persisted-sha256-v1'
          });
        } else if (integrity.state === 'rejected' && integrity.rejection) {
          artifactRegistry.rejectIntegrity(descriptor.id, integrity.rejection);
        }
      }
      hydrated = true;
      return { artifacts: (snapshot.descriptors || []).length, entries: (snapshot.entries || []).length, restored: true };
    },

    async persistArtifact(artifactId, cacheKey) {
      if (!durableStore?.putArtifact) return false;
      const descriptor = artifactRegistry.get(artifactId);
      const entry = artifactByteStore.get(cacheKey);
      if (!descriptor || !entry) return false;
      return durableStore.putArtifact(descriptor, entry);
    }
  });
}
