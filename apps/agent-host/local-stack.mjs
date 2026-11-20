import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {startServer} from '../mcp-server/main.mjs';
import {createAgentHost,getConfig,loadPrivateEnv} from './AgentHost.mjs';

/** One local-only MCP world bridge + Pi/DSH host, without exporting bearer keys. */
export async function startLocalAgentStack({
  mcpPort=39015,agentPort=8789,env=process.env,
  startMcp=startServer,createHost=createAgentHost
}={}) {
  if(env.AGENTSCAPE_MCP_TOKEN)throw new Error('STACK_EXPECTS_PRIVATE_GENERATED_TOKEN');
  const token=randomBytes(32).toString('hex');
  const configEnv={...env,AGENTSCAPE_MCP_TOKEN:token,
    AGENTSCAPE_MCP_URL:'http://127.0.0.1:'+mcpPort+'/agent-mcp'};
  // The DSH child process reads process.env. Set credentials only in the
  // private Node process, never in HTML, localStorage, URLs or logs.
  const previous={token:process.env.AGENTSCAPE_MCP_TOKEN,url:process.env.AGENTSCAPE_MCP_URL};
  process.env.AGENTSCAPE_MCP_TOKEN=token;
  process.env.AGENTSCAPE_MCP_URL=configEnv.AGENTSCAPE_MCP_URL;
  let mcp,host;
  const restore=()=>{
    if(previous.token===undefined)delete process.env.AGENTSCAPE_MCP_TOKEN;
    else process.env.AGENTSCAPE_MCP_TOKEN=previous.token;
    if(previous.url===undefined)delete process.env.AGENTSCAPE_MCP_URL;
    else process.env.AGENTSCAPE_MCP_URL=previous.url;
  };
  try{
    mcp=await startMcp({port:mcpPort,tokens:[{identity:'agent-host-local',token}],
      dataRoot:env.AGENTSCAPE_MCP_DATA_ROOT||path.resolve('.mcp-assets')});
    host=createHost({config:getConfig(configEnv),port:agentPort});
    await host.listen();
    return {mcp,host,close:async()=>{
      await host.close();
      await mcp.close();
      restore();
    }};
  }catch(error){
    await host?.close?.().catch(()=>{});
    await mcp?.close?.().catch(()=>{});
    restore();
    throw error;
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  loadPrivateEnv('.env.local');
  if(!process.env.AGENTSCAPE_LLM_API_KEY && process.env.AGENTSCAPE_TEST_LLM_API_KEY)
    process.env.AGENTSCAPE_LLM_API_KEY=process.env.AGENTSCAPE_TEST_LLM_API_KEY;
  const stack=await startLocalAgentStack();
  console.log('AgentScape local stack: MCP 127.0.0.1:39015, Agent Host 127.0.0.1:8789');
  for(const name of ['SIGINT','SIGTERM'])
    process.once(name,()=>stack.close().then(()=>process.exit(0)));
}
