import { timingSafeEqual } from 'node:crypto';

const LIMIT=25*1024*1024;
const fail=(code,status=400)=>Object.assign(new Error(code),{code,status});
const send=(res,status,value)=>{
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(JSON.stringify(value));
};
const safeCompare=(supplied,expected)=>{
  const a=Buffer.from(supplied||''),b=Buffer.from(expected||'');
  return a.length===b.length&&a.length>0&&timingSafeEqual(a,b);
};
export async function handleWorldRepositoryHttp(req,res,repository,{publishToken}={}) {
  const url=new URL(req.url||'/', 'http://repository.invalid');
  if(url.pathname!=='/api/studio/worlds'&&!url.pathname.startsWith('/api/studio/worlds/'))return false;
  try{
    if(req.method==='GET') {
      if(url.pathname==='/api/studio/worlds'){
        if([...url.searchParams.keys()].some(key=>!['offset','limit','kind'].includes(key)))throw fail('WORLD_REPOSITORY_QUERY_INVALID');
        const query={offset:Number(url.searchParams.get('offset')||0),limit:Number(url.searchParams.get('limit')||30),
          ...(url.searchParams.has('kind')?{kind:url.searchParams.get('kind')}:{})};
        return send(res,200,await repository.list(query)),true;
      }
      const id=decodeURIComponent(url.pathname.slice('/api/studio/worlds/'.length));
      return send(res,200,await repository.load(id)),true;
    }
    if(req.method!=='PUT')throw fail('WORLD_REPOSITORY_METHOD_NOT_ALLOWED',405);
    if(url.pathname==='/api/studio/worlds')throw fail('WORLD_REPOSITORY_ID_REQUIRED');
    if(!publishToken||publishToken.length<20)throw fail('WORLD_REPOSITORY_READ_ONLY',503);
    const origin=req.headers.origin;
    if(origin){
      let originHost;
      try{originHost=new URL(origin).host;}catch{throw fail('WORLD_REPOSITORY_ORIGIN_FORBIDDEN',403);}
      if(originHost!==req.headers.host)throw fail('WORLD_REPOSITORY_ORIGIN_FORBIDDEN',403);
    }
    const authorization=String(req.headers.authorization||'');
    if(!authorization.startsWith('Bearer ')||!safeCompare(authorization.slice(7),publishToken))
      throw fail('WORLD_REPOSITORY_AUTH_REQUIRED',401);
    const chunks=[];let count=0;
    for await(const chunk of req){
      count+=chunk.length;
      if(count>LIMIT)throw fail('WORLD_REPOSITORY_SIZE_LIMIT',413);
      chunks.push(chunk);
    }
    let input;
    try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch{throw fail('WORLD_REPOSITORY_INVALID_JSON');}
    if(!input||Object.keys(input).some(key=>!['kind','baseVersion','content'].includes(key))||
      !Object.hasOwn(input,'baseVersion'))throw fail('WORLD_REPOSITORY_REQUEST_INVALID');
    const id=decodeURIComponent(url.pathname.slice('/api/studio/worlds/'.length));
    const record=await repository.publish({id,...input});
    return send(res,200,record),true;
  }catch(error){
    const code=/^[A-Z_]+$/.test(error.code||'') ? error.code:'WORLD_REPOSITORY_REQUEST_FAILED';
    return send(res,error.status||400,{code}),true;
  }
}
