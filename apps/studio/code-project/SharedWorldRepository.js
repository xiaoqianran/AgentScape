import { parseCodeProject } from '../../../application/native-scene/CodeProject.js';

const fail = code => Object.assign(new Error(code),{code});
const encodeId = id => {
  if(typeof id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(id))
    throw fail('WORLD_REPOSITORY_ID_INVALID');
  return encodeURIComponent(id);
};

/** Browser transport only. A missing API means the deployment is static/read-only.
 * Publication is always explicit and requires a bearer token entered by the user.
 */
export class SharedWorldRepository {
  constructor({base='/api/studio/worlds',fetchImpl=globalThis.fetch,storage=globalThis.localStorage}={}) {
    this.base=base;
    this.fetch=fetchImpl.bind(globalThis);
    this.storage=storage;
    this.versions=new Map();
  }
  async request(url,options={}) {
    let response;
    try{response=await this.fetch(url,{cache:'no-store',...options});}
    catch{throw fail('WORLD_REPOSITORY_OFFLINE');}
    let body;
    try{body=await response.json();}
    catch{throw fail('WORLD_REPOSITORY_INVALID_RESPONSE');}
    if(!response.ok)throw fail(body.code||'WORLD_REPOSITORY_REQUEST_FAILED');
    return body;
  }
  async list({kind=null,offset=0,limit=50}={}) {
    const query=new URLSearchParams({offset:String(offset),limit:String(limit)});
    if(kind)query.set('kind',kind);
    return this.request(this.base+'?'+query);
  }
  async get(id) {
    return this.request(this.base+'/'+encodeId(id));
  }
  async openCode(id) {
    const record=await this.get(id);
    if(record.kind!=='code-project')throw fail('WORLD_REPOSITORY_KIND_INVALID');
    const project=await parseCodeProject(record.content);
    if(project.id!==id)throw fail('WORLD_REPOSITORY_ID_MISMATCH');
    return {...record,content:project};
  }
  versionKey(id){return 'agentscape.shared-world.version.'+encodeId(id);}
  versionOf(id) {
    const cached=this.versions.get(id);
    if(cached!=null)return cached;
    try{
      const raw=this.storage?.getItem(this.versionKey(id));
      if(!raw)return null;
      const value=JSON.parse(raw);
      return Number.isSafeInteger(value?.version)&&value.version>=1?value.version:null;
    }catch{return null;}
  }
  remember(id,version) {
    if(!Number.isSafeInteger(version)||version<1)throw fail('WORLD_REPOSITORY_VERSION_INVALID');
    this.versions.set(id,version);
    try{this.storage?.setItem(this.versionKey(id),JSON.stringify({version}));}catch{/* Keep in-memory ownership as fallback. */}
    return version;
  }
  async publish({kind,content,token,baseVersion}={}) {
    if(typeof token!=='string'||!token.trim())throw fail('WORLD_REPOSITORY_AUTH_REQUIRED');
    const id=encodeId(content?.id);
    const version=baseVersion===undefined?this.versionOf(content.id):baseVersion;
    const value=await this.request(this.base+'/'+id,{
      method:'PUT',headers:{'content-type':'application/json','authorization':'Bearer '+token.trim()},
      body:JSON.stringify({kind,baseVersion:version,content})
    });
    this.remember(content.id,value.version);
    return value;
  }
}
