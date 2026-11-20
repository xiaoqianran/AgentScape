import * as z from 'zod/v4';
import {registerTools} from './registerTools.js';

// Compatibility facade for 2025 MCP SDK clients such as DSH. This route
// does not own the world: all tools delegate to the existing audited handlers.
// Authorization, rate limiting and body caps are performed by main.mjs first.
function response(id,result,status=200) {
  return {status,body:{jsonrpc:'2.0',id,result}};
}
function error(id,code,message,status=400) {
  return {status,body:{jsonrpc:'2.0',id,error:{code,message}}};
}
export async function handleRestrictedAgentMcp({body,owner,manager,assets,studioBridge,signal}={}) {
  if(!body || body.jsonrpc!=='2.0' || typeof body.method!=='string')
    return error(null,-32700,'Invalid JSON-RPC message');
  const {id=null,method,params={}}=body;
  // Explicitly refuse the 2026 discovery proposal so clients negotiate
  // standard 2025-06-18 Streamable HTTP. No unaudited modern extensions.
  if(method==='server/discover')
    return error(id,-32601,'Method not found',404);
  if(method==='initialize')
    return response(id,{
      protocolVersion:'2025-06-18',
      capabilities:{tools:{listChanged:false}},
      serverInfo:{name:'AgentScape Restricted MCP',version:'0.1.0'}
    });
  if(method==='notifications/initialized')return {status:202,body:null};
  if(method==='ping')return response(id,{});
  if(method!=='tools/list' && method!=='tools/call')
    return error(id,-32601,'Method not found',404);
  const definitions=new Map();
  registerTools({registerTool(name,options,handler){
    definitions.set(name,{options,handler});
  }},manager,owner,assets,studioBridge,{agentOnly:true});
  if(method==='tools/list'){
    if(params?.cursor!=null)return error(id,-32602,'Unknown cursor');
    return response(id,{tools:[...definitions].map(([name,{options}])=>({
      name,description:options.description,
      inputSchema:z.toJSONSchema(options.inputSchema,{target:'draft-7'})
    }))});
  }
  const name=params?.name,entry=definitions.get(name);
  if(!entry)return error(id,-32602,'Tool not available');
  try{
    const parsed=entry.options.inputSchema.safeParse(params.arguments || {});
    if(!parsed.success){
      const diagnostics=parsed.error.issues.flatMap(issue=>{
        const fields=issue.code==='invalid_union' ? issue.errors?.[0] : null;
        return fields?.length ? fields.map(field=>({path:[...issue.path,...field.path].join('.'),code:field.code}))
          : [{path:issue.path.join('.'),code:issue.code}];
      }).slice(0,12);
      return response(id,{isError:true,content:[{type:'text',text:JSON.stringify({code:'INVALID_TOOL_INPUT',diagnostics})}]});
    }
    const args=parsed.data;
    const result=await entry.handler(args,{signal});
    return response(id,result);
  }catch(cause){
    return response(id,{isError:true,content:[{
      type:'text',text:JSON.stringify({code:'TOOL_EXECUTION_FAILED'})
    }]});
  }
}
