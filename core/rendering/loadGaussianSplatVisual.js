import { disposeObject3D } from '../disposeObject3D.js';
import { applyGeneratedWorldObjectTransform } from '../generatedWorldCoordinates.js';

const asArrayBuffer=(bytes)=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
export const DEFAULT_RUNTIME_SPLAT_BUDGET=500_000;

const sampleTypedArray=(input,stride,sourceCount,targetCount)=>{
  if(!input || targetCount>=sourceCount)return input;
  const output=new input.constructor(targetCount*stride);
  for(let index=0;index<targetCount;index+=1){
    const sourceIndex=Math.min(sourceCount-1,Math.floor(index*sourceCount/targetCount));
    output.set(input.subarray(sourceIndex*stride,sourceIndex*stride+stride),index*stride);
  }
  return output;
};

export function budgetGaussianData(data,maxSplats=DEFAULT_RUNTIME_SPLAT_BUDGET){
  const sourceSplatCount=Math.floor((data?.position?.length||0)/4);
  if(!sourceSplatCount)return {data,sourceSplatCount:0,splatCount:0,sampled:false};
  const budget=Number.isFinite(maxSplats)&&maxSplats>0?Math.floor(maxSplats):DEFAULT_RUNTIME_SPLAT_BUDGET;
  const splatCount=Math.min(sourceSplatCount,budget);
  if(splatCount===sourceSplatCount)return {data,sourceSplatCount,splatCount,sampled:false};
  const extra=data.extra||{};
  return {
    data:{
      ...data,
      position:sampleTypedArray(data.position,4,sourceSplatCount,splatCount),
      color:sampleTypedArray(data.color,4,sourceSplatCount,splatCount),
      covariance:sampleTypedArray(data.covariance,8,sourceSplatCount,splatCount),
      extra:{
        ...extra,
        ...(extra.sh1?{sh1:sampleTypedArray(extra.sh1,2,sourceSplatCount,splatCount)}:{}),
        ...(extra.sh2?{sh2:sampleTypedArray(extra.sh2,4,sourceSplatCount,splatCount)}:{}),
        ...(extra.sh3?{sh3:sampleTypedArray(extra.sh3,4,sourceSplatCount,splatCount)}:{})
      }
    },
    sourceSplatCount,
    splatCount,
    sampled:true
  };
}

export async function loadGaussianSplatVisual({source,coordinateSystem='y-up',metersPerUnit=1,maxSplats=DEFAULT_RUNTIME_SPLAT_BUDGET}={}) {
  if(!source) throw new TypeError('Gaussian splat visual source is required');
  const format=String(source.format||source.url?.split(/[?#]/,1)[0]?.split('.').at(-1)||'').toLowerCase();
  if(format!=='spz') throw new TypeError(`Unsupported generated visual format: ${format||'unknown'}`);
  const bytes=source.data instanceof Uint8Array
    ? source.data
    : source.data instanceof ArrayBuffer
      ? new Uint8Array(source.data)
      : null;
  let buffer;
  if(bytes) buffer=asArrayBuffer(bytes);
  else {
    if(typeof source.url!=='string'||!source.url) throw new TypeError('Gaussian splat visual requires url or data');
    const response=await fetch(source.url);
    if(!response.ok) throw new Error(`Failed to load generated SPZ visual: ${response.status}`);
    buffer=await response.arrayBuffer();
  }

  const {GSMesh,SpzLoader}=await import('three-gsmesh');
  const parsed=await new SpzLoader({includeSH:true}).parseData(buffer);
  const budgeted=budgetGaussianData(parsed,maxSplats);
  if(!budgeted.splatCount) throw new Error('Generated SPZ visual contains no splats');
  const object=new GSMesh(budgeted.data,{sortIntervalFrames:3});
  object.name='GeneratedWorldGaussianSplat';
  applyGeneratedWorldObjectTransform(object,coordinateSystem,metersPerUnit);
  return {
    object,
    format:'spz',
    splatCount:budgeted.splatCount,
    sourceSplatCount:budgeted.sourceSplatCount,
    sampled:budgeted.sampled,
    dispose(){ disposeObject3D(object); }
  };
}
