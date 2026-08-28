import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_API,
  LEGACY_ENDPOINT_STORAGE_KEYS,
  LOCAL_ADAPTER_HOST,
  applyCapabilityStatus,
  clearLegacyEndpointOverrides,
  normalizeCapabilityStatus,
  readCapabilityStatus
} from '../src/config/capabilityEntry.js';

describe('AgentScape capability entry', () => {
  it('exposes only same-origin capability routes plus an optional local adapter host', () => {
    expect(CAPABILITY_API).toEqual({
      status: '/api/capabilities',
      agent: '/api/capabilities/agent',
      assetCompile: '/api/capabilities/asset-compile',
      assetGenerate: '/api/capabilities/asset-generate'
    });
    expect(LOCAL_ADAPTER_HOST.connector).toBe('http://127.0.0.1:3210');
  });

  it('removes obsolete browser endpoint overrides', () => {
    const removeItem = vi.fn();
    clearLegacyEndpointOverrides({ removeItem });
    expect(removeItem.mock.calls.map(([key]) => key)).toEqual([...LEGACY_ENDPOINT_STORAGE_KEYS]);
    expect(LEGACY_ENDPOINT_STORAGE_KEYS).toContain('agentscape.connectorEndpoint');
  });

  it('normalizes capability truth without exposing adapter locations', () => {
    expect(normalizeCapabilityStatus({ capabilities: {
      agent:{available:true},
      'asset.compile':{available:false},
      'asset.generate':{available:true}
    } })).toEqual({
      source:'server',
      agent:{available:true},
      assetCompile:{available:false},
      assetGenerate:{available:true}
    });
  });

  it('reads capability status only through the same-origin capability API', async () => {
    const fetchImpl=vi.fn(async (url) => {
      expect(url).toBe('/api/capabilities');
      return new Response(JSON.stringify({ capabilities:{
        agent:{available:true},
        'asset.compile':{available:true},
        'asset.generate':{available:false}
      } }),{status:200,headers:{'content-type':'application/json'}});
    });
    const status=await readCapabilityStatus({fetchImpl});
    expect(status.agent.available).toBe(true);
    expect(status.assetGenerate.available).toBe(false);
  });

  it('fails closed when capability status cannot be read', async () => {
    const status=await readCapabilityStatus({fetchImpl:vi.fn(async()=>{throw new Error('offline');})});
    expect(status.source).toBe('unavailable');
    expect(status.agent.available).toBe(false);
    expect(status.assetCompile.available).toBe(false);
    expect(status.assetGenerate.available).toBe(false);
  });

  it('applies capability truth to fixed same-origin implementation adapters', () => {
    const gateway={setEndpoint:vi.fn()},compilerProvider={setEndpoint:vi.fn()},assetGenerator={setEndpoint:vi.fn()};
    applyCapabilityStatus({gateway,compilerProvider,assetGenerator},{
      agent:{available:true},assetCompile:{available:false},assetGenerate:{available:true}
    });
    expect(gateway.setEndpoint).toHaveBeenCalledWith('/api/capabilities/agent');
    expect(compilerProvider.setEndpoint).toHaveBeenCalledWith('');
    expect(assetGenerator.setEndpoint).toHaveBeenCalledWith('/api/capabilities/asset-generate');
  });
});
