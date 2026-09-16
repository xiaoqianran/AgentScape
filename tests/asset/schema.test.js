import { describe, expect, it } from 'vitest';
import { validateAssetManifest } from '../../modules/asset/schema.js';

describe('asset manifest validation', () => {
  it('accepts a minimal valid manifest', () => {
    expect(validateAssetManifest({ id: 'box', type: 'prop', source: { kind: 'builtin' }, actions: [], physics: { body: 'fixed' } }).id).toBe('box');
  });
  it('rejects duplicate actions', () => {
    expect(() => validateAssetManifest({ id: 'cup', type: 'cup', source: { kind: 'builtin' }, actions: ['pickup', 'pickup'] })).toThrow(/unique/);
  });
  it('accepts compiled sources and convex hull colliders', () => { expect(() => validateAssetManifest({ id:'x', type:'object', source:{kind:'compiled',key:'x'}, actions:['move'], physics:{body:'fixed',colliders:[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,1]}]} })).not.toThrow(); });
  it('rejects non-finite or non-positive collider dimensions', () => {
    expect(() => validateAssetManifest({ id:'x', type:'x', source:{kind:'builtin'}, actions:[], physics:{body:'fixed',colliders:[{shape:'box',halfExtents:[1,0,1]}]} })).toThrow();
    expect(() => validateAssetManifest({ id:'x', type:'x', source:{kind:'builtin'}, actions:[], physics:{body:'fixed',colliders:[{shape:'convexHull',vertices:[0,0,0,1,0,0,0,1,0,0,0,Infinity]}]} })).toThrow();
  });

  it('validates declarative dynamics fields', () => {
    const base={id:'ball',type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'dynamic',mass:1,friction:.5,restitution:.7,linearDamping:.1,angularDamping:.2,gravityScale:0,ccd:true,sensor:false,collisionEvents:true}};
    expect(()=>validateAssetManifest(base)).not.toThrow();
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,restitution:1.1}})).toThrow(/restitution/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,linearDamping:-.1}})).toThrow(/linearDamping/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,mass:0}})).toThrow(/mass/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,ccd:'yes'}})).toThrow(/ccd/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,sensor:1}})).toThrow(/sensor/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,collisionEvents:'yes'}})).toThrow(/collisionEvents/);
  });

  it('validates named collision groups and collidesWith filters', () => {
    const base={id:'crate',type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'dynamic',collision:{groups:['prop','flammable'],collidesWith:['environment','agent']}}};
    expect(()=>validateAssetManifest(base)).not.toThrow();
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,collision:{groups:[],collidesWith:['agent']}}})).toThrow(/groups/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,collision:{groups:['prop','prop'],collidesWith:['agent']}}})).toThrow(/unique/);
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,collision:{groups:['prop'],collidesWith:'agent'}}})).toThrow(/collidesWith/);
  });

  it('validates sleep, axis locks and fixed joints', () => {
    const base={id:'crate',type:'prop',source:{kind:'builtin'},actions:[],physics:{body:'dynamic',canSleep:false,lockTranslation:[true,false,false],lockRotation:[false,true,false]}};
    expect(()=>validateAssetManifest(base)).not.toThrow();
    expect(()=>validateAssetManifest({...base,physics:{...base.physics,lockTranslation:[true,false]}})).toThrow(/lockTranslation/);
    const fixed={id:'assembly',type:'prop',source:{kind:'builtin'},actions:[],parts:{p:{node:'P',physics:{body:'dynamic'},joint:{type:'fixed',parentAnchor:[0,0,0],childAnchor:[0,0,0]}}}};
    expect(()=>validateAssetManifest(fixed)).not.toThrow();
    const fixedPart=fixed.parts.p;
    expect(()=>validateAssetManifest({...fixed,parts:{p:{...fixedPart,joint:{...fixedPart.joint,axis:[1,0,0]}}}})).toThrow(/fixed joint.*axis/);
    expect(()=>validateAssetManifest({...fixed,parts:{p:{...fixedPart,joint:{...fixedPart.joint,limits:[0,1]}}}})).toThrow(/fixed joint.*limits/);
    expect(()=>validateAssetManifest({...fixed,parts:{p:{...fixedPart,joint:{...fixedPart.joint,motor:{stiffness:1}}}}})).toThrow(/fixed joint.*motor/);
    expect(()=>validateAssetManifest({...fixed,parts:{p:{...fixedPart,targets:{open:1}}}})).toThrow(/fixed joint.*targets/);
  });

  it('requires articulated top-level actions to map to explicit executable part targets', () => {
    expect(() => validateAssetManifest({ id:'cab', type:'cabinet', source:{kind:'builtin'}, actions:['open'] })).toThrow(/executable part target/);
    const manifest = { id:'cab', type:'cabinet', source:{kind:'builtin'}, actions:['open','close'], parts:{ panel:{ node:'Panel', actions:['open','close'], targets:{open:-1,close:0}, physics:{body:'dynamic',colliders:[{shape:'box',halfExtents:[.1,.1,.1]}]}, joint:{type:'revolute',axis:[0,1,0],limits:[-1,0],parentAnchor:[0,0,0],childAnchor:[0,0,0]} } } };
    expect(() => validateAssetManifest(manifest)).not.toThrow();
  });


  it('requires explicit local anchors and a non-zero joint axis', () => {
    const base={id:'x',type:'x',source:{kind:'builtin'},actions:[],parts:{p:{node:'P',physics:{body:'dynamic'},joint:{type:'revolute',axis:[0,0,0],limits:[-1,1]}}}};
    expect(() => validateAssetManifest(base)).toThrow(/non-zero finite axis/);
    const missingAnchor=structuredClone(base); missingAnchor.parts.p.joint.axis=[0,1,0];
    expect(() => validateAssetManifest(missingAnchor)).toThrow(/parentAnchor/);
  });

  it('rejects invalid joint type', () => {
    expect(() => validateAssetManifest({ id: 'cabinet', type: 'cabinet', source: { kind: 'builtin' }, actions: [], parts: { door: { node: 'Door', joint: { type: 'magic' } } } })).toThrow(/joint type/);
  });

  it('validates executable receptacle volumes for canonical INSIDE placement', () => {
    const valid={id:'cab',type:'cabinet',source:{kind:'builtin'},actions:[],receptacles:[{id:'interior',localPosition:[0,1,0],size:[1.4,1.6,.5]}]};
    expect(()=>validateAssetManifest(valid)).not.toThrow();
    const duplicate=structuredClone(valid); duplicate.receptacles.push(structuredClone(duplicate.receptacles[0]));
    expect(()=>validateAssetManifest(duplicate)).toThrow(/unique/);
    const invalid=structuredClone(valid); invalid.receptacles[0].size=[1,0,.5];
    expect(()=>validateAssetManifest(invalid)).toThrow(/positive finite/);
  });

  it('validates embodiment hold-anchor coordinates', () => {
    const valid={id:'agent',type:'agent',source:{kind:'builtin'},actions:['navigate'],embodiment:{holdAnchor:{translation:[0,.95,-.62],rotation:[0,0,0,1]}},physics:{body:'kinematic'}};
    expect(()=>validateAssetManifest(valid)).not.toThrow();
    const invalid=structuredClone(valid); invalid.embodiment.holdAnchor.translation=[0,NaN,0];
    expect(()=>validateAssetManifest(invalid)).toThrow(/holdAnchor\.translation/);
  });

});
