import { describe, expect, it, vi } from 'vitest';
import { BuildSession } from '../../apps/studio/build/BuildSession.js';

describe('BuildSession',()=>{
  it('keeps Build workflow state local to the Studio projection',()=>{
    const onChange=vi.fn();
    const session=new BuildSession({mode:'asset',onChange});
    session.begin('wooden chair');
    expect(session.snapshot()).toMatchObject({mode:'asset',status:'running',prompt:'wooden chair'});
    expect(session.snapshot().steps.map((step)=>step.status)).toEqual(['completed','running','pending','pending']);

    session.stage(2,'compile');
    expect(session.snapshot().steps.map((step)=>step.status)).toEqual(['completed','completed','running','pending']);

    session.complete({kind:'asset',assetId:'chair_01'});
    expect(session.snapshot()).toMatchObject({status:'success',result:{kind:'asset',assetId:'chair_01'}});
    expect(session.snapshot().steps.every((step)=>step.status==='completed')).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  it('switches modes without leaking the previous result',()=>{
    const session=new BuildSession({mode:'image'});
    session.begin('chair reference');
    session.complete({kind:'image',artifactId:'image_01'});
    session.setMode('world');
    expect(session.snapshot()).toMatchObject({mode:'world',status:'idle',result:null,error:null});
    expect(session.snapshot().steps).toHaveLength(4);
  });
});
