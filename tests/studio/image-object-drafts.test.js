import { describe, expect, it, vi } from 'vitest';
import {
  MAX_IMAGE_BYTES,
  findForegroundRegions,
  openImageDraftStore,
  restoredDraft,
  runImageObjectQueue,
  validateImageFile
} from '../../apps/studio/build/ImageObjectDrafts.js';

function rgba(width,height) {
  return new Uint8ClampedArray(width*height*4);
}

function paint(data,width,x,y,w,h,{r=255,g=255,b=255,a=255}={}) {
  for(let py=y;py<y+h;py+=1) for(let px=x;px<x+w;px+=1) {
    const i=(py*width+px)*4;
    data[i]=r; data[i+1]=g; data[i+2]=b; data[i+3]=a;
  }
}

describe('ImageObjectDrafts',()=>{
  it('accepts supported local image inputs and rejects unsafe size/type boundaries',()=>{
    expect(()=>validateImageFile({type:'image/png',size:1024})).not.toThrow();
    expect(()=>validateImageFile({type:'image/jpeg',size:MAX_IMAGE_BYTES})).not.toThrow();
    expect(()=>validateImageFile({type:'image/gif',size:1024})).toThrow(/PNG、JPEG、WebP/);
    expect(()=>validateImageFile({type:'image/png',size:0})).toThrow(/大于 0/);
    expect(()=>validateImageFile({type:'image/png',size:MAX_IMAGE_BYTES+1})).toThrow(/20 MiB/);
  });

  it('marks only in-flight drafts as interrupted after a browser restart',()=>{
    for(const status of ['uploading','generating','queued']) {
      expect(restoredDraft({id:'d1',status})).toMatchObject({id:'d1',status:'interrupted',error:expect.stringContaining('上次任务中断')});
    }
    const ready={id:'d2',status:'ready'};
    expect(restoredDraft(ready)).toBe(ready);
  });

  it('fails clearly when browser draft persistence is unavailable',async()=>{
    await expect(openImageDraftStore(null)).rejects.toThrow(/IndexedDB 不可用/);
  });

  it('separates disconnected transparent-background foreground regions and sorts by area',()=>{
    const width=8,height=6,data=rgba(width,height);
    paint(data,width,1,1,2,2);
    paint(data,width,5,2,2,3);
    const regions=findForegroundRegions(data,width,height,{minArea:2});
    expect(regions).toHaveLength(2);
    expect(regions.map((region)=>({x:region.x,y:region.y,width:region.width,height:region.height,pixels:region.pixels.length}))).toEqual([
      {x:5,y:2,width:2,height:3,pixels:6},
      {x:1,y:1,width:2,height:2,pixels:4}
    ]);
  });

  it('refuses automatic extraction when opaque corner colors do not describe one background',()=>{
    const width=4,height=4,data=rgba(width,height);
    paint(data,width,0,0,width,height,{r:20,g:20,b:20,a:255});
    paint(data,width,width-1,0,1,1,{r:220,g:20,b:20,a:255});
    expect(()=>findForegroundRegions(data,width,height,{minArea:1,tolerance:16})).toThrow(/背景不够均匀/);
  });

  it('continues the queue after one draft fails and records that failure',async()=>{
    const drafts=[{id:'a'},{id:'b'},{id:'c'}];
    const processed=[];
    const update=vi.fn(async()=>{});
    await runImageObjectQueue({
      drafts,
      process:async(draft)=>{
        processed.push(draft.id);
        if(draft.id==='b') throw new Error('provider failed');
      },
      update
    });
    expect(processed).toEqual(['a','b','c']);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('b',{status:'failed',error:'provider failed'});
  });

  it('stops before submitting the next draft when requested',async()=>{
    const drafts=[{id:'a'},{id:'b'},{id:'c'}];
    const processed=[];
    let stop=false;
    await runImageObjectQueue({
      drafts,
      process:async(draft)=>{ processed.push(draft.id); stop=true; },
      update:vi.fn(async()=>{}),
      shouldStop:()=>stop
    });
    expect(processed).toEqual(['a']);
  });
});
