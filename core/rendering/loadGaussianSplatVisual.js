import { disposeObject3D } from '../disposeObject3D.js';
import { applyGeneratedWorldObjectTransform } from '../generatedWorldCoordinates.js';

const asArrayBuffer=(bytes)=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);

export async function loadGaussianSplatVisual({source,coordinateSystem='y-up',metersPerUnit=1}={}) {
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
  const data=await new SpzLoader({includeSH:true}).parseData(buffer);
  const splatCount=Math.floor(data.position.length/3);
  if(!splatCount) throw new Error('Generated SPZ visual contains no splats');
  const object=new GSMesh(data,{sortIntervalFrames:1});
  object.name='GeneratedWorldGaussianSplat';
  applyGeneratedWorldObjectTransform(object,coordinateSystem,metersPerUnit);
  return {
    object,
    format:'spz',
    splatCount,
    dispose(){ disposeObject3D(object); }
  };
}
