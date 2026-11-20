import {describe,it,expect} from 'vitest';
import {startLocalAgentStack} from '../../apps/agent-host/local-stack.mjs';

describe('local AgentScape stack bootstrap',()=>{
  it('creates an ephemeral MCP bearer in the host only and restores environment',async()=>{
    let token,config,closed=0;
    const before=process.env.AGENTSCAPE_MCP_TOKEN;
    const stack=await startLocalAgentStack({
      mcpPort:39015,agentPort:8789,
      env:{AGENTSCAPE_LLM_BASE_URL:'http://127.0.0.1/mock',AGENTSCAPE_LLM_API_KEY:'key',
        AGENTSCAPE_LLM_MODEL:'mock-model'},
      startMcp:async options=>{
        token=options.tokens[0].token;
        return {close:async()=>closed++};
      },
      createHost:options=>{
        config=options.config;
        return {listen:async()=>{},close:async()=>closed++};
      }
    });
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(config.mcpToken).toBe(token);
    expect(config.mcpUrl).toBe('http://127.0.0.1:39015/agent-mcp');
    await stack.close();
    expect(closed).toBe(2);
    expect(process.env.AGENTSCAPE_MCP_TOKEN).toBe(before);
  });
});
