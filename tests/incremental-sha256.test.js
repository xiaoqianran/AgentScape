import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { IncrementalSha256, sha256ArtifactHash } from '../src/artifacts/IncrementalSha256.js';

const nodeHex=(bytes)=>createHash('sha256').update(bytes).digest('hex');

describe('IncrementalSha256',()=>{
  it('matches standard SHA-256 known vectors',()=>{
    const encoder=new TextEncoder();
    const vectors=[
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc','ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      ['The quick brown fox jumps over the lazy dog','d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592']
    ];
    for (const [text,expected] of vectors) {
      const hash=new IncrementalSha256();
      hash.update(encoder.encode(text));
      expect(hash.digestHex()).toBe(expected);
      expect(hash.digestArtifactHash()).toBe(`sha256:${expected}`);
    }
  });

  it('matches Node crypto across irregular chunk boundaries',()=>{
    const bytes=new Uint8Array(8193);
    for (let i=0;i<bytes.length;i++) bytes[i]=(i*31+i>>>3)&0xff;
    const hash=new IncrementalSha256();
    const sizes=[1,7,63,64,65,511,1024,3,2048,4096,9999];
    let offset=0,index=0;
    while (offset<bytes.length) {
      const size=sizes[index++%sizes.length];
      const end=Math.min(bytes.length,offset+size);
      hash.update(bytes.subarray(offset,end));
      offset=end;
    }
    expect(hash.digestHex()).toBe(nodeHex(bytes));
  });

  it('supports ArrayBuffer views and refuses updates after finalization',()=>{
    const bytes=new Uint8Array([1,2,3,4,5,6]);
    const hash=new IncrementalSha256();
    hash.update(new Uint16Array(bytes.buffer,0,2));
    const expected=nodeHex(bytes.subarray(0,4));
    expect(hash.digestHex()).toBe(expected);
    expect(()=>hash.update(new Uint8Array([7]))).toThrow(/finalized/);
  });

  it('provides a convenience artifact-hash helper over chunk iterables',()=>{
    const chunks=[new Uint8Array([1,2]),new Uint8Array([3]),new Uint8Array([4,5])];
    const bytes=new Uint8Array([1,2,3,4,5]);
    expect(sha256ArtifactHash(chunks)).toBe(`sha256:${nodeHex(bytes)}`);
  });
});
