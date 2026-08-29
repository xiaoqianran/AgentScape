import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const exists=(...parts)=>fs.existsSync(path.join(root,...parts));
const read=(...parts)=>fs.readFileSync(path.join(root,...parts),'utf8');
const walk=(dir)=>fs.existsSync(dir)
  ? fs.readdirSync(dir,{withFileTypes:true}).flatMap((entry)=>entry.isDirectory()?walk(path.join(dir,entry.name)):[path.join(dir,entry.name)])
  : [];
const rel=(file)=>path.relative(root,file).replaceAll(path.sep,'/');
const failures=[];

for(const retired of [
  ['generation','orchestration','LegacyAuthoringShell.js'],
  ['asset','gateway','HttpAssetGenerator.js'],
  ['api','capabilities','asset-generate.js'],
  ['tooling','scripts','repos.sh'],
  ['sdk','python','agentscape','pipeline.py'],
  ['sdk','python','agentscape','providers']
]) if(exists(...retired)) failures.push(`Retired surface must not return: ${retired.join('/')}`);

const generationFiles=walk(path.join(root,'generation')).filter((file)=>file.endsWith('.js'));
for(const file of generationFiles){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:from\s+|import\s*\()\s*['"]([^'"]+)['"]/g)){
    const spec=match[1];
    if(!spec.startsWith('.')) continue;
    const target=rel(path.resolve(path.dirname(file),spec));
    if(target.startsWith('studio/')) failures.push(`Generation must not depend on Studio: ${rel(file)} -> ${target}`);
  }
}

const providerRegistry=read('generation','providers','ProviderRegistry.js');
for(const id of ['modal-2d','modal-3d','embodiedgen','legacy-http-generator']){
  if(providerRegistry.includes(id)) failures.push(`ProviderRegistry must not hard-code remote Provider id: ${id}`);
}

const toolAgent=read('agent','ToolCallingAgent.js');
if(/const\s+SYSTEM_PROMPT\s*=/.test(toolAgent)) failures.push('ToolCallingAgent must compose prompt policies instead of embedding SYSTEM_PROMPT');
const coreSkills=read('agent','skills','registerCoreSkills.js');
if(/\badd\s*\(/.test(coreSkills)) failures.push('registerCoreSkills must remain composition-only; handlers belong in domain skill packs');
if(!exists('agent','prompt','index.js')) failures.push('Structured Agent prompt policies are missing');
if(!exists('agent','skills','packs')) failures.push('Domain skill packs are missing');

const packageJson=JSON.parse(read('package.json'));
for(const name of Object.keys(packageJson.scripts || {})) if(name.startsWith('repos:')) failures.push(`Retired package script must not return: ${name}`);

const sdkRemoved=[
  ['sdk','python','agentscape','providers'],
  ['sdk','python','agentscape','pipeline.py']
];
for(const item of sdkRemoved) if(exists(...item)) failures.push(`Python SDK direct-provider surface must not return: ${item.join('/')}`);
const sdkSettings=read('sdk','python','agentscape','settings.py');
for(const field of ['kaggle_url','kaggle_token','modal_2d_agent_url','modal_agent_url:','modal_agent_session:']){
  if(sdkSettings.includes(field)) failures.push(`Python SDK public Settings still exposes retired field: ${field}`);
}

const rootTests=walk(path.join(root,'tests')).filter((file)=>path.dirname(file)===path.join(root,'tests') && file.endsWith('.test.js'));
for(const file of rootTests){
  failures.push(`Tests must be grouped by owner/scope, not flat at tests/: ${rel(file)}`);
}

if(failures.length){
  console.error('convergence validation failed');
  failures.forEach((failure)=>console.error(`- ${failure}`));
  process.exit(1);
}
console.log('convergence validation passed');
