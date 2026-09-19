function objectLabel(record,id) {
  return record?.manifest?.label || record?.object?.name || record?.assetId || id;
}

/**
 * @param {Array<{id:string,asset?:string,assetId?:string,type?:string,label?:string}>} objects
 * @param {string|null} selectedId
 */
export function collectSceneObjectSummaries(objects,selectedId=null) {
  return (objects || [])
    .map((record)=>({
      id:record.id,
      assetId:record.asset ?? record.assetId ?? null,
      type:record.type ?? null,
      label:record.label || record.asset || record.assetId || record.id,
      selected:record.id === selectedId
    }))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

/**
 * @param {{ list: () => Array<[string, any]> }} store
 * @param {string|null} selectedId
 */
export function collectSceneObjects(store,selectedId=null) {
  return collectSceneObjectSummaries(
    store.list().map(([id,record])=>({
      id,
      assetId:record?.assetId || null,
      type:record?.manifest?.type || null,
      label:objectLabel(record,id)
    })),
    selectedId
  );
}
