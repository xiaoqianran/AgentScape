import { describe, expect, it } from 'vitest';
import { validateAssetManifest } from '../../asset/schema.js';

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
