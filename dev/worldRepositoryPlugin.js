import path from 'node:path';
import { WorldRepository } from '../apps/server/WorldRepository.js';
import { handleWorldRepositoryHttp } from '../apps/server/WorldRepositoryHttp.js';

/** Raw unpublished CAS blocks and pointer files must never bypass the
 * WorldRepository HTTP API through Vite's static file middleware.
 */
export function isRepositoryDataPath(requestUrl,directory,{root=process.cwd()}={}) {
  if(typeof requestUrl!=='string')return false;
  let pathname;
  try{
    pathname=new URL(requestUrl,'http://local.invalid').pathname;
    for(let i=0;i<3;i++){
      const decoded=decodeURIComponent(pathname);
      if(decoded===pathname)break;
      pathname=decoded;
    }
  }catch{return true;} // An invalid encoded path is not a valid static request.
  const absolute=path.resolve(directory);
  const prefixes=[];
  const addRelative=(base)=>{
    const relative=path.relative(base,absolute).split(path.sep).join('/');
    if(relative&&!relative.startsWith('../')&&relative!=='..'&&!path.isAbsolute(relative))
      prefixes.push('/'+relative);
  };
  addRelative(root);
  addRelative(path.join(root,'public'));
  prefixes.push('/@fs/'+absolute.split(path.sep).join('/'));
  // Vite decodes /@fs/ paths; normalize encoded separators and dot segments
  // before comparing. Windows filesystem paths are case-insensitive.
  const normalize=value=>{
    const normalized=path.posix.normalize(value.replaceAll('\\','/'));
    return process.platform==='win32'?normalized.toLowerCase():normalized;
  };
  const candidate=normalize(pathname);
  return prefixes.some(prefix=>{
    const protectedPath=normalize(prefix);
    return candidate===protectedPath||candidate.startsWith(protectedPath+'/');
  });
}

/** Same-origin API mounted in both Vite dev and preview. A static production host
 * must supply an equivalent server endpoint; otherwise the client reports offline.
 * Public reads, token-protected explicit publishes. No anonymous writes.
 */
export function worldRepositoryPlugin(env={}) {
  const directory=env.AGENTSCAPE_WORLD_REPOSITORY_DIR || path.resolve('.studio-world-repository');
  const publishToken=env.AGENTSCAPE_WORLD_REPOSITORY_TOKEN||'';
  const repository=new WorldRepository({directory});
  const configure=server=>{
    const initialize=repository.initialize();
    server.middlewares.use((req,res,next)=>{
      if(!isRepositoryDataPath(req.url,directory))return next();
      res.writeHead(404,{'cache-control':'no-store','x-content-type-options':'nosniff'});
      res.end();
    });
    server.middlewares.use(async(req,res,next)=>{
      const pathname=(req.url||'').split('?',1)[0];
      if(pathname!=='/api/studio/worlds'&&!pathname.startsWith('/api/studio/worlds/'))return next();
      try{await initialize;await handleWorldRepositoryHttp(req,res,repository,{publishToken});}
      catch(error){
        if(res.headersSent)return;
        res.writeHead(500,{'content-type':'application/json'}).end(JSON.stringify({code:'WORLD_REPOSITORY_UNAVAILABLE'}));
      }
    });
  };
  return {name:'agentscape-world-repository',configureServer:configure,configurePreviewServer:configure};
}
