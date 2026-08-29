import { describe, expect, it } from 'vitest';
import { WorldValidator } from '../../world/verification/WorldValidator.js';

function runtime({ below = false, collision = false } = {}) {
  const bounds = (id) => ({ id, min:[0, below && id === 'a' ? -0.2 : 0, 0], max:[1,1,1], center:[.5,.5,.5], size:[1,1,1] });
  return {
    listObjects: () => [{ id: 'a' }, { id: 'b' }],
    spatial: {
      snapshot: () => new Map([['a',{ bounds:bounds('a') }], ['b',{ bounds:bounds('b') }]]),
      collisionPairs: () => collision ? [['a','b']] : []
    },
    sceneGraph: { update: () => [], list: () => [] },
    interactions: { isHeld:()=>false }
  };
}

describe('WorldValidator', () => {
  it('reports below-ground and overlap findings as hard failures', () => {
    const report = new WorldValidator(runtime({ below: true, collision: true })).run();
    expect(report.ok).toBe(false);
    expect(report.hard.map((x) => x.code)).toEqual(expect.arrayContaining(['G_BELOW_GROUND', 'P_OVERLAP']));
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({schema:'agentscape.finding',code:'G_BELOW_GROUND',repair:{eligible:true,strategy:'lift_to_ground'}})]));
  });


  it('binds candidate findings to an explicit revision without changing committed Runtime authority', () => {
    const r=runtime({below:true});
    r.currentWorldRevision={revision:{id:'rev-old'},provenance:{source:'existing'}};
    const report=new WorldValidator(r).run({worldRevisionId:'rev-candidate'});
    expect(report.findings.find((finding)=>finding.code==='G_BELOW_GROUND')).toMatchObject({worldRevisionId:'rev-candidate'});
    expect(r.currentWorldRevision.revision.id).toBe('rev-old');
  });

  it('returns stable count/coverage structure', () => {
    const report = new WorldValidator(runtime()).run();
    expect(report.counts).toHaveProperty('hard');
    expect(report.coverage.objects).toBe(2);
  });

  it('treats only the active Agent-to-held-object overlap as an expected carry configuration', () => {
    const r=runtime({collision:true});
    r.interactions.heldByAgent=(id)=>id==='a' ? 'b' : null;
    const report=new WorldValidator(r).run();
    expect(report.hard.some((item)=>item.code==='P_OVERLAP')).toBe(false);

    r.interactions.heldByAgent=()=>null;
    const ordinaryOverlap=new WorldValidator(r).run();
    expect(ordinaryOverlap.hard).toEqual(expect.arrayContaining([expect.objectContaining({code:'P_OVERLAP',object:'a',other:'b'})]));
  });

  it('uses physical penetration evidence to distinguish legal containment from a container-wall collision', () => {
    const r=runtime({collision:true});
    r.sceneGraph.list=()=>[{subject:'a',predicate:'INSIDE',object:'b'}];
    r.store={has:()=>true,get:(id)=>({id,manifest:{physics:{colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}}})};
    r.physics={getPosition:()=>[0,0,0],manifestPoseClear:()=>({checked:true,clear:true,blockedBy:[]})};
    expect(new WorldValidator(r).run().hard.some((item)=>item.code==='P_OVERLAP')).toBe(false);

    r.physics.manifestPoseClear=()=>({checked:true,clear:false,blockedBy:['object:b:$root']});
    expect(new WorldValidator(r).run().hard).toEqual(expect.arrayContaining([expect.objectContaining({code:'P_OVERLAP',object:'a',other:'b'})]));
  });

  it('does not report an Agent-held floating object as unsupported', () => {
    const r=runtime();
    r.spatial.snapshot=()=>new Map([
      ['a',{bounds:{id:'a',min:[0,.9,0],max:[.3,1.2,.3],center:[.15,1.05,.15],size:[.3,.3,.3]}}],
      ['b',{bounds:{id:'b',min:[2,0,0],max:[3,1,1],center:[2.5,.5,.5],size:[1,1,1]}}]
    ]);
    r.interactions.isHeld=(id)=>id==='a';
    const report=new WorldValidator(r).run();
    expect(report.advisory.some((item)=>item.object==='a'&&item.code==='G_FLOATING')).toBe(false);
  });

});
