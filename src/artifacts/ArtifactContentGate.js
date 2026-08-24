import { ArtifactContractError } from './ArtifactDescriptor.js';

const ARCHIVE_MIMES=new Set(['application/zip','application/x-zip-compressed','application/x-tar','application/gzip']);
const FULL_BYTE_MIMES=new Set(['application/json','application/xml','text/xml','text/plain','model/obj']);
const decoder=()=>new TextDecoder('utf-8',{fatal:true});

const formatAllowed=(actual,declared)=>{
  const value=String(declared||'').toLowerCase();
  const allowed={
    glb:new Set(['glb']),json:new Set(['json']),png:new Set(['png']),jpeg:new Set(['jpg','jpeg']),
    webp:new Set(['webp']),xml:new Set(['xml','urdf']),text:new Set(['txt','text','obj']),obj:new Set(['obj'])
  };
  return allowed[actual]?.has(value) ?? false;
};

const fail=(code,message,details={})=>{ throw new ArtifactContractError(code,message,details); };

export function artifactContentNeedsFullBytes(mime) {
  return FULL_BYTE_MIMES.has(String(mime||'').toLowerCase());
}

function requirePrefix(prefix,count,label) {
  if (!(prefix instanceof Uint8Array) || prefix.byteLength<count) fail('ARTIFACT_STRUCTURE_INVALID',`${label} artifact is too short`);
}

function validateGlb(prefix,totalBytes) {
  requirePrefix(prefix,20,'GLB');
  if (prefix[0]!==0x67||prefix[1]!==0x6c||prefix[2]!==0x54||prefix[3]!==0x46) fail('ARTIFACT_MIME_MISMATCH','GLB magic does not match model/gltf-binary');
  const view=new DataView(prefix.buffer,prefix.byteOffset,prefix.byteLength);
  const version=view.getUint32(4,true);
  const declaredLength=view.getUint32(8,true);
  const firstChunkLength=view.getUint32(12,true);
  const firstChunkType=view.getUint32(16,true);
  if (version!==2) fail('ARTIFACT_STRUCTURE_INVALID','Only GLB version 2 is supported',{version});
  if (declaredLength!==totalBytes) fail('ARTIFACT_STRUCTURE_INVALID','GLB header length does not match streamed artifact bytes',{declaredLength,totalBytes});
  if (firstChunkType!==0x4e4f534a) fail('ARTIFACT_STRUCTURE_INVALID','GLB first chunk must be JSON');
  if (firstChunkLength<4 || firstChunkLength%4!==0 || 20+firstChunkLength>totalBytes) {
    fail('ARTIFACT_STRUCTURE_INVALID','GLB first JSON chunk length is invalid',{firstChunkLength,totalBytes});
  }
  const inspectEnd=Math.min(prefix.byteLength,20+firstChunkLength);
  let firstJsonByte=null;
  for (let i=20;i<inspectEnd;i++) {
    if (![0x20,0x09,0x0a,0x0d].includes(prefix[i])) { firstJsonByte=prefix[i]; break; }
  }
  if (firstJsonByte!=null && firstJsonByte!==0x7b) {
    fail('ARTIFACT_STRUCTURE_INVALID','GLB JSON chunk must begin with a JSON object');
  }
  return {mime:'model/gltf-binary',format:'glb'};
}

function validatePng(prefix) {
  requirePrefix(prefix,8,'PNG');
  const magic=[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a];
  if (!magic.every((byte,index)=>prefix[index]===byte)) fail('ARTIFACT_MIME_MISMATCH','PNG signature mismatch');
  return {mime:'image/png',format:'png'};
}

function validateJpeg(prefix) {
  requirePrefix(prefix,3,'JPEG');
  if (prefix[0]!==0xff||prefix[1]!==0xd8||prefix[2]!==0xff) fail('ARTIFACT_MIME_MISMATCH','JPEG signature mismatch');
  return {mime:'image/jpeg',format:'jpeg'};
}

