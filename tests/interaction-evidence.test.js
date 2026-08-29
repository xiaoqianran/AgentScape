import { describe, expect, it } from 'vitest';
import {
  clearInteractionEvidenceForTarget,
  getInteractionEvidence,
  recordInteractionEvidence
} from '../world/verification/InteractionEvidence.js';

const runtime=(revisionId='rev-1')=>({currentWorldRevision:{revision:{id:revisionId}},trace:{emit:()=>{}}});

describe('InteractionEvidence',()=>{
  it('records only verified evidence and binds it to the active world revision',()=>{
    const world=runtime();
    expect(recordInteractionEvidence(world,{targetId:'door_01',capability:'OPEN',verified:false})).toBeNull();
    expect(recordInteractionEvidence(world,{targetId:'door_01',capability:'open',verified:true,source:'test',result:{status:'action-completed',targetReached:true,settled:true,secret:'discard-me'}})).toMatchObject({
      schema:'agentscape.interaction-evidence',schemaVersion:1,worldRevisionId:'rev-1',targetId:'door_01',capability:'OPEN',verified:true,source:'test',
      result:{status:'action-completed',targetReached:true,settled:true}
    });
    expect(getInteractionEvidence(world,'door_01','OPEN')).toMatchObject({worldRevisionId:'rev-1',verified:true});
  });

  it('does not reuse evidence across world revisions',()=>{
    const world=runtime('rev-1');
    recordInteractionEvidence(world,{targetId:'door_01',capability:'OPEN',verified:true});
    world.currentWorldRevision={revision:{id:'rev-2'}};
    expect(getInteractionEvidence(world,'door_01','OPEN')).toBeNull();
  });

  it('invalidates target evidence when the target is replaced or removed',()=>{
    const world=runtime();
    recordInteractionEvidence(world,{targetId:'door_01',capability:'OPEN',verified:true});
    recordInteractionEvidence(world,{targetId:'door_02',capability:'OPEN',verified:true});
    clearInteractionEvidenceForTarget(world,'door_01');
    expect(getInteractionEvidence(world,'door_01','OPEN')).toBeNull();
    expect(getInteractionEvidence(world,'door_02','OPEN')).not.toBeNull();
  });
});


it('can query evidence against an explicit candidate revision without changing Runtime authority',()=>{
  const world=runtime('rev-old');
  recordInteractionEvidence(world,{targetId:'door_01',capability:'OPEN',verified:true});
  expect(getInteractionEvidence(world,'door_01','OPEN',{worldRevisionId:'rev-old'})).toMatchObject({worldRevisionId:'rev-old'});
  expect(getInteractionEvidence(world,'door_01','OPEN',{worldRevisionId:'rev-new'})).toBeNull();
  expect(world.currentWorldRevision.revision.id).toBe('rev-old');
});
