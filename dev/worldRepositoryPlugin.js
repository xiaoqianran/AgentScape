import path from 'node:path';
import { WorldRepository } from '../apps/server/WorldRepository.js';
import { handleWorldRepositoryHttp } from '../apps/server/WorldRepositoryHttp.js';

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
