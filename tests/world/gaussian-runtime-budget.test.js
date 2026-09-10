import { describe, expect, it } from 'vitest';
import { budgetGaussianData, DEFAULT_RUNTIME_SPLAT_BUDGET } from '../../modules/rendering/loadGaussianSplatVisual.js';

const sequence=(Ctor,length)=>Ctor.from({length},(_,index)=>index);

describe('Gaussian runtime budget',()=>{
  it('uses the three-gsmesh four-float position stride when counting splats',()=>{
    const data={
      position:sequence(Float32Array,16),
      color:sequence(Float32Array,16),
      covariance:sequence(Float32Array,32),
      extra:{}
    };
    const result=budgetGaussianData(data,10);
    expect(result).toMatchObject({sourceSplatCount:4,splatCount:4,sampled:false});
    expect(result.data).toBe(data);
  });

  it('deterministically samples oversized runtime data without mutating the source artifact data',()=>{
    const data={
      position:sequence(Float32Array,16),
      color:sequence(Float32Array,16),
      covariance:sequence(Float32Array,32),
      extra:{sh1:sequence(Uint32Array,8),sh2:sequence(Uint32Array,16),sh3:sequence(Uint32Array,16)}
    };
    const result=budgetGaussianData(data,2);
    expect(result).toMatchObject({sourceSplatCount:4,splatCount:2,sampled:true});
    expect(Array.from(result.data.position)).toEqual([0,1,2,3,8,9,10,11]);
    expect(result.data.color).toHaveLength(8);
    expect(result.data.covariance).toHaveLength(16);
    expect(result.data.extra.sh1).toHaveLength(4);
    expect(result.data.extra.sh2).toHaveLength(8);
    expect(result.data.extra.sh3).toHaveLength(8);
    expect(data.position).toHaveLength(16);
  });

  it('keeps a bounded default suitable for the current WebGPU GSMesh runtime',()=>{
    expect(DEFAULT_RUNTIME_SPLAT_BUDGET).toBe(500_000);
  });
});
