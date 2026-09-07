// Migration boundary: React owns this island; AppShell only reserves its host.
export const sceneExplorerMarkup = () => `<aside class="scene-panel" aria-label="世界与场景"></aside>`;

function objectLabel(record, id) {
  return record?.manifest?.label || record?.object?.name || record?.assetId || id;
}

/**
 * Pure projection shared by the legacy tests and the React Scene Explorer island.
 * @param {{ list: () => Array<[string, any]> }} store
 * @param {string|null} selectedId
 */
export function collectSceneObjects(store, selectedId = null) {
  return store.list()
    .map(([id, record]) => ({
      id,
      assetId:record?.assetId || null,
      type:record?.manifest?.type || null,
      label:objectLabel(record, id),
      selected:id === selectedId
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
