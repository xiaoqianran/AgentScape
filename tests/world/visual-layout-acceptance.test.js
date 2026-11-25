import { expect, it, vi } from 'vitest';
import { compileWorldAcceptance, evaluateWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';

const overlap={code:'P_OVERLAP',object:'wheel',other:'axle',message:'broad phase'};
const floating={code:'G_FLOATING',object:'dna'};
const declaration={object:'axle',other:'wheel',reason:'Mechanical hub and axle connection'};
const floatDeclaration={object:'dna',reason:'Floating background illustration'};
const layout={id:'layout',kind:'visual-layout',expectedOverlaps:[declaration],expectedFloating:[floatDeclaration]};
const setup=({hard=[overlap],advisory=[floating],physical=[],missing=[]}={})=>{
 const records=new Map(['wheel','axle','dna'].filter(id=>!missing.includes(id)).map(id=>[id,{active:true,manifest:{capabilityLevel:physical.includes(id)?'physical':'visual'}}]));
 const validation={ok:hard.length===0,counts:{hard:hard.length,advisory:advisory.length},hard,advisory};
 const runtime={store:records,physics:{getPosition:id=>physical.includes(id)?[0,0,0]:null},validator:{run:vi.fn(()=>validation)}};
 return {runtime,validation};
};

it('acknowledges only declared visual findings, preserves raw diagnostics and shares one validation snapshot',()=>{
 const {runtime,validation}=setup();
 const result=evaluateWorldAcceptance(runtime,compileWorldAcceptance([layout,{id:'strict',kind:'world-valid'}]));
 expect(runtime.validator.run).toHaveBeenCalledTimes(1);
 expect(result.status).toBe('world-incomplete');
 expect(result.checks[0]).toMatchObject({verified:true,evidence:{scope:'visual-layout-only',validation,acknowledged:[{finding:overlap,declaration},{finding:floating,declaration:floatDeclaration}]}});
 expect(result.checks[1]).toMatchObject({verified:false,reason:'WORLD_VALIDATION_FAILED',evidence:validation});
 expect(validation.hard).toEqual([overlap]);expect(validation.advisory).toEqual([floating]);
});

it('fails closed for undeclared collisions, unsupported physical objects, stale declarations and missing evidence',()=>{
 for(const options of [
   {hard:[overlap,{code:'G_BELOW_GROUND',object:'wheel'}]},
   {hard:[overlap,{code:'P_OVERLAP',object:'wheel',other:'dna'}]},
   {advisory:[floating,{code:'G_FLOATING',object:'wheel'}]},
   {physical:['wheel']},{missing:['axle']},{hard:[]},{advisory:[]}
 ]){
   const {runtime}=setup(options);
   expect(evaluateWorldAcceptance(runtime,compileWorldAcceptance([layout])).checks[0].verified,JSON.stringify(options)).toBe(false);
 }
 const {runtime}=setup();runtime.physics.getPosition=()=>[0,0,0];
 expect(evaluateWorldAcceptance(runtime,compileWorldAcceptance([layout])).checks[0].verified).toBe(false);
 expect(evaluateWorldAcceptance({},compileWorldAcceptance([layout])).checks[0].reason).toBe('VISUAL_LAYOUT_EVIDENCE_MISSING');
});

it('rejects ambiguous, duplicate, oversized, or implicit declarations',()=>{
 const invalid=[
  {...layout,expectedOverlaps:[declaration,{...declaration,object:'wheel',other:'axle'}]},
  {...layout,expectedOverlaps:[{...declaration,other:'axle'}]},
  {...layout,expectedFloating:[{object:'dna',reason:' '}]},
  {...layout,expectedFloating:Array.from({length:65},(_,i)=>({object:'o'+i,reason:'floating'}))},
  {...layout,kind:'world-valid'},
  {...layout,expectedOverlaps:[{...declaration,waiveAll:true}]}
 ];
 for(const criterion of invalid)expect(()=>compileWorldAcceptance([criterion])).toThrow();
});
