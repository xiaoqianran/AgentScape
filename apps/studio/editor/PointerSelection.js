import { getAuthoringObjectId } from '../../../application/world-authoring/AuthoringIdentity.js';
// All sources share one nearest-visible-hit policy. Modes affect edit permission, not occlusion.
export function resolvePointerSelection(hits,environment) {
  const byObject=new Map((environment?.interactions || []).map(item=>[item.object,item]));
  for(const hit of hits) {
    const object=hit.object;
    if(!object.isMesh || object.userData.noHit || object.userData.cabinCollisionProxy || object.material?.visible===false)continue;
    let visible=true;for(let node=object;node;node=node.parent)if(!node.visible)visible=false;
    if(!visible)continue;
    for(let node=object;node;node=node.parent) {
      if(node.userData.instanceId)return {source:'runtime',id:node.userData.instanceId};
      const authoringId=getAuthoringObjectId(node);
      if(authoringId && authoringId!=='root')return {source:'authoring',id:authoringId};
      const interaction=byObject.get(node);
      if(interaction)return {source:'environment',id:interaction.contractId || interaction.id};
    }
    return null; // A visible, unselectable surface occludes every source behind it.
  }
  return null;
}
