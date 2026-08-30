import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_API,
  LEGACY_ENDPOINT_STORAGE_KEYS,
  LOCAL_ADAPTER_HOST,
  applyCapabilityStatus,
  clearLegacyEndpointOverrides,
  normalizeCapabilityStatus,
  readCapabilityStatus
} from '../../studio/config/capabilityEntry.js';

describe('AgentScape capability entry', () => {
  it('exposes only AgentScape-owned same-origin capabilities plus the Connector host', () => {
    expect(CAPABILITY_API).toEqual({
      status:'/api/capabilities',
      agent:'/api/capabilities/agent',
      assetCompile:'/api/capabilities/asset-compile'
    });
    expect(LOCAL_ADAPTER_HOST.connector).toBe('http://127.0.0.1:48123');
  });

  it('removes obsolete browser endpoint overrides', () => {
    const removeItem=vi.fn();
    clearLegacyEndpointOverrides({removeItem});
    expect(removeItem.mock.calls.map(([key])=>key)).toEqual([...LEGACY_ENDPOINT_STORAGE_KEYS]);
    expect(LEGACY_ENDPOINT_STORAGE_KEYS).toContain('agentscape.connectorEndpoint');
  });

  it('ignores retired asset.generate deployment capability truth', () => {
    expect(normalizeCapabilityStatus({capabilities:{agent:{available:true},'asset.compile':{available:false},'asset.generate':{available:true}}})).toEqual({
      source:'server',agent:{available:true},assetCompile:{available:false}
    });
  });

  it('reads capability status only through the same-origin capability API', async () => {
    const fetchImpl=vi.fn(async(url)=>{
      expect(url).toBe('/api/capabilities');
      return new Response(JSON.stringify({capabilities:{agent:{available:true},'asset.compile':{available:true}}}),{status:200,headers:{'content-type':'application/json'}});
    });
    const status=await readCapabilityStatus({fetchImpl});
    expect(status).toEqual({source:'server',agent:{available:true},assetCompile:{available:true}});
  });

  it('fails closed when capability status cannot be read', async () => {
    const status=await readCapabilityStatus({fetchImpl:vi.fn(async()=>{throw new Error('offline');})});
    expect(status).toMatchObject({source:'unavailable',agent:{available:false},assetCompile:{available:false}});
  });

  it('applies deployment truth only to the LLM gateway and Generation compiler boundary', () => {
    const gateway={setEndpoint:vi.fn()},generation={setCompilerEndpoint:vi.fn()};
    applyCapabilityStatus({gateway,generation},{agent:{available:true},assetCompile:{available:false}});
    expect(gateway.setEndpoint).toHaveBeenCalledWith('/api/capabilities/agent');
    expect(generation.setCompilerEndpoint).toHaveBeenCalledWith('');
  });
});
