import { describe, expect, it } from 'vitest';
import { normalizeWorldSpec } from '../src/pipeline/WorldSpec.js';

describe('WorldSpec',()=>{
  it('normalizes provider/generation defaults into deterministic asset requests',()=>{
    const spec=normalizeWorldSpec({
      name:'AI Lab',generation:{provider:'embodiedgen',generate:true},
      assets:[
        {id:'bench_01',type:'workbench',position:[1,0,2]},
        {id:'cup_01',assetId:'cup',generate:false}
      ],
      relations:[{subject:'cup_01',predicate:'on',object:'bench_01',surfaceId:'top'}]
    });
    expect(spec).toEqual({
      schema:1,name:'AI Lab',description:'',generation:{provider:'embodiedgen',generate:true},
      assets:[
        {id:'bench_01',query:'workbench',type:'workbench',position:[1,0,2],generate:true,provider:'embodiedgen'},
        {id:'cup_01',assetId:'cup',query:'cup',position:[0,0,0],generate:false,provider:'embodiedgen'}
      ],
      relations:[{subject:'cup_01',predicate:'ON',object:'bench_01',surfaceId:'top'}]
    });
  });

  it('rejects malformed positions and duplicate instance ids before world mutation',()=>{
    expect(()=>normalizeWorldSpec({assets:[{id:'x',type:'chair',position:[0,NaN,0]}]})).toThrow(/position/);
    expect(()=>normalizeWorldSpec({assets:[{id:'x',type:'chair'},{id:'x',type:'table'}]})).toThrow(/duplicate instance id/);
  });

  it('rejects unsupported relations instead of inventing semantics',()=>{
    expect(()=>normalizeWorldSpec({relations:[{subject:'a',predicate:'BEHIND',object:'b'}]})).toThrow(/unsupported predicate/);
  });
});
