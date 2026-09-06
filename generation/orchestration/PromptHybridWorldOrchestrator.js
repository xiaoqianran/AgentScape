import { loadGeneratedWorld } from '../../world/loadGeneratedWorld.js';
import { WorldBuilder } from '../../world/build/WorldBuilder.js';
import { buildWorldProposal } from '../../world/spec/WorldPlannerProposal.js';
import { WORLD_PLANNER_PROPOSAL_SCHEMA } from '../../world/spec/WorldIRToolSchema.js';

const text={type:'string',minLength:1};
const strict=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});

export const PROMPT_HYBRID_WORLD_REQUEST_SCHEMA=strict({
  environmentPrompt:text,
  proposal:WORLD_PLANNER_PROPOSAL_SCHEMA,
  imageProvider:text,
  worldProvider:text
},['environmentPrompt','proposal']);

const clean=(value)=>typeof value==='string'?value.trim():'';
const clone=(value)=>value==null?value:structuredClone(value);
const safeId=()=>{
  const id=globalThis.crypto?.randomUUID?.();
  if(!id){const error=new Error('Secure revision identity is unavailable');error.code='WORLD_PROPOSAL_ID_UNAVAILABLE';throw error;}
  return `world-${id}`;
};

function cachedBytes(runtime, imported, role) {
  if (!imported?.artifact || imported.artifact.integrity!=='verified' || !imported.cacheKey) {
    const error=new Error(`Generated World ${role} is not a verified local artifact`);
    error.code='GENERATED_WORLD_ARTIFACT_UNVERIFIED';
    throw error;
  }
  const entry=runtime.assetModule?.byteStore?.get?.(imported.cacheKey);
  if (!entry?.data) {
    const error=new Error(`Generated World ${role} bytes are unavailable`);
    error.code='GENERATED_WORLD_ARTIFACT_BYTES_UNAVAILABLE';
    throw error;
  }
  if (entry.hash!==imported.artifact.hash || entry.mime!==imported.artifact.mime || entry.bytes!==imported.artifact.bytes) {
    const error=new Error(`Generated World ${role} cache identity mismatch`);
    error.code='GENERATED_WORLD_ARTIFACT_CACHE_MISMATCH';
    throw error;
  }
  return new Uint8Array(entry.data);
}

function parseManifest(bytes) {
  let value;
  try { value=JSON.parse(new TextDecoder().decode(bytes)); }
  catch (cause) { const error=new TypeError('Generated World manifest is invalid JSON',{cause});error.code='GENERATED_WORLD_MANIFEST_INVALID';throw error; }
  if (!value || typeof value!=='object' || Array.isArray(value) || value.schemaVersion!==1 || !value.artifacts?.environment?.path) {
    const error=new TypeError('Generated World manifest is not a supported runtime manifest');
    error.code='GENERATED_WORLD_MANIFEST_INVALID';
    throw error;
  }
  return value;
}

export async function materializeImportedWorldEnvironment(runtime,generationResult) {
  const artifacts=generationResult?.artifacts || {};
  const manifestBytes=cachedBytes(runtime,artifacts['world-manifest'],'world-manifest');
  const manifest=parseManifest(manifestBytes);
  const mesh=cachedBytes(runtime,artifacts['world-mesh'],'world-mesh');
  const semantics=cachedBytes(runtime,artifacts['world-semantics'],'world-semantics');
  const visual=cachedBytes(runtime,artifacts['world-visual'],'world-visual');
  const navigation=artifacts['world-navigation'] ? cachedBytes(runtime,artifacts['world-navigation'],'world-navigation') : null;
  return loadGeneratedWorld({
    id:manifest.id || 'generated-world',
    mesh:{data:mesh,format:artifacts['world-mesh'].artifact.format},
    semantics:{data:semantics,format:artifacts['world-semantics'].artifact.format},
    visual:{data:visual,format:artifacts['world-visual'].artifact.format},
    ...(navigation?{navigation:{data:navigation,format:artifacts['world-navigation'].artifact.format}}:{}),
    coordinateSystem:manifest.coordinateSystem || 'y-up',
    metersPerUnit:manifest.metersPerUnit ?? 1,
    layout:manifest.layout || null,
    camera:manifest.camera || null,
    rendering:manifest.rendering || null
  });
}

function generationEvidence(result) {
  return {
    status:result.status,
    route:clone(result.route),
    jobs:clone(result.jobs),
    sourceArtifact:result.sourceArtifact?{id:result.sourceArtifact.id,role:result.sourceArtifact.role,mime:result.sourceArtifact.mime,hash:result.sourceArtifact.hash}:null,
    artifacts:Object.fromEntries(Object.entries(result.artifacts||{}).map(([role,item])=>[role,{
      id:item.artifact.id,role:item.artifact.role,mime:item.artifact.mime,format:item.artifact.format,
      bytes:item.artifact.bytes,hash:item.artifact.hash,integrity:item.artifact.integrity
    }]))
  };
}

