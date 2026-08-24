import { describe, expect, it } from 'vitest';
import { createDefaultProviderRegistry } from '../src/providers/ProviderRegistry.js';

const capability=(providerId,domain='image',operation='text_to_image',output='image')=>({
  operation:`${providerId}.${domain}.${operation}.v1`,
  status:'available',
  input:{types:['text']},output:{roles:[output]},
  prerequisites:{authMode:'connector-session',connection:true}
});
const provider=(id,overrides={})=>({
  id,version:'1',status:'available',health:'healthy',contractVersion:'1',
  capabilities:[capability(id)],
  ...overrides
});
const snap=(providers,{revision='r1',hash='h1',instance='i1'}={})=>({
  revision,hash,connector:{id:'unified-connector',instance,version:'1.0.0'},providers
});
const opts={sourceId:'connector:unified-connector',sourceKind:'connector'};

describe('ProviderRegistry connector snapshot ownership',()=>{
  it('allows connector snapshots to replace declared placeholders only',()=>{
    const registry=createDefaultProviderRegistry();
    expect(registry.getProviderSource('modal-2d')).toEqual({kind:'placeholder',sourceId:null,replaceableBy:['connector']});
    registry.applyProviderSnapshot(snap([provider('modal-2d')]),opts);
    expect(registry.getProvider('modal-2d').status).toBe('available');
    expect(registry.getProviderSource('modal-2d')).toMatchObject({kind:'connector',sourceId:opts.sourceId});
  });

  it('rejects attempts to overwrite locally-owned providers without partial mutation',()=>{
    const registry=createDefaultProviderRegistry();
    const beforeModal=registry.getProvider('modal-2d');
    const beforeCatalog=registry.getProvider('local-catalog');
    expect(()=>registry.applyProviderSnapshot(snap([
      provider('modal-2d'),
      provider('local-catalog',{capabilities:[capability('local-catalog')]})
    ]),opts)).toThrow(/ownership conflict: local-catalog/);
    expect(registry.getProvider('modal-2d')).toEqual(beforeModal);
    expect(registry.getProvider('local-catalog')).toEqual(beforeCatalog);
    expect(registry.getSnapshotState(opts.sourceId)).toBeNull();
  });

  it('rejects a malformed later provider without partially applying an earlier valid provider',()=>{
    const registry=createDefaultProviderRegistry();
    const before=registry.getProvider('modal-2d');
    expect(()=>registry.applyProviderSnapshot(snap([
      provider('modal-2d'),
      provider('vendor-bad',{capabilities:[{operation:'not-versioned',status:'available'}]})
    ]),opts)).toThrow(/stable provider-scoped ID/);
    expect(registry.getProvider('modal-2d')).toEqual(before);
    expect(registry.hasProvider('vendor-bad')).toBe(false);
    expect(registry.getSnapshotState(opts.sourceId)).toBeNull();
  });

  it('restores placeholder state when a connector provider disappears from the next snapshot',()=>{
    const registry=createDefaultProviderRegistry();
    const fallback=registry.getProvider('modal-2d');
    registry.applyProviderSnapshot(snap([provider('modal-2d')]),opts);
    registry.applyProviderSnapshot(snap([],{revision:'r2',hash:'h2'}),opts);
    expect(registry.getProvider('modal-2d')).toEqual(fallback);
    expect(registry.getProviderSource('modal-2d')).toEqual({kind:'placeholder',sourceId:null,replaceableBy:['connector']});
    expect(registry.getSnapshotState(opts.sourceId)).toMatchObject({revision:'r2',hash:'h2',providerIds:[]});
  });

  it('removes connector-only providers that disappear and can clear an entire snapshot',()=>{
    const registry=createDefaultProviderRegistry();
    registry.applyProviderSnapshot(snap([provider('vendor-x')]),opts);
    expect(registry.hasProvider('vendor-x')).toBe(true);
    registry.applyProviderSnapshot(snap([],{revision:'r2',hash:'h2'}),opts);
    expect(registry.hasProvider('vendor-x')).toBe(false);

    registry.applyProviderSnapshot(snap([provider('modal-3d')],{revision:'r3',hash:'h3'}),opts);
    expect(registry.getProvider('modal-3d').status).toBe('available');
    const cleared=registry.clearProviderSnapshot(opts.sourceId);
    expect(cleared.cleared).toBe(true);
    expect(registry.getProvider('modal-3d').status).toBe('disabled');
    expect(registry.getSnapshotState(opts.sourceId)).toBeNull();
  });

  it('rejects another connector source from hijacking providers owned by the active snapshot',()=>{
    const registry=createDefaultProviderRegistry();
    registry.applyProviderSnapshot(snap([provider('modal-2d')]),opts);
    expect(()=>registry.applyProviderSnapshot(
      snap([provider('modal-2d')],{revision:'other',hash:'other',instance:'other'}),
      {sourceId:'connector:other',sourceKind:'connector'}
    )).toThrow(/ownership conflict: modal-2d/);
  });

  it('keeps an unconfigured EmbodiedGen placeholder replaceable but protects a configured local generator',()=>{
    const unconfigured=createDefaultProviderRegistry();
    expect(unconfigured.getProviderSource('embodiedgen')).toEqual({kind:'placeholder',sourceId:null,replaceableBy:['connector']});

    const generator={isConfigured:()=>true,generate:async()=>({manifest:{}})};
    const configured=createDefaultProviderRegistry({generator});
    expect(configured.getProviderSource('embodiedgen')).toEqual({kind:'local',sourceId:null,replaceableBy:[]});
    expect(()=>configured.applyProviderSnapshot(snap([provider('embodiedgen',{capabilities:[capability('embodiedgen','asset','text_to_3d','asset')]})]),opts))
      .toThrow(/ownership conflict: embodiedgen/);
  });
});
