import { describe, expect, it, vi } from 'vitest';
import { captureWorldAuthority, commitWorldAuthority, restoreWorldAuthority } from '../../world/runtime/WorldAuthority.js';

const runtime=()=>({
  currentWorldRevision:{revision:{id:'rev-1'},provenance:{source:'planner'}},
  currentBehaviorBundle:{ruleGraph:[{id:'rule-1'}]},
  currentPhysicsRequirements:{requirements:[{entityId:'door'}]},
  lastAcceptanceBundle:{worldRevisionId:'rev-1'},
  restoredAcceptanceEvidence:{worldRevisionId:'rev-old'},
  interactionEvidence:new Map([['door:OPEN',{worldRevisionId:'rev-1',verified:true}]]),
  loadRuleGraph:vi.fn()
});

describe('WorldAuthority', () => {
  it('captures and restores the complete authority state without sharing mutable references', () => {
    const world=runtime();
    const captured=captureWorldAuthority(world);
    world.currentBehaviorBundle.ruleGraph[0].id='mutated';
    world.interactionEvidence.get('door:OPEN').verified=false;

    restoreWorldAuthority(world,captured);

    expect(world.currentWorldRevision).toEqual(captured.currentWorldRevision);
    expect(world.currentBehaviorBundle).toEqual({ruleGraph:[{id:'rule-1'}]});
    expect(world.currentPhysicsRequirements).toEqual(captured.currentPhysicsRequirements);
    expect(world.lastAcceptanceBundle).toEqual(captured.lastAcceptanceBundle);
    expect(world.restoredAcceptanceEvidence).toEqual(captured.restoredAcceptanceEvidence);
    expect([...world.interactionEvidence.entries()]).toEqual(captured.interactionEvidence);
    expect(world.currentBehaviorBundle).not.toBe(captured.currentBehaviorBundle);
    expect(world.loadRuleGraph).toHaveBeenCalledWith([{id:'rule-1'}]);
  });

  it('commits canonical authority through one path and leaves runtime interaction evidence owned by its subsystem', () => {
    const world=runtime();
    const evidence=world.interactionEvidence;
    commitWorldAuthority(world,{
      worldIR:{revision:{id:'rev-2',parentId:'rev-1'},provenance:{source:'revision'}},
      behaviorBundle:{ruleGraph:[{id:'rule-2'}]},
      physicsRequirements:{requirements:[{entityId:'drawer'}]},
      acceptanceBundle:{worldRevisionId:'rev-2',result:{status:'world-accepted'}}
    });

    expect(world.currentWorldRevision).toEqual({revision:{id:'rev-2',parentId:'rev-1'},provenance:{source:'revision'}});
    expect(world.currentBehaviorBundle).toEqual({ruleGraph:[{id:'rule-2'}]});
    expect(world.currentPhysicsRequirements).toEqual({requirements:[{entityId:'drawer'}]});
    expect(world.lastAcceptanceBundle).toMatchObject({worldRevisionId:'rev-2'});
    expect(world.restoredAcceptanceEvidence).toBeNull();
    expect(world.interactionEvidence).toBe(evidence);
    expect(world.loadRuleGraph).toHaveBeenCalledWith([{id:'rule-2'}]);
  });
});
