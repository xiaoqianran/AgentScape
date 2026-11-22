import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {isRepositoryDataPath} from '../../dev/worldRepositoryPlugin.js';

const root=path.resolve('/workspace/agentscape');
const directory=path.join(root,'.studio-world-repository');
describe('Vite private repository static-file boundary',()=>{
  it('blocks direct pointers, unpublished blocks and encoded /@fs routes, without blocking the public API',()=>{
    const check=url=>isRepositoryDataPath(url,directory,{root});
    for(const request of [
      '/.studio-world-repository',
      '/.studio-world-repository/records/test.json',
      '/.studio-world-repository/history/world/1.json',
      '/.studio-world-repository/blocks/0123',
      '/%2Estudio-world-repository/records/test.json',
      '/%252Estudio-world-repository/history/world/2.json',
      '/@fs//workspace/agentscape/.studio-world-repository/blocks/hash',
      '/.studio-world-repository/records/test.json?cache=0'
    ])expect(check(request),request).toBe(true);
    for(const request of ['/api/studio/worlds','/api/studio/worlds/id/versions',
      '/studio/','/studio/index.html','/public/logo.png','/.studio-world-repository-safe/asset.json'
    ])expect(check(request),request).toBe(false);
  });
  it('recognizes public-folder mappings for configurable repository storage',()=>{
    const hidden=path.join(root,'public','private-world-data');
    expect(isRepositoryDataPath('/private-world-data/blocks/hash',hidden,{root})).toBe(true);
    expect(isRepositoryDataPath('/public/private-world-data/blocks/hash',hidden,{root})).toBe(true);
  });
});
