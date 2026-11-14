import { mechanicalDraftSchema } from '../../modules/asset/model/MechanicalAssetDraft.js';
import { recipeSchema, threeCodeInputSchema } from '../../modules/asset/model/AssetInputContracts.js';
import { prepareThreeCodeAsset } from '../programmatic-assets/ThreeCodeAsset.js';

const fail = code => Object.assign(new Error(code), { code });
const clone = value => structuredClone(value);
const parse = source => source?.schema === 'agentscape.mechanical-draft'
  ? mechanicalDraftSchema.parse(source)
  : source?.schema === 'agentscape.asset-recipe' ? recipeSchema.parse(source)
  : source?.kind === 'three-code' ? threeCodeInputSchema.parse(source)
  : (() => { throw fail('OBJECT_DEFINITION_UNSUPPORTED'); })();

function changeAt(document, { path, value }) {
  if (typeof path !== 'string' || path.length > 192
    || !/^\/(components|motions|parts|definition)\//.test(path))
    throw fail('OBJECT_PATCH_PATH_FORBIDDEN');
  const segments=path.split('/').slice(1);
  if (segments.length < 3 || segments.length > 8 || segments.some(p=>!p || p==='__proto__' || p==='constructor' || p==='prototype'))
    throw fail('OBJECT_PATCH_PATH_FORBIDDEN');
  let cursor=document;
  for (const part of segments.slice(0,-1)) {
    if (Array.isArray(cursor)) {
      const index=part.startsWith('@') ? cursor.findIndex(item=>item?.id===part.slice(1)) : /^(0|[1-9][0-9]*)$/.test(part) ? Number(part) : -1;
      if(index<0 || index>=cursor.length)throw fail('OBJECT_PATCH_PATH_NOT_FOUND');
      cursor=cursor[index];
    } else {
      if (!cursor || typeof cursor!=='object' || !Object.hasOwn(cursor,part))
        throw fail('OBJECT_PATCH_PATH_NOT_FOUND');
      cursor=cursor[part];
    }
  }
  const key=segments.at(-1);
  if (!cursor || typeof cursor!=='object' || !Object.hasOwn(cursor,key))
    throw fail('OBJECT_PATCH_PATH_NOT_FOUND');
  const previous=clone(cursor[key]);
  cursor[key]=clone(value);
  return {path,previous,next:clone(value)};
}

function declaredEvidence(definition) {
  if (definition.schema==='agentscape.mechanical-draft') {
    return {
      components:definition.components.map(node=>({
        id:node.id,parent:node.parent,shape:node.shape,size:node.size,
        position:node.position,collision:node.collision,source:'ai-declared'
      })),
      motions:definition.motions.map(motion=>({
        id:motion.id,node:motion.node,type:motion.type,
        axis:motion.axis,limits:motion.limits,source:'ai-declared',
        status:'candidate',physicsVerified:false
      }))
    };
  }
  if (definition.schema==='agentscape.asset-recipe') {
    return {
      components:definition.parts.map(part=>({
        id:part.id,parent:part.parent||null,
        shape:part.geometry?.type||'group',position:part.position||[0,0,0],
        source:'ai-declared'
      })),motions:[]
    };
  }
  return {
    components:Object.entries(definition.definition?.parts||{}).map(([id,part])=>({
      id,node:part.node,semantic:part.semantic||null,
      source:'ai-declared'
    })),
    motions:Object.entries(definition.definition?.parts||{}).filter(([,part])=>part.joint).map(([id,part])=>({
      id,node:part.node,type:part.joint.type,axis:part.joint.axis,
      limits:part.joint.limits,status:'candidate',physicsVerified:false,
      source:'ai-declared'
    }))
  };
}

/** Read only actual instantiated Three.js nodes. An Object3D hierarchy is not a joint. */
function runtimeGeometry(object) {
  const nodes=[];
  if (!object?.traverse) return {nodes, truncated:false};
  object.traverse(node=>{
    if (nodes.length>=128) return;
    const bounds=node.geometry?.boundingBox;
    nodes.push({
      name:String(node.name||'').slice(0,100),
      type:node.type, mesh:node.isMesh===true,
      parent:node.parent?.name||null,
      position:node.position?.toArray?.()||null,
      geometryBounds:bounds ? {min:bounds.min.toArray(),max:bounds.max.toArray()} : null,
      source:'runtime-observed'
    });
  });
  return {nodes,truncated:nodes.length>=128};
}

/** A + C: observed Three.js hierarchy and declared, versioned capability intent.
 * Source entries are private to the session, never treated as physics truth.
 */
export class SceneObjectForge {
  constructor(){this.entries=new Map();}
  record(id,source,assetId,world){
    if(!['agentscape.mechanical-draft','agentscape.asset-recipe'].includes(source?.schema)
      && source?.kind!=='three-code') return;
    const definition=parse(source);
    this.entries.set(id,{definition,assetId,world,revision:1,preview:null});
  }
  get(world,id){
    const entry=this.entries.get(id);
    if(!entry || entry.world!==world || !world.store.has(id) || world.store.get(id).assetId!==entry.assetId)
      throw fail('OBJECT_DEFINITION_UNAVAILABLE');
    return entry;
  }
  analyze(world,id,definition){
    const record=world.store.get(id);
    const declared=declaredEvidence(definition),observed=runtimeGeometry(record?.object);
    const known=new Set(observed.nodes.map(node=>node.name).filter(Boolean));
    const references=new Set([
      ...declared.motions.map(motion=>motion.node),
      ...(definition.definition?.requiredNodes||[])
    ].filter(Boolean));
    const matched=[...references].filter(name=>known.has(name));
    const missing=[...references].filter(name=>!known.has(name));
    return {declared,observed,reconciliation:{matchedNodes:matched,missingNodes:missing,
      status:missing.length?'needs-review':'matched',evidenceKind:'node-name-match'},
      interpretation:'observed-geometry-is-not-physical-articulation'};
  }
  inspect(world,id){
    const e=this.get(world,id);
    return {
      schema:'agentscape.object-definition',schemaVersion:1,id,
      revision:e.revision,assetId:e.assetId,
      definition:clone(e.definition),analysis:this.analyze(world,id,e.definition),
      provenance:{definition:'ai-declared',geometry:'runtime-observed',
        motions:'candidate-unless-verified-by-runtime'}
    };
  }
  preview(world,id,expectedRevision,changes){
    const e=this.get(world,id);
    if(expectedRevision!==e.revision) throw fail('OBJECT_REVISION_CONFLICT');
    if(!Array.isArray(changes)||!changes.length||changes.length>8
      || JSON.stringify(changes).length>32768)throw fail('OBJECT_PATCH_LIMIT');
    const copy=clone(e.definition),delta=changes.map(change=>changeAt(copy,change));
    const parsed=parse(copy),previewId=globalThis.crypto.randomUUID();
    e.preview={previewId,revision:e.revision,definition:parsed,changes:delta};
    return {status:'object-patch-preview',id,revision:e.revision,previewId,
      changes:delta,analysis:{declared:declaredEvidence(parsed)},
      verification:'not-run'};
  }
  async apply(world,scene,id,expectedRevision,previewId,{executor}={}){
    const e=this.get(world,id);
    if(expectedRevision!==e.revision)throw fail('OBJECT_REVISION_CONFLICT');
    const pending=e.preview;
    if(!pending||pending.previewId!==previewId||pending.revision!==e.revision)
      throw fail('OBJECT_PATCH_PREVIEW_NOT_FOUND');
    e.preview=null;
    const next=pending.definition,module=world.assetModule;
    const level=module.getManifest(e.assetId).capabilityLevel||'physical';
    let assetId,admission,replaced;
    if(next.kind==='three-code'){
      const prepared=await prepareThreeCodeAsset(module,executor,next,{
        gltfLoader:module.loader.gltfLoader
      });
      assetId=prepared.manifest.id;
      admission=prepared.validation;
      replaced=await prepared.install(()=>scene.replaceAsset({id,asset:prepared.asset,level}));
    }else{
      // Mechanical drafts must pass their articulation verifier before any instance swap.
      const imported=next.schema==='agentscape.mechanical-draft'
        ? await module.importMechanicalDraft(next) : await module.importRecipe(next);
      assetId=imported.manifest.id;
      admission=imported.admission;
      replaced=await scene.replaceAsset({id,asset:'asset://sha256/'+assetId.replace(/^asset_/,''),level});
    }
    e.definition=clone(next);
    e.assetId=assetId;
    e.revision++;
    return {status:'object-patch-applied',id,revision:e.revision,
      assetId,changes:pending.changes,
      verification:{status:'compiled-and-admitted',admission,
        runtimeActionVerification:'not-run'},replace:replaced.status};
  }
  clear(){this.entries.clear();}
}
