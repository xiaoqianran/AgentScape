import { describe, expect, it } from 'vitest';
import { SegmentationEvidencePass } from '../asset/compiler/passes/SegmentationEvidencePass.js';

describe('SegmentationEvidencePass', () => {
  it('keeps compact face-level evidence without pretending it is a node part', async () => {
    const result=await new SegmentationEvidencePass().run({partSegmentation:{
      version:1,source:'p3sam/external',faceCount:100,
      segments:[{id:0,faceCount:60,confidence:.9,semantic:'door'},{id:1,faceCount:30}],
      artifact:{kind:'face-labels',url:'https://example.test/labels.npy'}
    }});
    expect(result.partSegmentation.coverage).toBe(.9);
    expect(result.partSegmentation.segments).toHaveLength(2);
    expect(result.partSegmentation.issues).toEqual([]);
  });

  it('flags impossible face coverage', async () => {
    const result=await new SegmentationEvidencePass().run({partSegmentation:{version:1,source:'x',faceCount:10,segments:[{id:'a',faceCount:11}]}});
    expect(result.partSegmentation.issues.some((x)=>x.code==='SEGMENTATION_COVERAGE_INVALID')).toBe(true);
  });
});