function environmentEvidence(environment) {
  const semantics=environment?.semantics;
  const categories=Array.isArray(semantics)?semantics:(semantics?.categories||[]);
  const instances=Array.isArray(semantics?.instances)?semantics.instances:[];
  return {
    id:environment?.id || null,
    layout:clone(environment?.layout || null),
    semantics:{categories:[...categories],instanceCount:instances.length,labels:[...new Set(instances.map((item)=>item?.label).filter(Boolean))].sort()},
    navigation:environment?.generated?.navigation?{available:true,format:environment.generated.navigation.format||null}:{available:false},
    visual:environment?.generated?.visual?{available:true,format:environment.generated.visual.format||null}:{available:false}
  };
}

export class PromptHybridWorldOrchestrator {
  constructor(runtime,{
    worldBuilder=new WorldBuilder(runtime),
    generateWorldArtifacts=null,
    materializeEnvironment=materializeImportedWorldEnvironment,
    revisionIdFactory=safeId
  }={}) {
    if(!runtime) throw new TypeError('PromptHybridWorldOrchestrator requires runtime');
    this.runtime=runtime;
    this.worldBuilder=worldBuilder;
    this.generateWorldArtifacts=generateWorldArtifacts || ((request)=>{
      if(typeof runtime.generation?.generateTextWorldArtifacts!=='function') {
        const error=new Error('Text-to-World generation is unavailable');error.code='GENERATION_ROUTE_UNAVAILABLE';throw error;
      }
      return runtime.generation.generateTextWorldArtifacts(request);
    });
    this.materializeEnvironment=materializeEnvironment;
    this.revisionIdFactory=revisionIdFactory;
  }

  async run(request={}) {
    const environmentPrompt=clean(request.environmentPrompt);
    if(!environmentPrompt){const error=new TypeError('Generated Hybrid World requires environmentPrompt');error.code='GENERATION_PROMPT_REQUIRED';throw error;}
    if(!request.proposal || typeof request.proposal!=='object' || Array.isArray(request.proposal)) throw new TypeError('Generated Hybrid World requires proposal');

    const generation=await this.generateWorldArtifacts({
      prompt:environmentPrompt,
      ...(clean(request.imageProvider)?{imageProvider:clean(request.imageProvider)}:{}),
      ...(clean(request.worldProvider)?{worldProvider:clean(request.worldProvider)}:{})
    });
    if(generation?.status!=='world-artifacts-ready') {
      const error=new Error('World generation did not produce verified importable artifacts');
      error.code='GENERATED_WORLD_ARTIFACTS_NOT_READY';
      throw error;
    }
    const nextEnvironment=await this.materializeEnvironment(this.runtime,generation);
    const runtime=this.runtime;
    let transactionStarted=false;
    try {
      return await runtime.exclusiveMutation('prompt-hybrid-world',async()=>{
        transactionStarted=true;
      const beforeScene=runtime.snapshot();
      const authorityBefore=runtime.captureWorldAuthority?.() || null;
      const previousEnvironment=runtime.environment || null;
      let environmentInstalled=false;
      const rollback=async()=>{
        await runtime.clearObjects({silent:true});
        if(previousEnvironment && runtime.environment!==previousEnvironment) {
          await runtime.replaceEnvironment(previousEnvironment,{disposePrevious:false,reason:'prompt-hybrid-world-rollback'});
        }
        await runtime.restore(beforeScene);
        if(authorityBefore) runtime.restoreWorldAuthority?.(authorityBefore);
      };
      try {
        await runtime.clearObjects({silent:true});
        await runtime.replaceEnvironment(nextEnvironment,{disposePrevious:false,reason:'prompt-hybrid-world'});
        environmentInstalled=true;
        const artifactRefs=Object.values(generation.artifacts||{}).map((item)=>item?.artifact?.id).filter(Boolean).sort();
        const proposed=buildWorldProposal(request.proposal,{
          revisionId:this.revisionIdFactory(),
          source:'prompt-hybrid-world',
          sourceId:generation.jobs?.world || null,
          createdBy:'agent',
          evidenceRefs:artifactRefs
        });
        const built=await this.worldBuilder.run(proposed.worldIR);
        if(built.status==='world-rejected') {
          await rollback();
          nextEnvironment.dispose?.();
          return {
            status:'world-rejected',reason:built.reason || built.admission?.reasons?.[0] || 'WORLD_REJECTED',rolledBack:true,
            generation:generationEvidence(generation),environment:environmentEvidence(nextEnvironment),proposal:proposed.summary,
            admission:clone(built.admission),attempts:clone(built.attempts)
          };
        }
        previousEnvironment?.dispose?.();
        return {
          status:built.status,
          generation:generationEvidence(generation),environment:environmentEvidence(nextEnvironment),proposal:proposed.summary,
          worldRevisionId:proposed.summary.worldRevisionId,
          admission:clone(built.admission),attempts:clone(built.attempts),objects:runtime.listObjects()
        };
      } catch(error) {
        try { await rollback(); }
        catch(rollbackError){
          const failure=new AggregateError([error,rollbackError],'Prompt Hybrid World rollback failed',{cause:error});
          failure.code='PROMPT_HYBRID_WORLD_ROLLBACK_FAILED';
          failure.rollbackError=rollbackError;
          throw failure;
        }
        if(environmentInstalled || runtime.environment!==nextEnvironment) nextEnvironment.dispose?.();
        throw error;
      }
      });
    } catch(error) {
      if(!transactionStarted) nextEnvironment.dispose?.();
      throw error;
    }
  }
}
