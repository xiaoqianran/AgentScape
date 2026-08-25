import { describe, expect, it } from 'vitest';
import { compileWorldAcceptance, evaluateWorldAcceptance } from '../src/validation/WorldAcceptance.js';

describe('WorldAcceptance',()=>{
  const runtime={store:{get:id=>({id,state:{enabled:id==='light',lastVerifiedAction:id==='door'?'OPEN':null}})},validator:{run:()=>({ok:true,counts:{hard:0}})}};
  it('compiles explicit world-level criteria',()=>expect(compileWorldAcceptance([{id:'valid',kind:'world-valid'},{id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},{id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},{id:'clean',kind:'no-unresolved'}]).checks).toHaveLength(4));
  it('returns world-accepted only when every criterion is verified',()=>expect(evaluateWorldAcceptance(runtime,compileWorldAcceptance([{id:'valid',kind:'world-valid'},{id:'light-on',kind:'state-equals',targetId:'light',stateKey:'enabled',value:true},{id:'door-open',kind:'interaction-verified',targetId:'door',capability:'open'},{id:'clean',kind:'no-unresolved'}]),{unresolvedMutations:[]}).status).toBe('world-accepted'));
  it('reports incomplete evidence instead of collapsing failure into task success',()=>{const result=evaluateWorldAcceptance(runtime,compileWorldAcceptance([{id:'light-off',kind:'state-equals',targetId:'light',stateKey:'enabled',value:false},{id:'clean',kind:'no-unresolved'}]),{unresolvedMutations:[{tool:'approachAndInteract'}]});expect(result.status).toBe('world-incomplete');expect(result.failedCount).toBe(2);});
});
