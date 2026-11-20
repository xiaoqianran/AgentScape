import {describe,it,expect} from 'vitest';
import {registerTools} from '../../apps/mcp-server/registerTools.js';
import {AGENT_STUDIO_MCP_TOOLS} from '../../application/agent/StudioMcpAllowlist.js';

describe('agent-only MCP tool surface',()=>{
  it('publishes only reviewed AgentScape tools, preserving regular MCP catalog',()=>{
    const agent=[],legacy=[];
    const collector=target=>({registerTool:(name)=>target.push(name)});
    registerTools(collector(agent),null,'owner',null,null,{agentOnly:true});
    registerTools(collector(legacy),null,'owner',null,null);
    expect(new Set(agent)).toEqual(new Set(AGENT_STUDIO_MCP_TOOLS));
    expect(legacy.length).toBeGreaterThan(agent.length);
    for(const forbidden of ['authoring_execute','session_create','action_execute','studio_pair_create','world_restore'])
      expect(agent).not.toContain(forbidden);
  });
});
