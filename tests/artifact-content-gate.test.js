import { describe, expect, it } from 'vitest';
import { validateArtifactContent } from '../src/artifacts/ArtifactContentGate.js';

const glb=({version=2,headerLength=24,magic=true,firstChunkType=0x4e4f534a,firstChunkLength=4,totalLength=24}={})=>{
  const bytes=new Uint8Array(totalLength);
  bytes.set(magic?[0x67,0x6c,0x54,0x46]:[0,0,0,0]);
  const view=new DataView(bytes.buffer);
  view.setUint32(4,version,true);
  view.setUint32(8,headerLength,true);
  if (totalLength>=20) {
    view.setUint32(12,firstChunkLength,true);
    view.setUint32(16,firstChunkType,true);
  }
  if (totalLength>=24) bytes.set(new TextEncoder().encode('{}  '),20);
  return bytes;
};

const descriptor=(mime,format)=>({mime,format});

describe('ArtifactContentGate',()=>{
  it('validates GLB v2 magic and declared total length',()=>{
    const bytes=glb();
    expect(validateArtifactContent(descriptor('model/gltf-binary','glb'),{
      prefix:bytes,totalBytes:bytes.byteLength
    })).toEqual({mime:'model/gltf-binary',format:'glb'});
    const badMagic=new Uint8Array(bytes); badMagic[0]=0;
    expect(()=>validateArtifactContent(descriptor('model/gltf-binary','glb'),{prefix:badMagic,totalBytes:24}))
      .toThrow(expect.objectContaining({code:'ARTIFACT_MIME_MISMATCH'}));
    expect(()=>validateArtifactContent(descriptor('model/gltf-binary','glb'),{prefix:glb({version:1}),totalBytes:24}))
      .toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_INVALID'}));
    const wrongLength=glb({headerLength:28});
    expect(()=>validateArtifactContent(descriptor('model/gltf-binary','glb'),{prefix:wrongLength,totalBytes:24}))
      .toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_INVALID'}));
    expect(()=>validateArtifactContent(descriptor('model/gltf-binary','glb'),{
      prefix:glb({firstChunkType:0x004e4942}),totalBytes:24
    })).toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_INVALID'}));
    const nonObject=glb();
    nonObject.set(new TextEncoder().encode('[]  '),20);
    expect(()=>validateArtifactContent(descriptor('model/gltf-binary','glb'),{
      prefix:nonObject,totalBytes:24
    })).toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_INVALID'}));
  });

  it('parses bounded JSON but does not promote its semantics',()=>{
    const bytes=new TextEncoder().encode('{"parts":[{"name":"door"}]}');
    expect(validateArtifactContent(descriptor('application/json','json'),{
      prefix:bytes.subarray(0,12),totalBytes:bytes.length,fullBytes:bytes
    })).toEqual({mime:'application/json',format:'json'});
    const bad=new TextEncoder().encode('{bad json');
    expect(()=>validateArtifactContent(descriptor('application/json','json'),{
      prefix:bad,totalBytes:bad.length,fullBytes:bad
    })).toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_INVALID'}));
  });

  it('bounds JSON structure depth/node count after parse',()=>{
    const deep=new TextEncoder().encode('{"a":{"b":{"c":1}}}');
    expect(()=>validateArtifactContent(descriptor('application/json','json'),{
      prefix:deep.subarray(0,12),totalBytes:deep.length,fullBytes:deep,maxJsonDepth:2,maxJsonNodes:100
    })).toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_LIMIT'}));
    const nodes=new TextEncoder().encode('[1,2,3,4]');
    expect(()=>validateArtifactContent(descriptor('application/json','json'),{
      prefix:nodes,totalBytes:nodes.length,fullBytes:nodes,maxJsonDepth:10,maxJsonNodes:3
    })).toThrow(expect.objectContaining({code:'ARTIFACT_STRUCTURE_LIMIT'}));
  });

  it('detects PNG/JPEG/WebP signatures and format mismatches',()=>{
    const png=new Uint8Array([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
    expect(validateArtifactContent(descriptor('image/png','png'),{prefix:png,totalBytes:png.length}).mime).toBe('image/png');
    const jpg=new Uint8Array([0xff,0xd8,0xff,0xe0]);
    expect(validateArtifactContent(descriptor('image/jpeg','jpg'),{prefix:jpg,totalBytes:jpg.length}).format).toBe('jpeg');
    const webp=new TextEncoder().encode('RIFFxxxxWEBP');
    expect(validateArtifactContent(descriptor('image/webp','webp'),{prefix:webp,totalBytes:webp.length}).mime).toBe('image/webp');
    expect(()=>validateArtifactContent(descriptor('image/png','jpeg'),{prefix:png,totalBytes:png.length}))
      .toThrow(expect.objectContaining({code:'ARTIFACT_FORMAT_MISMATCH'}));
  });

  it('accepts bounded UTF-8 XML/OBJ structure without claiming semantic validity',()=>{
    const xml=new TextEncoder().encode('<?xml version="1.0"?><robot/>');
    expect(validateArtifactContent(descriptor('application/xml','urdf'),{
      prefix:xml.subarray(0,12),totalBytes:xml.length,fullBytes:xml
    })).toEqual({mime:'application/xml',format:'xml'});
    const obj=new TextEncoder().encode('v 0 0 0\n');
    expect(validateArtifactContent(descriptor('model/obj','obj'),{
      prefix:obj,totalBytes:obj.length,fullBytes:obj
    })).toEqual({mime:'model/obj',format:'obj'});
  });

  it('fails closed on archives and unsupported MIME',()=>{
    expect(()=>validateArtifactContent(descriptor('application/zip','zip'),{
      prefix:new Uint8Array([0x50,0x4b]),totalBytes:2
    })).toThrow(expect.objectContaining({code:'ARTIFACT_ARCHIVE_UNSUPPORTED'}));
    expect(()=>validateArtifactContent(descriptor('application/octet-stream','bin'),{
      prefix:new Uint8Array([1,2,3]),totalBytes:3
    })).toThrow(expect.objectContaining({code:'ARTIFACT_MIME_UNSUPPORTED'}));
  });
});
