import { readFile,readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
let cached;
// Version the trusted compiler/validation pipeline as well as the container image.
export function pipelineDigest() {
 cached ||= (async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const directories=['modules/asset/production','modules/asset/model','modules/world/verification','application/programmatic-assets','application/world-authoring'];
  const files=[];const walk=async dir=>{for(const entry of await readdir(path.join(root,dir),{withFileTypes:true})){const relative=path.posix.join(dir,entry.name);if(entry.isDirectory())await walk(relative);else if(/\.[cm]?js$/.test(entry.name))files.push(relative);}};
  for(const dir of directories)await walk(dir);
  files.push('apps/mcp-server/HeadlessGLTFLoader.js','modules/asset/AssetModule.js','package-lock.json');
  const digest=createHash('sha256');for(const file of files.sort())digest.update(file).update(await readFile(path.join(root,file)));
  return digest.digest('hex');
 })();return cached;
}
