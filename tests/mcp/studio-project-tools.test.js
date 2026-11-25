import {describe,it,expect,vi} from 'vitest';
import {registerTools} from '../../apps/mcp-server/registerTools.js';
import {STUDIO_PROJECT_TOOLS} from '../../application/agent/StudioProjectTools.js';
import {executionRecord} from '../../apps/agent-host/AgentExecution.js';
import {randomUUID} from 'node:crypto';

function fixture(projectScope){
  const worldSessionId=randomUUID();
  const bridge={currentSession:()=>({worldSessionId}),isStudioSession:()=>true,ownerSession:vi.fn(),
    call:vi.fn(async(_owner,_id,_method,args)=>args.operation==='capture'?
      {status:'captured',imageBase64:'YWJj',mime:'image/jpeg'}:{status:'ok',operation:args.operation})};
  const catalog=new Map();
  registerTools({registerTool:(name,options,handler)=>catalog.set(name,{...options,handler})},null,'owner',null,bridge,
    {agentOnly:true,projectScope:projectScope?{worldSessionId,projectId:'world_'+'f'.repeat(32)}:undefined});
  return {catalog,bridge,worldSessionId,parse:(name,args)=>catalog.get(name).inputSchema.safeParse(args),
    call:(name,args)=>catalog.get(name).handler(catalog.get(name).inputSchema.parse(args),{})};
}

describe('five narrow Studio MCP tool contracts',()=>{
  it('disallows cross-category operations and fields and requires live revisions',()=>{
    const {catalog,parse}=fixture();
    for(const name of STUDIO_PROJECT_TOOLS)expect(catalog.has(name)).toBe(true);
    expect(parse('studio_project',{operation:'capture',expectedRevision:1}).success).toBe(false);
    expect(parse('studio_project',{operation:'write',source:'code'}).success).toBe(false);
    expect(parse('studio_files',{operation:'write',create:true,source:'code'}).success).toBe(false);
    expect(parse('scene_query',{operation:'inspect',expectedRevision:1,source:'code'}).success).toBe(false);
    expect(parse('scene_capture',{operation:'capture'}).success).toBe(false);
    expect(parse('scene_timeline',{command:'step',expectedRevision:1,steps:121}).success).toBe(false);
    expect(parse('scene_query',{operation:'search',expectedRevision:1,query:'Mesh',limit:65}).success).toBe(false);
    expect(parse('studio_files',{operation:'file_read',path:'main.js',limit:65536}).success).toBe(true);
  });
  it('routes every category to the same existing project bridge and preserves image content',async()=>{
    const {call,bridge,worldSessionId}=fixture();const requestId=randomUUID();
    await call('studio_project',{operation:'create',name:'World',source:'code',requestId});
    expect(bridge.call).toHaveBeenLastCalledWith('owner',worldSessionId,'project',{operation:'write',create:true,name:'World',source:'code'},expect.objectContaining({requestId}));
    await call('studio_files',{operation:'patch',expectedRevision:2,oldText:'a',newText:'b'});
    expect(bridge.call.mock.lastCall[3]).toEqual({operation:'patch',expectedRevision:2,oldText:'a',newText:'b'});
    await call('scene_query',{operation:'inspect',expectedRevision:2,nodePath:'0',objectUuid:'uuid'});
    expect(bridge.call.mock.lastCall[3]).toEqual({operation:'inspect',expectedRevision:2,nodePath:'0',objectUuid:'uuid'});
    await call('scene_query',{operation:'physics_candidate',expectedRevision:2,nodePath:'0',objectUuid:'uuid'});
    expect(bridge.call.mock.lastCall[3]).toEqual({operation:'physics_candidate',expectedRevision:2,nodePath:'0',objectUuid:'uuid'});
    const capture=await call('scene_capture',{operation:'capture',expectedRevision:2,imageMode:'mcp'});
    expect(capture.content).toEqual([{type:'text',text:JSON.stringify({status:'captured',mime:'image/jpeg'})},{type:'image',data:'YWJj',mimeType:'image/jpeg'}]);
    await call('scene_timeline',{command:'pause',expectedRevision:2});
    expect(bridge.call.mock.lastCall[3]).toEqual({operation:'timeline',expectedRevision:2,command:'pause'});
  });
  it('enforces scoped operations in the actual parser and binds all five tools to the prepared project',async()=>{
    const {call,parse,bridge}=fixture(true);
    for(const operation of ['create','create_world','open','close'])expect(parse('studio_project',{operation}).success).toBe(false);
    expect(parse('studio_files',{operation:'write',create:true}).success).toBe(false);
    for(const [name,args] of [['studio_project',{operation:'read'}],['studio_files',{operation:'file_read',path:'main.js'}],['scene_query',{operation:'inspect',expectedRevision:1}],['scene_capture',{operation:'capture',expectedRevision:1}],['scene_timeline',{expectedRevision:1}]]){
      await call(name,args);expect(bridge.call.mock.lastCall[3].expectedProjectId).toBe('world_'+'f'.repeat(32));
    }
  });
  it('classifies draft mutations and timeline commands independently of read evidence',()=>{
    for(const [name,args,mutates,operation] of [
      ['studio_files',{operation:'write'},true,'write'],['studio_files',{operation:'preview_batch'},false,'preview_batch'],
      ['scene_query',{operation:'inspect'},false,'inspect'],['scene_capture',{operation:'capture'},false,'capture'],
      ['scene_timeline',{command:'pause'},true,'pause'],['scene_timeline',{command:'status'},false,'status']]){
      expect(executionRecord({name,args,result:{content:[{type:'text',text:'{}'}]}})).toMatchObject({tool:name,mutates,operation,outcome:{state:'accepted'}});
    }
  });
});
