import { describe, expect, it, vi } from 'vitest';
import { ProviderRegistry, createProviderRegistry } from '../../generation/providers/ProviderRegistry.js';

const provider=(id,{status='available',health='healthy',operation=`${id}.asset.text_to_3d.v1`,input=['text'],output=['asset']}={})=>({
  id,version:'1',status,health,contractVersion:'1',
  capabilities:[{operation,status,input:{types:input},output:{roles:output},execution:{async:true}}]
});

describe('ProviderRegistry', () => {
  it('starts empty and does not encode remote Provider topology in AgentScape source', () => {
    const registry=createProviderRegistry();
    expect(registry.listProviders()).toEqual([]);
    expect(registry.findCapabilities()).toEqual([]);
    for (const retiredDefault of ['modal-2d','modal-3d','embodiedgen','legacy-http-generator','local-catalog']) {
      expect(registry.hasProvider(retiredDefault)).toBe(false);
    }
  });

  it('allows explicit local capabilities without granting them Connector replacement semantics', async () => {
    const registry=new ProviderRegistry();
    registry.registerProvider(provider('local-test'));
    registry.bindCapability('local-test.asset.text_to_3d.v1',{execute:vi.fn(async(request)=>({id:request.prompt}))});
    const capability=registry.resolveCapability({provider:'local-test',input:'text',output:'asset'});
    expect(capability).toMatchObject({provider:'local-test',operation:'local-test.asset.text_to_3d.v1'});
    await expect(registry.execute(capability,{prompt:'chair'})).resolves.toEqual({id:'chair'});
    expect(registry.getProviderSource('local-test')).toEqual({kind:'local',sourceId:null,replaceableBy:[]});
  });

  it('rejects unstable operation IDs and duplicate providers', () => {
    const registry=new ProviderRegistry();
    expect(()=>registry.registerProvider({id:'example',status:'available',health:'healthy',capabilities:[{operation:'text_to_3d',status:'available'}]})).toThrow(/stable provider-scoped ID/);
    registry.registerProvider({id:'example',status:'available',health:'healthy',capabilities:[]});
    expect(()=>registry.registerProvider({id:'example',capabilities:[]})).toThrow(/already registered/);
  });

  it('does not expose mutation through returned descriptors', () => {
    const registry=createProviderRegistry({providers:[provider('local-test')]});
    const copy=registry.getProvider('local-test');
    copy.status='disabled';
    copy.capabilities[0].status='disabled';
    expect(registry.getProvider('local-test')).toMatchObject({status:'available',capabilities:[{status:'available'}]});
  });
});
