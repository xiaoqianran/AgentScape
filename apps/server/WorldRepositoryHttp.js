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
const parseQuery=(url,allowed,defaults)=>{
  if([...url.searchParams.keys()].some(key=>!allowed.includes(key)))throw fail('WORLD_REPOSITORY_QUERY_INVALID');
  const query={...defaults};
  for(const key of allowed){
    if(!url.searchParams.has(key))continue;
    const value=url.searchParams.get(key);
    if(key==='kind'){query[key]=value;continue;}
    if(!/^(0|[1-9][0-9]*)$/.test(value||''))
      throw fail('WORLD_REPOSITORY_QUERY_INVALID');
    query[key]=Number(value);
  }
  return query;
};
const strictBody=(input,keys)=>{
  if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(key=>!keys.includes(key))||keys.some(key=>!Object.hasOwn(input,key)))
    throw fail('WORLD_REPOSITORY_REQUEST_INVALID');
  return input;
};
export async function handleWorldRepositoryHttp(req,res,repository,{publishToken}={}) {
  const url=new URL(req.url||'/', 'http://repository.invalid');
  const prefix='/api/studio/worlds';
  if(url.pathname!==prefix&&!url.pathname.startsWith(prefix+'/'))return false;
  try{
    const suffix=url.pathname.slice(prefix.length);
    const parts=suffix? suffix.slice(1).split('/').map(decodeURIComponent):[];
    let route='unknown',id=null,version=null;
    if(parts.length===0)route='index';
    else if(parts.length===1){route='entry';id=parts[0];}
    else if(parts.length===2&&parts[1]==='versions'){route='versions';id=parts[0];}
    else if(parts.length===3&&parts[1]==='versions'){
      route='version';id=parts[0];
      if(!/^[1-9][0-9]*$/.test(parts[2]))throw fail('WORLD_REPOSITORY_VERSION_INVALID');
      version=Number(parts[2]);
    }else if(parts.length===2&&parts[1]==='rollback'){route='rollback';id=parts[0];}
    else throw fail('WORLD_REPOSITORY_ROUTE_NOT_FOUND',404);
    if(id!==null)repository.validateId(id);
    if(req.method==='GET') {
      if(route==='index')
        return send(res,200,await repository.list(parseQuery(url,['offset','limit','kind'],
          {offset:0,limit:30}))),true;
      if(route==='versions')
        return send(res,200,await repository.listVersions(id,parseQuery(url,['offset','limit'],
          {offset:0,limit:20}))),true;
      if(url.search)throw fail('WORLD_REPOSITORY_QUERY_INVALID');
      if(route==='entry')return send(res,200,await repository.load(id)),true;
      if(route==='version')return send(res,200,await repository.load(id,{version})),true;
      throw fail('WORLD_REPOSITORY_METHOD_NOT_ALLOWED',405);
    }
    if(!((req.method==='PUT'&&route==='entry')||(req.method==='POST'&&route==='rollback')))
      throw fail('WORLD_REPOSITORY_METHOD_NOT_ALLOWED',405);
    if(url.search)throw fail('WORLD_REPOSITORY_QUERY_INVALID');
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
    const maxBytes=route==='rollback'?4096:LIMIT;
    for await(const chunk of req){
      count+=chunk.length;
      if(count>maxBytes)throw fail('WORLD_REPOSITORY_SIZE_LIMIT',413);
      chunks.push(chunk);
    }
    let input;
    try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}
    catch{throw fail('WORLD_REPOSITORY_INVALID_JSON');}
    if(route==='entry'){
      const body=strictBody(input,['kind','baseVersion','content']);
      return send(res,200,await repository.publish({id,...body})),true;
    }
    const body=strictBody(input,['targetVersion','baseVersion']);
    return send(res,200,await repository.rollback({id,...body})),true;
  }catch(error){
    const code=/^[A-Z_]+$/.test(error.code||'') ? error.code:'WORLD_REPOSITORY_REQUEST_FAILED';
    return send(res,error.status||400,{code}),true;
  }
}
