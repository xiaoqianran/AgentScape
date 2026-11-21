import { McpClient, StreamableHttpTransport, toLlmContent } from '@earendil-works/pi-mcp';
import { AGENT_STUDIO_MCP_TOOLS } from '../../application/agent/StudioMcpAllowlist.js';

// Deliberately expose only audited Studio tools, never Shell or arbitrary authoring.
export const STUDIO_TOOL_NAMES = AGENT_STUDIO_MCP_TOOLS.filter(name => !['session_attach','studio_session_status'].includes(name));
const WORLD_TOOLS = new Set(['scene_observe','scene_verify','scene_add_model','scene_apply','scene_interact','scene_job','scene_cancel','studio_project']);


export function changesWorld(name, args = {}) {
  if (name === 'studio_project') return !['read','file_read','capture','save','preview_batch','discard_batch'].includes(args.operation);
  if (name === 'scene_add_model') return (args.mode || 'add') === 'add';
  return ['scene_apply','scene_interact','scene_cancel'].includes(name);
}

export async function connectStudioMcp({url='http://127.0.0.1:39015/agent-mcp',token,signal,projectScope}={}) {
  if (!token || token.length < 32) throw Object.assign(new Error('AGENTSCAPE_MCP_TOKEN_REQUIRED'),{code:'AGENTSCAPE_MCP_TOKEN_REQUIRED'});
  const address=new URL(url);
  if (address.protocol!=='http:' || !['127.0.0.1','localhost'].includes(address.hostname) || address.pathname!=='/agent-mcp')
    throw new Error('AGENTSCAPE_MCP_LOCAL_ONLY');
  const client=new McpClient({name:'agentscape-agent-host',version:'0.1.0'});
  await client.connect(new StreamableHttpTransport({url:address.toString(),headers:{authorization:'Bearer '+token,
    ...(projectScope?{'x-agentscape-project':projectScope}:{})}}));
  try {
    const session=await client.callTool('session_attach',{}, {signal});
    if (session.isError) throw new Error('STUDIO_NOT_CONNECTED');
    const state=JSON.parse(session.content.find(item=>item.type==='text')?.text||'{}');
    if (!state.connected || !state.worldSessionId) throw new Error('STUDIO_NOT_CONNECTED');
    const declared=await client.listTools();
    const allowed=declared.filter(item=>STUDIO_TOOL_NAMES.includes(item.name));
    const mutations=[];
    const requestIds=new Map();
    const tools=allowed.map(item=>{
      const properties={...item.inputSchema.properties};
      const bindWorld=WORLD_TOOLS.has(item.name) && 'worldSessionId' in properties;
      const bindRequest='requestId' in properties;
      if(bindWorld)delete properties.worldSessionId;
      if(bindRequest)delete properties.requestId;
      return {
        name:item.name,
        label:item.title || item.name,
        description:item.description || item.name,
        parameters:{...item.inputSchema,type:'object',properties,
          required:(item.inputSchema.required || []).filter(key=>Object.hasOwn(properties,key))},
        executionMode:'sequential',
        execute:async(callId,params,toolSignal)=>{
          const inputs={...params};
          if(bindWorld)inputs.worldSessionId=state.worldSessionId;
          if(bindRequest){
            if(!requestIds.has(callId))requestIds.set(callId,crypto.randomUUID());
            inputs.requestId=requestIds.get(callId);
          }
          const result=await client.callTool(item.name,inputs,{signal:toolSignal});
          if(result.isError)throw new Error(toLlmContent(result).filter(x=>x.type==='text').map(x=>x.text).join(' ').slice(0,500));
          const content=toLlmContent(result);
          const payload=JSON.parse(content.find(block=>block.type==='text').text);
          if (['failed','rejected','interrupted'].includes(payload?.status) || payload?.state==='failed') {
            throw new Error(JSON.stringify({code:payload.error || payload.code || 'TOOL_FAILED',
              diagnostics:payload.diagnostics}).slice(0,500));
          }
          if(changesWorld(item.name,inputs))mutations.push({tool:item.name,requestId:inputs.requestId||null});
          return {content,details:{tool:item.name,worldSessionId:state.worldSessionId}};
        }
      };
    });
    return {client,tools,mutations,worldSessionId:state.worldSessionId,close:()=>client.close()};
  } catch(error) {await client.close();throw error;}
}
