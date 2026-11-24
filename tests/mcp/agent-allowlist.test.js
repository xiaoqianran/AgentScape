import {describe,it,expect} from 'vitest';
import {registerTools} from '../../apps/mcp-server/registerTools.js';
import {AGENT_STUDIO_MCP_TOOLS} from '../../application/agent/StudioMcpAllowlist.js';

describe('agent-only MCP tool surface',()=>{
  it('does not advertise an execution-log-only condition as a live scene assertion',()=>{
    const tools=new Map();
    registerTools({registerTool:(name,options)=>tools.set(name,options)},null,'owner',null,null,{agentOnly:true});
    const schema=tools.get('scene_verify').inputSchema;
    expect(schema.safeParse({criteria:[{id:'valid',kind:'world-valid'}]}).success).toBe(true);
    expect(schema.safeParse({criteria:[{id:'unresolved',kind:'no-unresolved'}]}).success).toBe(false);
  });
  it('publishes only reviewed AgentScape tools, preserving regular MCP catalog',()=>{
    const agent=[],legacy=[];
    const collector=target=>({registerTool:(name)=>target.push(name)});
    registerTools(collector(agent),null,'owner',null,null,{agentOnly:true});
    registerTools(collector(legacy),null,'owner',null,null);
    expect(new Set(agent)).toEqual(new Set(AGENT_STUDIO_MCP_TOOLS));
    expect(agent).toContain('studio_sessions_list');
    expect(legacy.length).toBeGreaterThan(agent.length);
    for(const forbidden of ['authoring_execute','session_create','action_execute','studio_pair_create','world_restore'])
      expect(agent).not.toContain(forbidden);
  });
});