function validateWebp(prefix) {
  requirePrefix(prefix,12,'WebP');
  const text=String.fromCharCode(...prefix.subarray(0,12));
  if (text.slice(0,4)!=='RIFF'||text.slice(8,12)!=='WEBP') fail('ARTIFACT_MIME_MISMATCH','WebP signature mismatch');
  return {mime:'image/webp',format:'webp'};
}

function decodeText(fullBytes,label) {
  if (!(fullBytes instanceof Uint8Array)) fail('ARTIFACT_STRUCTURE_INVALID',`${label} validation requires full bounded bytes`);
  let text;
  try { text=decoder().decode(fullBytes); }
  catch { fail('ARTIFACT_STRUCTURE_INVALID',`${label} artifact is not valid UTF-8`); }
  if (text.includes('\0')) fail('ARTIFACT_STRUCTURE_INVALID',`${label} artifact contains NUL bytes`);
  return text;
}

function validateJson(fullBytes,{maxJsonDepth,maxJsonNodes}) {
  const text=decodeText(fullBytes,'JSON');
  let value;
  try { value=JSON.parse(text); }
  catch { fail('ARTIFACT_STRUCTURE_INVALID','JSON artifact failed bounded parse'); }
  const stack=[{value,depth:1}];
  let nodes=0;
  while (stack.length) {
    const current=stack.pop();
    nodes++;
    if (nodes>maxJsonNodes) fail('ARTIFACT_STRUCTURE_LIMIT','JSON artifact exceeds maxJsonNodes',{maxJsonNodes});
    if (current.depth>maxJsonDepth) fail('ARTIFACT_STRUCTURE_LIMIT','JSON artifact exceeds maxJsonDepth',{maxJsonDepth});
    if (current.value && typeof current.value==='object') {
      const children=Array.isArray(current.value)?current.value:Object.values(current.value);
      for (const child of children) stack.push({value:child,depth:current.depth+1});
    }
  }
  return {mime:'application/json',format:'json'};
}

function validateXml(fullBytes,mime) {
  const text=decodeText(fullBytes,'XML').trimStart();
  if (!text.startsWith('<')) fail('ARTIFACT_STRUCTURE_INVALID','XML artifact does not begin with markup');
  return {mime,format:'xml'};
}

function validateText(fullBytes,mime) {
  decodeText(fullBytes,'Text');
  return {mime,format:mime==='model/obj'?'obj':'text'};
}

export function validateArtifactContent(descriptor,{prefix,totalBytes,fullBytes=null,maxJsonDepth=64,maxJsonNodes=100000}={}) {
  const mime=String(descriptor?.mime||'').toLowerCase();
  if (ARCHIVE_MIMES.has(mime)) fail('ARTIFACT_ARCHIVE_UNSUPPORTED','Archive artifacts are fail-closed until bounded bundle parsing is implemented',{mime});
  let actual;
  if (mime==='model/gltf-binary') actual=validateGlb(prefix,totalBytes);
  else if (mime==='application/json') actual=validateJson(fullBytes,{maxJsonDepth,maxJsonNodes});
  else if (mime==='image/png') actual=validatePng(prefix);
  else if (mime==='image/jpeg') actual=validateJpeg(prefix);
  else if (mime==='image/webp') actual=validateWebp(prefix);
  else if (mime==='application/xml'||mime==='text/xml') actual=validateXml(fullBytes,mime);
  else if (mime==='text/plain'||mime==='model/obj') actual=validateText(fullBytes,mime);
  else fail('ARTIFACT_MIME_UNSUPPORTED','Artifact MIME is not supported by the v1 integrity gate',{mime});
  if (actual.mime!==mime) fail('ARTIFACT_MIME_MISMATCH','Detected artifact MIME does not match descriptor MIME',{expected:mime,actual:actual.mime});
  if (!formatAllowed(actual.format,descriptor.format)) fail('ARTIFACT_FORMAT_MISMATCH','Detected artifact format does not match descriptor format',{expected:descriptor.format,actual:actual.format});
  return actual;
}
