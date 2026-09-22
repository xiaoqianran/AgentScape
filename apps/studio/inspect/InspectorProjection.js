const RUNTIME_RELATIONS = new Set(['ON','NEAR','INSIDE']);

function findAuthoringNode(root,id) {
  if (!root) return null;
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found=findAuthoringNode(child,id);
    if (found) return found;
  }
  return null;
}

function authoringKind(node) {
  if (node?.components?.modelRef) return 'model';
  if (node?.components?.instancedMesh) return 'instanced-mesh';
  if (node?.components?.mesh) return 'mesh';
  return 'node';
}

function authoringTransform(node) {
  const properties=node?.components?.transform?.properties || {};
  return {
    position:Array.isArray(properties.position) ? [...properties.position] : [0,0,0],
    quaternion:Array.isArray(properties.quaternion) ? [...properties.quaternion] : [0,0,0,1],
    scale:Array.isArray(properties.scale) ? [...properties.scale] : [1,1,1]
  };
}

export class InspectorProjection {
  constructor({ world, authoring = null } = {}) {
    if (!world?.queries) throw new TypeError('InspectorProjection requires WorldQueries');
    this.world=world;
    this.authoring=authoring;
  }

  project(selection) {
    if (!selection) return { source:null, kind:'empty', id:null };

    if (selection.source === 'runtime') {
      if (!this.world.queries.hasObject(selection.id)) {
        return { source:'runtime', kind:'missing', id:selection.id };
      }
      const info=this.world.queries.getObjectInfo(selection.id);
      const bounds=this.world.queries.getBounds(selection.id);
      const nearby=this.world.queries.findNearby(selection.id,2);
      return {
        source:'runtime',
        kind:'entity',
        id:info.id,
        title:info.id,
        subtitle:(info.type || 'entity') + ' instance',
        asset:info.asset,
        type:info.type,
        transform:{
          position:[...info.position],
          rotation:[...info.rotation],
          scale:info.scale
        },
        spatial:{
          size:[...bounds.size],
          nearbyCount:nearby.length
        },
        actions:[...(info.actions || [])]
      };
    }

    if (selection.source === 'authoring') {
      if (!this.authoring?.export) return { source:'authoring', kind:'missing', id:selection.id };
      const document=this.authoring.export();
      const node=findAuthoringNode(document?.root,selection.id);
      if (!node) return { source:'authoring', kind:'missing', id:selection.id };
      const transform=authoringTransform(node);
      return {
        source:'authoring',
        kind:authoringKind(node),
        id:node.id,
        title:node.name || node.id,
        subtitle:'Authoring ' + authoringKind(node),
        name:node.name || node.id,
        visible:node.visible !== false,
        transform,
        childCount:(node.children || []).length,
        modelRef:node?.components?.modelRef?.properties || null,
        metadata:node.metadata || null
      };
    }

    if (selection.source === 'environment') {
      const environment=this.world.environment;
      return {
        source:'environment',
        kind:'environment',
        id:selection.id,
        title:environment?.title || environment?.label || selection.id,
        subtitle:'Environment'
      };
    }

    return { source:selection.source, kind:'unsupported', id:selection.id };
  }

  relations(selection) {
    if (selection?.source !== 'runtime' || !this.world.queries.hasObject(selection.id)) return [];
    return this.world.queries.describeObjectRelations(selection.id).outgoing
      .filter(relation=>RUNTIME_RELATIONS.has(relation.predicate))
      .slice(0,8)
      .map(relation=>({ predicate:relation.predicate, object:relation.object }));
  }
}
