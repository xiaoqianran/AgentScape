import {describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {startServer} from '../../apps/mcp-server/main.mjs';
import {connectStudioMcp,STUDIO_TOOL_NAMES} from '../../apps/agent-host/McpWorldTools.js';

describe('Pi/DSH shared restricted MCP boundary',()=>{
  it('authenticates, discovers the allowlist and actually calls a browser-owned world',async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'agentscape-agent-mcp-'));
    const token='agent-host-mcp-token-'+'x'.repeat(40);
    let app,connection;
    try{
      app=await startServer({port:0,tokens:[{identity:'unit-test-owner',token}],
        root:path.join(root,'sessions'),dataRoot:path.join(root,'assets')});
      const {worldSessionId,studioToken}=app.studioBridge.registerAuto(randomUUID(),'studio-unit-world');
      connection=await connectStudioMcp({url:'http://127.0.0.1:'+app.port+'/agent-mcp',token});
      expect(connection.worldSessionId).toBe(worldSessionId);
      expect(connection.tools.map(tool=>tool.name)).toEqual(expect.arrayContaining(['scene_observe','scene_verify']));
      expect(connection.tools.map(tool=>tool.name)).not.toContain('authoring_execute');
      expect(connection.tools.every(tool=>STUDIO_TOOL_NAMES.includes(tool.name))).toBe(true);
      const add=connection.tools.find(tool=>tool.name==='scene_add_model');
      expect(add.parameters.required).not.toContain('requestId');
      expect(JSON.stringify(add.parameters)).toContain('agentscape.asset-recipe');
      expect(add.parameters.properties).not.toHaveProperty('worldSessionId');
      expect(add.parameters.properties).not.toHaveProperty('requestId');
      const publish=connection.tools.find(tool=>tool.name==='asset_publish');
      await expect(publish.execute('publish-missing',{buildId:randomUUID()})).rejects.toThrow('BUILD_NOT_FOUND');
      const invalid=app.http.address();
      const reply=await fetch('http://127.0.0.1:'+invalid.port+'/agent-mcp',{method:'POST',
        headers:{authorization:'Bearer '+token,'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'scene_add_model',
          arguments:{requestId:randomUUID(),model:{asset:{schema:'agentscape.asset-recipe',schemaVersion:1,id:'bad',parts:[]}}}}})});
      const issue=JSON.parse((await reply.json()).result.content[0].text);
      expect(issue.diagnostics).toContainEqual({path:'model.asset.parts',code:'too_small'});
      const observer=connection.tools.find(tool=>tool.name==='scene_observe');
      const work=observer.execute('call-1',{},new AbortController().signal);
      const {request}=await app.studioBridge.poll(worldSessionId,studioToken);
      expect(request.method).toBe('observe');
      app.studioBridge.reply(worldSessionId,studioToken,{requestId:request.requestId,result:{objects:[{id:'apple-tree'}]}});
      const result=await work;
      expect(result.content.some(part=>part.type==='text' && part.text.includes('apple-tree'))).toBe(true);
    }finally{
      await connection?.close();
      await app?.close();
      await rm(root,{recursive:true,force:true});
    }
  },30000);
});
