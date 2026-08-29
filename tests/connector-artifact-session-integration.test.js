import { describe, expect, it, vi } from 'vitest';
import { ConnectorClient } from '../generation/connector/ConnectorClient.js';
import { ConnectorArtifactClient } from '../generation/connector/ConnectorArtifactClient.js';

const ENDPOINT='http://127.0.0.1:48123';
const ORIGIN='https://xiaoqianran.github.io';
const NOW=Date.parse('2026-08-24T09:00:00.000Z');
const response=(payload,status=200)=>({
  ok:status>=200&&status<300,status,redirected:false,
  json:async()=>structuredClone(payload)
});

const paired={
  status:'paired',token:'session-secret-value',
  session:{
    connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'},
    contractVersion:'1',clientIdentity:'agentscape',tokenId:'session_01',
    scopes:['capabilities.read','jobs.submit','jobs.read','jobs.cancel','artifacts.read'],
    issuedAt:'2026-08-24T08:59:00.000Z',expiresAt:'2026-08-24T10:00:00.000Z',
    allowedOrigins:[ORIGIN],capabilityRevision:'caprev_01',capabilityHash:'sha256:cap01',
    revokeEndpoint:'/connector/v1/session'
  }
};

describe('Connector artifact session boundary',()=>{
  it('keeps session token private while using it only in the scoped artifact Authorization request',async()=>{
    const artifactResponse={ok:true,status:200,redirected:false,headers:new Headers(),body:null};
    const fetchImpl=vi.fn()
      .mockImplementationOnce(async()=>response(paired))
      .mockImplementationOnce(async()=>artifactResponse);
    const connector=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await connector.pair();
    const artifacts=new ConnectorArtifactClient({connectorClient:connector});
    await expect(artifacts.open('artifact_01',{
      accept:'model/gltf-binary',expectedConnector:{id:'unified-connector',instance:'instance_01'}
    })).resolves.toBe(artifactResponse);

    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toBe(`${ENDPOINT}/connector/v1/artifacts/artifact_01`);
    expect(options.method).toBe('GET');
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(options.headers.authorization).toBe('Bearer session-secret-value');
    expect(options.headers.accept).toBe('model/gltf-binary');
    expect(JSON.stringify(connector.session())).not.toContain('session-secret-value');
  });
});
