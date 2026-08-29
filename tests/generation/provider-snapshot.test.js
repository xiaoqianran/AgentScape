import { describe, expect, it } from 'vitest';
import { createProviderRegistry } from '../../generation/providers/ProviderRegistry.js';

const capability=(providerId,domain='image',operation='text_to_image',output='image')=>({
  operation:`${providerId}.${domain}.${operation}.v1`,status:'available',input:{types:['text']},output:{roles:[output]},
  prerequisites:{authMode:'connector-session',connection:true}
});
const provider=(id,overrides={})=>({id,version:'1',status:'available',health:'healthy',contractVersion:'1',capabilities:[capability(id)],...overrides});
const snap=(providers,{revision='r1',hash='h1',instance='i1'}={})=>({revision,hash,connector:{id:'unified-connector',instance,version:'1.0.0'},providers});
const opts={sourceId:'connector:unified-connector',sourceKind:'connector'};

describe('ProviderRegistry Connector snapshot ownership',()=>{
  it('discovers arbitrary Provider ids from Connector snapshots without source-code placeholders',()=>{
    const registry=createProviderRegistry();
    registry.applyProviderSnapshot(snap([provider('vendor-image')]),opts);
    expect(registry.getProvider('vendor-image').status).toBe('available');
    expect(registry.getProviderSource('vendor-image')).toMatchObject({kind:'connector',sourceId:opts.sourceId});
  });

  it('rejects attempts to overwrite an explicitly local provider without partial mutation',()=>{
    const registry=createProviderRegistry({providers:[provider('local-owned')]});
    expect(()=>registry.applyProviderSnapshot(snap([provider('vendor-ok'),provider('local-owned')]),opts)).toThrow(/ownership conflict: local-owned/);
    expect(registry.hasProvider('vendor-ok')).toBe(false);
    expect(registry.getProviderSource('local-owned')).toEqual({kind:'local',sourceId:null,replaceableBy:[]});
    expect(registry.getSnapshotState(opts.sourceId)).toBeNull();
  });

  it('rejects malformed later providers without partially applying earlier providers',()=>{
    const registry=createProviderRegistry();
    expect(()=>registry.applyProviderSnapshot(snap([
      provider('vendor-good'),
      provider('vendor-bad',{capabilities:[{operation:'not-versioned',status:'available'}]})
    ]),opts)).toThrow(/stable provider-scoped ID/);
    expect(registry.hasProvider('vendor-good')).toBe(false);
    expect(registry.hasProvider('vendor-bad')).toBe(false);
  });

  it('removes Connector-owned providers that disappear from a newer snapshot',()=>{
    const registry=createProviderRegistry();
    registry.applyProviderSnapshot(snap([provider('vendor-x')]),opts);
    expect(registry.hasProvider('vendor-x')).toBe(true);
    registry.applyProviderSnapshot(snap([],{revision:'r2',hash:'h2'}),opts);
    expect(registry.hasProvider('vendor-x')).toBe(false);
    expect(registry.getSnapshotState(opts.sourceId)).toMatchObject({revision:'r2',hash:'h2',providerIds:[]});
  });

  it('clears an entire Connector snapshot back to the local-only registry',()=>{
    const registry=createProviderRegistry({providers:[provider('local-owned')]});
    registry.applyProviderSnapshot(snap([provider('vendor-x')]),opts);
    const cleared=registry.clearProviderSnapshot(opts.sourceId);
    expect(cleared).toMatchObject({cleared:true,providerIds:['vendor-x']});
    expect(registry.hasProvider('vendor-x')).toBe(false);
    expect(registry.hasProvider('local-owned')).toBe(true);
  });

  it('rejects another Connector source from hijacking a Provider owned by the active snapshot',()=>{
    const registry=createProviderRegistry();
    registry.applyProviderSnapshot(snap([provider('vendor-x')]),opts);
    expect(()=>registry.applyProviderSnapshot(
      snap([provider('vendor-x')],{revision:'other',hash:'other',instance:'other'}),
      {sourceId:'connector:other',sourceKind:'connector'}
    )).toThrow(/ownership conflict: vendor-x/);
  });
});
