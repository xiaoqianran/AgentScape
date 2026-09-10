import { describe, expect, it } from 'vitest';
import { collectResourceLibrary } from '../../apps/studio/ui/resources/ResourceLibrary.js';

const artifacts = [
  {
    id:'image_01', role:'primary-image', displayName:'Reference Image', mime:'image/png', format:'png', bytes:1024,
    integrity:{state:'verified'}, producer:{provider:'modal-2d',jobId:'job_image'}
  },
  {
    id:'world_manifest_01', role:'world-manifest', displayName:'Generated World', mime:'application/json', format:'json', bytes:512,
    integrity:{state:'verified'}, producer:{provider:'modal-world',jobId:'job_world'}
  },
  {
    id:'glb_01', role:'primary-glb', displayName:'Raw GLB', mime:'model/gltf-binary', format:'glb', bytes:2048,
    integrity:{state:'verified'}, producer:{provider:'modal-3d',jobId:'job_glb'}
  }
];

describe('collectResourceLibrary', () => {
  it('keeps Images, executable Assets, and Worlds as separate projections', () => {
    const result=collectResourceLibrary({
      assetCatalog:{list:()=>[
        {id:'chair',label:'Chair',type:'chair',source:'builtin',actions:['move'],tags:['seat']},
        {id:'generated_chair',label:'Generated Chair',type:'object',source:'compiled',actions:['move'],tags:[]}
      ]},
      approvedAssets:[{assetId:'generated_chair',status:'approved'}],
      artifactRegistry:{list:()=>artifacts},
      environments:[
        {id:'world-a',title:'World A',number:'01',description:'A'},
        {id:'world-b',title:'World B',number:'02',description:'B'}
      ],
      currentEnvironmentId:'world-b'
    });

    expect(result.assets.map((item)=>item.id)).toEqual(['chair','generated_chair']);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({id:'image_01',provider:'modal-2d',integrity:'verified'});
    expect(result.worlds).toHaveLength(3);
    expect(result.worlds.find((item)=>item.id==='world-b')).toMatchObject({source:'builtin',current:true});
    expect(result.worlds.find((item)=>item.id==='world_manifest_01')).toMatchObject({source:'generated',provider:'modal-world',integrity:'verified'});
    expect(result.images.some((item)=>item.id==='glb_01')).toBe(false);
    expect(result.worlds.some((item)=>item.id==='glb_01')).toBe(false);
  });

  it('keeps unapproved compiled outputs out of the persistent Asset Library projection',()=>{
    const result=collectResourceLibrary({
      assetCatalog:{list:()=>[
        {id:'chair',label:'Chair',type:'chair',source:'builtin',actions:['move'],tags:[]},
        {id:'draft_asset',label:'Draft Asset',type:'object',source:'compiled',actions:['move'],tags:[]}
      ]},
      artifactRegistry:{list:()=>[]},
      approvedAssets:[]
    });
    expect(result.assets.map((item)=>item.id)).toEqual(['chair']);
  });
});
