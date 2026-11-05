import { validateAssetManifest } from '../../../model/schema.js';

// Explicit authored physics replaces the inferred fallback; declaration is not motion evidence.
export class ExplicitDefinitionPass {
 async run(context) {
  if(context.interactionReview && !context.definition) {
   const physics=structuredClone(context.interactionReview.physics);
   return {...context,physics,collision:physics.colliders ? {strategy:'reviewed-colliders',quality:'declared',colliders:physics.colliders} : context.collision};
  }
  if(!context.definition)return context;
  const definition=structuredClone(context.definition);
  validateAssetManifest({...definition,id:context.assetId,source:{kind:'compiled',key:context.assetId}});
  return {...context,definition,
   semantics:{type:definition.type,label:definition.label,tags:definition.tags||[],aliases:definition.aliases||[],actions:definition.actions,confidence:1,source:'explicit-definition'},
   physics:definition.physics,
   collision:{strategy:'declared-colliders',quality:'declared',colliders:definition.physics.colliders},
   articulation:{...context.articulation,parts:definition.parts||{},candidates:[]}
  };
 }
}
