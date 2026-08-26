import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..');
const gitmodules=fs.readFileSync(path.join(root,'.gitmodules'),'utf8');

const expected=new Map([
  ['providers/modal/image-runtime','https://github.com/xiaoqianran/modal-2D'],
  ['providers/modal/image-agent','https://github.com/xiaoqianran/modal-2D-client'],
  ['providers/modal/connector','https://github.com/xiaoqianran/modal-gen-client'],
  ['providers/modal/object3d-runtime','https://github.com/xiaoqianran/modal-3D'],
  ['providers/modal/object3d-agent','https://github.com/xiaoqianran/modal-3D-client'],
  ['providers/kaggle/runtime','https://github.com/xiaoqianran/kaggle-inference-hub'],
  ['providers/embodied/runtime','https://github.com/xiaoqianran/modal-build'],
  ['sdk/python','https://github.com/xiaoqianran/AgentScape-client'],
  ['upstream/EmbodiedGen','https://github.com/HorizonRobotics/EmbodiedGen'],
  ['research/modal-lab','https://github.com/xiaoqianran/modal-lab']
]);

const sections=[...gitmodules.matchAll(/\[submodule \"([^\"]+)\"\]([\s\S]*?)(?=\n\[submodule |$)/g)];
const actual=new Map();
for(const [,name,body] of sections){
  const p=body.match(/^\s*path\s*=\s*(.+)$/m)?.[1]?.trim();
  const url=body.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  if(!p||!url) throw new Error(`Invalid .gitmodules section: ${name}`);
  if(actual.has(p)) throw new Error(`Duplicate submodule path: ${p}`);
  actual.set(p,url);
}

const failures=[];
for(const [p,url] of expected){
  if(actual.get(p)!==url) failures.push(`${p}: expected ${url}, got ${actual.get(p) || '<missing>'}`);
}
for(const p of actual.keys()) if(!expected.has(p)) failures.push(`${p}: unexpected submodule path`);

const providerPaths=[...actual.keys()].filter((p)=>p.startsWith('providers/'));
for(const p of providerPaths){
  if(!/^providers\/(modal\/(image-runtime|image-agent|connector|object3d-runtime|object3d-agent)|kaggle\/runtime|embodied\/runtime)$/.test(p)){
    failures.push(`${p}: provider repository is outside the converged provider ownership tree`);
  }
}
if(actual.has('upstream/EmbodiedGen') && actual.get('upstream/EmbodiedGen')!==expected.get('upstream/EmbodiedGen')){
  failures.push('EmbodiedGen upstream must remain the read-only HorizonRobotics source');
}

if(failures.length){
  console.error('repository architecture validation failed');
  failures.forEach((f)=>console.error(`- ${f}`));
  process.exit(1);
}
console.log(`repository architecture validation passed (${actual.size} pinned submodules)`);
