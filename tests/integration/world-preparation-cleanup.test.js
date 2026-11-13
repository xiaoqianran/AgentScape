import { it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { createSession } from '../../application/createSession.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { writeWorldDocument, EnvironmentPlugins } from '../../application/scene/WorldDocument.js';
import { prepareWorld } from '../../application/scene/WorldIO.js';

const createStorage = () => {
  const blocks = new Map();
  return new WorldStorage({
    async read(hash,size) {
      const bytes=blocks.get(hash);
      if (!bytes || bytes.byteLength!==size) throw new Error('MISSING_BLOCK');
      return bytes.slice();
    },
    async write(hash,bytes) {if (!blocks.has(hash)) blocks.set(hash,bytes.slice());}
  });
};
async function document() {
  const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'prepare-cleanup-world'})});
  await session.world.init();
  const storage=createStorage();
  try {return {storage,root:await writeWorldDocument(session.world,storage)};}
  finally {session.scene.close();session.world.dispose();}
}

it('releases the prepared asset loader when environment construction fails before commit',async()=>{
  const {storage,root}=await document();
  const dispose=vi.fn();
  const plugins=new EnvironmentPlugins().register('prepare-cleanup-world',{
    create:async()=>{throw new Error('INJECTED_ENVIRONMENT_FAILURE');}
  });
  await expect(prepareWorld(storage,root,{plugins,gltfLoader:{loadScene:async()=>new THREE.Group(),dispose}}))
    .rejects.toThrow('INJECTED_ENVIRONMENT_FAILURE');
  expect(dispose).toHaveBeenCalledTimes(1);
});

it('releases both environment and loader exactly once on plugin mismatch',async()=>{
  const {storage,root}=await document();
  const releaseEnv=vi.fn(),releaseLoader=vi.fn();
  const plugins=new EnvironmentPlugins().register('prepare-cleanup-world',{
    create:async()=>({id:'unexpected-world',root:new THREE.Group(),colliders:[],dispose:releaseEnv})
  });
  await expect(prepareWorld(storage,root,{plugins,gltfLoader:{loadScene:async()=>new THREE.Group(),dispose:releaseLoader}}))
    .rejects.toMatchObject({code:'WORLD_PLUGIN_ID_MISMATCH'});
  expect(releaseEnv).toHaveBeenCalledTimes(1);
  expect(releaseLoader).toHaveBeenCalledTimes(1);
});
