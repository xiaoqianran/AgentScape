const runtimeLabel = (record, id) => (
  record?.label || record?.manifest?.label || record?.object?.name || record?.asset || record?.assetId || id
);

const selectionMatches = (selection, source, id) => (
  selection?.source === source && selection.id === id
);

export function sceneProjectionKey(source, id) {
  return source + ':' + id;
}

/**
 * Projects formal Runtime World Entities without leaking ObjectStore records into Studio UI.
 */
export function collectRuntimeSceneRows(objects, selection = null) {
  return (objects || [])
    .map((record) => ({
      key:sceneProjectionKey('runtime',record.id),
      source:'runtime',
      kind:'entity',
      id:record.id,
      assetId:record.asset ?? record.assetId ?? null,
      type:record.type ?? record?.manifest?.type ?? null,
      label:runtimeLabel(record,record.id),
      parentKey:'runtime-root',
      selected:selectionMatches(selection,'runtime',record.id)
    }))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

function flattenAuthoringNode(node, parentKey, selection, rows) {
  if (!node?.id) return;
  const key=sceneProjectionKey('authoring',node.id);
  rows.push({
    key,
    source:'authoring',
    kind:'authoring-node',
    id:node.id,
    assetId:null,
    type:node?.components?.modelRef ? 'model' : node?.components?.mesh ? 'mesh' : 'node',
    label:node.name || node.id,
    parentKey,
    selected:selectionMatches(selection,'authoring',node.id)
  });
  for (const child of node.children || []) flattenAuthoringNode(child,key,selection,rows);
}

/**
 * Projects the persistent AuthoringDocument identity graph. Runtime GLTF descendants are intentionally opaque.
 */
export function collectAuthoringSceneRows(document, selection = null) {
  if (!document?.root) return [];
  const rows=[];
  for (const child of document.root.children || []) {
    flattenAuthoringNode(child,'authoring-root',selection,rows);
  }
  return rows;
}

/**
 * Builds the Studio read model. Runtime and Authoring identities remain tagged and never collapse.
 */
/**
 * @param {{runtimeObjects?:any[],authoringDocument?:any,environment?:any,selection?:any}} options
 */
export function collectStudioSceneProjection({
  runtimeObjects = [],
  authoringDocument = null,
  environment = null,
  selection = null
} = {}) {
  const roots=[
    {
      key:'environment-root',
      source:'environment',
      kind:'group',
      id:'environment-root',
      label:'Environment',
      parentKey:null,
      selected:false
    },
    {
      key:'runtime-root',
      source:'runtime',
      kind:'group',
      id:'runtime-root',
      label:'Runtime Entities',
      parentKey:null,
      selected:false
    },
    {
      key:'authoring-root',
      source:'authoring',
      kind:'group',
      id:'authoring-root',
      label:'Authoring',
      parentKey:null,
      selected:false
    }
  ];

  const environmentRows=environment?.id ? [{
    key:sceneProjectionKey('environment',environment.id),
    source:'environment',
    kind:'environment',
    id:environment.id,
    label:environment.title || environment.label || environment.id,
    parentKey:'environment-root',
    selected:selectionMatches(selection,'environment',environment.id)
  }] : [];

  const runtimeRows=collectRuntimeSceneRows(runtimeObjects,selection);
  const authoringRows=collectAuthoringSceneRows(authoringDocument,selection);

  return {
    roots:roots.filter((root)=>root.source !== 'authoring' || authoringRows.length > 0),
    rows:[...environmentRows,...runtimeRows,...authoringRows],
    runtimeRows,
    authoringRows,
    environmentRows
  };
}

// Compatibility helpers for non-React callers. New Studio code should use collectStudioSceneProjection.
export function collectSceneObjectSummaries(objects, selectedId = null) {
  const selection=selectedId ? { source:'runtime', id:selectedId } : null;
  return collectRuntimeSceneRows(objects,selection).map(({key,source,kind,parentKey,...row})=>row);
}

export function collectSceneObjects(store, selectedId = null) {
  return collectSceneObjectSummaries(
    store.list().map(([id,record])=>({
      id,
      assetId:record?.assetId || null,
      type:record?.manifest?.type || null,
      label:runtimeLabel(record,id)
    })),
    selectedId
  );
}
