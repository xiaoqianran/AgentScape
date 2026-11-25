/** The registry owns identity/state; the live physics entry owns collider data. */
export function nativePhysicalTarget(entities,physics,id){
  const entity=entities?.get?.(id),entry=physics?.entries?.get(id);
  if(entity?.source!=='native'||!entry||entry.root!==entity.object||!entity.capabilities.includes('physics'))return null;
  if(entry.nativeArticulation){
    const parts=entity.manifest?.parts||{};
    if(entry.parts.size!==Object.keys(parts).length)return null;
    for(const [name,part] of entry.parts){
      const parent=part.parentName==='$root'?entity.object:entry.parts.get(part.parentName)?.node;
      if(!parent||part.node.parent!==parent||part.node.name!==parts[name]?.node||part.node.uuid!==entity.metadata.articulationNodeUuids?.[name])return null;
    }
  }
  for(let node=entity.object;node;node=node.parent)if(node.uuid===entity.metadata.hostSceneUuid)return entity;
  return null;
}
export function nativeCarryRecord(entities,physics,id){
  const entity=nativePhysicalTarget(entities,physics,id);
  if(!entity)return null;
  const spec=physics.entries.get(id).rootSpec;
  return {id,object:entity.object,state:entity.state,source:'native',
    manifest:{physics:spec,surfaces:entity.metadata.surfaces||[],parts:entity.manifest.parts||{},actions:[]},physicsScale:1};
}

/** Normal is oriented from the source collider toward the other collider.
 * Require a downward contact with the named support, not a ceiling or side.
 */
export function nativeSupportContacts(physics,subjectId,targetId){
  return (physics.articulationContacts(subjectId,'$root')||[]).filter(contact=>
    contact.external&&contact.target?.objectId===targetId&&contact.activeContactCount>0&&
    contact.normal?.[1]<-.7&&Number.isFinite(contact.minDistance)&&contact.minDistance>=-.03);
}
