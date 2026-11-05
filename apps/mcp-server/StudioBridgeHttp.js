const DEFAULT_ORIGINS=[
  'http://127.0.0.1:5173','http://localhost:5173',
  'http://127.0.0.1:4178','http://localhost:4178',
  'http://127.0.0.1:4189','http://localhost:4189'
];
const send=(res,status,data,origin)=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',...(origin?{'access-control-allow-origin':origin,'vary':'Origin'}:{})});
  res.end(JSON.stringify(data));
};
const body=async(req)=>{
  const chunks=[];let total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>1024*1024)throw Object.assign(new Error('BRIDGE_BODY_LIMIT'),{status:413});
    chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{throw Object.assign(new Error('BRIDGE_INVALID_JSON'),{status:400});}
};
const fail=(code,status=400)=>Object.assign(new Error(code),{status});
export async function handleStudioBridgeHttp(req,res,bridge,{origins=DEFAULT_ORIGINS}={}) {
  const endpoint=req.url?.split('?')[0] || '';
  if(!endpoint.startsWith('/studio-bridge/'))return false;
  const host=String(req.headers.host||'').split(':')[0];
  const origin=req.headers.origin;
  if(!['127.0.0.1','localhost'].includes(host))return send(res,403,{code:'BRIDGE_HOST_FORBIDDEN'}),true;
  if(!origin || !origins.includes(origin))return send(res,403,{code:'BRIDGE_ORIGIN_FORBIDDEN'}),true;
  if(req.method==='OPTIONS'){
    res.writeHead(204,{'access-control-allow-origin':origin,'access-control-allow-methods':'POST, OPTIONS',
      'access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'Origin'});
    res.end();return true;
  }
  if(req.method!=='POST')return send(res,405,{code:'METHOD_NOT_ALLOWED'},origin),true;
  try{
    const input=await body(req);
    let data;
    if(endpoint==='/studio-bridge/auto-register'){
      data=bridge.registerAuto(input.instanceId,input.worldId);
    }else if(endpoint==='/studio-bridge/connect'){
      if(typeof input.pairCode!=='string')throw fail('PAIR_CODE_INVALID');
      data=bridge.connect(input.pairCode);
    }else if(endpoint==='/studio-bridge/poll'){
      data=await bridge.poll(input.worldSessionId,input.studioToken);
    }else if(endpoint==='/studio-bridge/reply'){
      data=bridge.reply(input.worldSessionId,input.studioToken,input);
    }else if(endpoint==='/studio-bridge/disconnect'){
      bridge.authorized(input.worldSessionId,input.studioToken);
      bridge.disconnect(input.worldSessionId);
      data={status:'disconnected'};
    }else return send(res,404,{code:'BRIDGE_ROUTE_NOT_FOUND'},origin),true;
    send(res,200,data,origin);
  }catch(error){
    const code=/^[A-Z_]+$/.test(error.code||error.message||'') ? error.code||error.message : 'BRIDGE_REQUEST_FAILED';
    send(res,error.status||400,{code},origin);
  }
  return true;
}
