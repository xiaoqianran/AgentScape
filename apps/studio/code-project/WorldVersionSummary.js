import { projectFileEntries } from '../../../application/native-scene/CodeProjectModules.js';
import { parseCodeProject } from '../../../application/native-scene/CodeProject.js';
import { canonicalAssetJson } from '../../../modules/asset/model/AssetInputContracts.js';

const equal=(a,b)=>a===b||(a!==undefined&&b!==undefined&&canonicalAssetJson(a)===canonicalAssetJson(b));
const names=items=>({total:items.length,items:items.slice(0,100)});
function diffMap(before={},after={}){
  const added=[],removed=[],modified=[];
  for(const key of Object.keys(before).sort()){
    if(!Object.hasOwn(after,key))removed.push(key);
    else if(!equal(before[key],after[key]))modified.push(key);
  }
  for(const key of Object.keys(after).sort())if(!Object.hasOwn(before,key))added.push(key);
  return {added:names(added),removed:names(removed),modified:names(modified)};
}
const objects=project=>Object.fromEntries((project.runtime?.snapshot?.objects||[]).map(object=>[object.id,object]));
export async function compareCodeVersions(before,after){
  if(before.kind!=='code-project'||after.kind!==before.kind||before.id!==after.id)
    throw new Error('WORLD_REPOSITORY_HISTORY_INVALID');
  const a=await parseCodeProject(before.content),b=await parseCodeProject(after.content);
  if(a.id!==before.id||b.id!==before.id)throw new Error('WORLD_REPOSITORY_ID_MISMATCH');
  return {fromVersion:before.version,toVersion:after.version,
    files:diffMap(projectFileEntries(a),projectFileEntries(b)),resources:diffMap(a.resources,b.resources),
    managedObjects:diffMap(objects(a),objects(b)),nativeEdits:diffMap(a.edits?.overrides,b.edits?.overrides),
    nameChanged:a.name!==b.name,stateChanged:!equal(a.state,b.state),
    machinesChanged:!equal(a.machines,b.machines),runtimeChanged:!equal(a.runtime,b.runtime)};
}

/** A copied checkpoint owns a new identity, never the original publication baseline. */
export async function forkCodeVersion(record,store){
  if(record.kind!=='code-project')throw new Error('WORLD_REPOSITORY_KIND_INVALID');
  const {integrity,...project}=await parseCodeProject(record.content);
  if(project.id!==record.id)throw new Error('WORLD_REPOSITORY_ID_MISMATCH');
  const id='world_'+crypto.randomUUID().replaceAll('-','');
  if(project.runtime?.snapshot?.metadata?.environment==='code-project:'+record.id)
    project.runtime.snapshot.metadata.environment='code-project:'+id;
  const copy=await parseCodeProject({...project,id,name:project.name+' (历史 v'+record.version+')'});
  await store.save({id,name:copy.name,document:{project:copy,revision:1,requiresExplicitRun:true}});
  return {id,name:copy.name};
}
