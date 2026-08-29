import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root=path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')),'..');
const gitmodulesPath=path.join(root,'.gitmodules');
const gitmodules=fs.existsSync(gitmodulesPath)?fs.readFileSync(gitmodulesPath,'utf8'):'';

const expected=new Map();

const sections=[...gitmodules.matchAll(/\[submodule \"([^\"]+)\"\]([\s\S]*?)(?=\n\[submodule |$)/g)];
const actual=new Map();
for(const [,name,body] of sections){
  const p=body.match(/^\s*path\s*=\s*(.+)$/m)?.[1]?.trim();
  const url=body.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  if(!p||!url) throw new Error(`Invalid .gitmodules section: ${name}`);
  if(actual.has(p)) throw new Error(`Duplicate submodule path: ${p}`);
  actual.set(p,url);
}

const pythonSdkPyproject=path.join(root,'sdk','python','pyproject.toml');

const failures=[];
if(!fs.existsSync(pythonSdkPyproject)) failures.push('sdk/python: in-repo Python SDK package is missing pyproject.toml');
if(actual.has('sdk/python')) failures.push('sdk/python: Python SDK must be owned by the AgentScape monorepo, not pinned as a submodule');

for(const [p,url] of expected){
  if(actual.get(p)!==url) failures.push(`${p}: expected ${url}, got ${actual.get(p) || '<missing>'}`);
}
for(const p of actual.keys()) if(!expected.has(p)) failures.push(`${p}: unexpected submodule path`);

const providerPaths=[...actual.keys()].filter((p)=>p.startsWith('providers/'));
for(const p of providerPaths) failures.push(`${p}: provider repositories must not be pinned as submodules`);

if(failures.length){
  console.error('repository architecture validation failed');
  failures.forEach((f)=>console.error(`- ${f}`));
  process.exit(1);
}
console.log(`repository architecture validation passed (${actual.size} pinned submodules)`);
