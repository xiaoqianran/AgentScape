import { describe, expect, it, vi } from 'vitest';
import { ConnectorClient } from '../src/connector/ConnectorClient.js';
import {
  CONNECTOR_SESSION_SCOPES,
  ConnectorContractError,
  normalizeConnectorEndpoint
} from '../src/connector/ConnectorSession.js';

const ORIGIN='https://xiaoqianran.github.io';
const ENDPOINT='http://127.0.0.1:48123';
const NOW=Date.parse('2026-08-24T06:00:00.000Z');

const response = (payload, status=200) => ({
  ok:status>=200&&status<300,
  status,
  json:async()=>structuredClone(payload)
});

const pairedPayload = (overrides={}) => ({
  status:'paired',
  token:'session-secret-value',
  session:{
    connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'},
    contractVersion:'1',
    clientIdentity:'agentscape',
    tokenId:'session_01',
    scopes:[...CONNECTOR_SESSION_SCOPES],
    issuedAt:'2026-08-24T05:59:00.000Z',
    expiresAt:'2026-08-24T06:10:00.000Z',
    allowedOrigins:[ORIGIN],
    capabilityRevision:'caprev_2026_08_24_01',
    capabilityHash:'sha256:capabilities-v1',
    revokeEndpoint:'/connector/v1/session',
    ...(overrides.session||{})
  },
  ...Object.fromEntries(Object.entries(overrides).filter(([key])=>key!=='session'))
});

describe('Connector pairing session contract',()=>{
  it('accepts only bare loopback Connector origins',()=>{
    expect(normalizeConnectorEndpoint('http://127.0.0.1:48123/')).toBe(ENDPOINT);
    expect(normalizeConnectorEndpoint('http://localhost:48123')).toBe('http://localhost:48123');
    expect(normalizeConnectorEndpoint('http://[::1]:48123')).toBe('http://[::1]:48123');
    for (const invalid of [
      'http://192.168.1.8:48123',
      'https://connector.example',
      'http://user:pass@127.0.0.1:48123',
      'http://127.0.0.1:48123/connector/v1/session',
      'file:///tmp/connector'
    ]) expect(()=>normalizeConnectorEndpoint(invalid)).toThrow(ConnectorContractError);
  });

  it('pairs with least-privilege scopes and never exposes the token in the public session snapshot',async()=>{
    const fetchImpl=vi.fn(async(_url,options)=>response(pairedPayload()));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    const result=await client.pair();
    expect(result.status).toBe('paired');
    expect(client.state()).toBe('paired');
    expect(result.session).toMatchObject({
      clientIdentity:'agentscape',
      scopes:CONNECTOR_SESSION_SCOPES,
      capabilityRevision:'caprev_2026_08_24_01',
    capabilityHash:'sha256:capabilities-v1',
      status:'paired'
    });
    expect(JSON.stringify(result)).not.toContain('session-secret-value');
    expect(JSON.stringify(client.session())).not.toContain('session-secret-value');
    const [url,options]=fetchImpl.mock.calls[0];
    expect(url).toBe(`${ENDPOINT}/connector/v1/session`);
    expect(options.method).toBe('POST');
    expect(options.credentials).toBe('omit');
    const request=JSON.parse(options.body);
    expect(request).toEqual({
      clientIdentity:'agentscape',contractVersion:'1',origin:ORIGIN,scopes:CONNECTOR_SESSION_SCOPES
    });
    expect(request.scopes.some((scope)=>scope.includes('credential'))).toBe(false);
  });

  it('keeps approval_required distinct from a paired session',async()=>{
    const fetchImpl=vi.fn(async()=>response({
      status:'approval_required',pairingId:'pair_01',contractVersion:'1',
      connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'}
    }));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair()).resolves.toMatchObject({status:'approval_required',pairingId:'pair_01'});
    expect(client.state()).toBe('connection_required');
    expect(client.session()).toBeNull();
  });

  it('validates approval identity and contract version before asking the user to continue',async()=>{
    const missingId=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response({
        status:'approval_required',pairingId:'',contractVersion:'1',
        connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'}
      }))
    });
    await expect(missingId.pair()).rejects.toMatchObject({code:'CONNECTOR_RESPONSE_INVALID'});

    const wrongVersion=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response({
        status:'approval_required',pairingId:'pair_02',contractVersion:'2',
        connector:{id:'unified-connector',instance:'instance_01',version:'1.0.0'}
      }))
    });
    await expect(wrongVersion.pair()).rejects.toMatchObject({code:'CONNECTOR_CONTRACT_MISMATCH'});
  });

  it('rejects scope escalation from the Connector',async()=>{
    const fetchImpl=vi.fn(async()=>response(pairedPayload({session:{
      scopes:[...CONNECTOR_SESSION_SCOPES,'credentials.read']
    }})));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair()).rejects.toMatchObject({code:'CONNECTOR_SCOPE_ESCALATION'});
  });

  it('rejects sessions bound to a different origin',async()=>{
    const fetchImpl=vi.fn(async()=>response(pairedPayload({session:{allowedOrigins:['https://evil.example']}})));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair()).rejects.toMatchObject({code:'CONNECTOR_ORIGIN_MISMATCH'});
  });

  it('rejects incompatible contract versions and already-expired sessions',async()=>{
    const versionClient=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response(pairedPayload({session:{contractVersion:'2'}})))
    });
    await expect(versionClient.pair()).rejects.toMatchObject({code:'CONNECTOR_CONTRACT_MISMATCH'});

    const expiredClient=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response(pairedPayload({session:{expiresAt:'2026-08-24T05:59:30.000Z'}})))
    });
    await expect(expiredClient.pair()).rejects.toMatchObject({code:'CONNECTOR_SESSION_EXPIRED'});
  });

  it('changes the public session state to expired without persisting or exposing the token',async()=>{
    let now=NOW;
    const client=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>now,
      fetchImpl:vi.fn(async()=>response(pairedPayload()))
    });
    await client.pair();
    expect(client.session()?.status).toBe('paired');
    now=Date.parse('2026-08-24T06:11:00.000Z');
    expect(client.state()).toBe('connection_required');
    expect(client.session()?.status).toBe('expired');
    expect(JSON.stringify(client.session())).not.toContain('session-secret-value');
  });

  it('maps Connector transport failure to recoverable connection_required',async()=>{
    const client=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>{ throw new TypeError('network down'); })
    });
    await expect(client.pair()).rejects.toMatchObject({
      code:'CONNECTION_REQUIRED',details:{recoverable:true}
    });
    expect(client.state()).toBe('connection_required');
  });

  it('keeps authenticated Connector requests inside the v1 facade without exposing the token',async()=>{
    const fetchImpl=vi.fn()
      .mockImplementationOnce(async()=>response(pairedPayload()))
      .mockImplementationOnce(async()=>response({revision:'caprev_2026_08_24_01',providers:[]}));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await client.pair();
    const result=await client.request('/connector/v1/capabilities',{scope:'capabilities.read'});
    expect(result.ok).toBe(true);
    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toBe(`${ENDPOINT}/connector/v1/capabilities`);
    expect(options.credentials).toBe('omit');
    expect(options.headers.authorization).toBe('Bearer session-secret-value');
    expect(JSON.stringify(client.session())).not.toContain('session-secret-value');
    await expect(client.request('https://evil.example/connector/v1/capabilities',{scope:'capabilities.read'}))
      .rejects.toMatchObject({code:'CONNECTOR_PATH_INVALID'});
    for (const unsafe of [
      '/connector/v1/../secret',
      '/connector/v1/%2e%2e/secret',
      '/connector/v1/capabilities?redirect=https://evil.example',
      '/connector/v1/capabilities#fragment'
    ]) {
      await expect(client.request(unsafe,{scope:'capabilities.read'}))
        .rejects.toMatchObject({code:'CONNECTOR_PATH_INVALID'});
    }
    await expect(client.request('/connector/v1/capabilities',{scope:'credentials.read'}))
      .rejects.toMatchObject({code:'CONNECTOR_SCOPE_REQUIRED'});
    await expect(client.request('/connector/v1/capabilities'))
      .rejects.toMatchObject({code:'CONNECTOR_SCOPE_REQUIRED'});
    await expect(client.request('/connector/v1/capabilities',{
      scope:'capabilities.read',headers:{Authorization:'Bearer caller-controlled'}
    })).rejects.toMatchObject({code:'CONNECTOR_AUTH_HEADER_FORBIDDEN'});
  });

  it('revokes remotely with the private token then clears local authorization state',async()=>{
    const fetchImpl=vi.fn()
      .mockImplementationOnce(async()=>response(pairedPayload()))
      .mockImplementationOnce(async(_url,options)=>response({status:'revoked',seenAuthorization:options.headers.authorization}));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await client.pair();
    const result=await client.revoke();
    expect(result).toMatchObject({status:'revoked',session:{status:'revoked'}});
    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toBe(`${ENDPOINT}/connector/v1/session`);
    expect(options.method).toBe('DELETE');
    expect(options.headers.authorization).toBe('Bearer session-secret-value');
    expect(client.state()).toBe('connection_required');
    expect(JSON.stringify(client.session())).not.toContain('session-secret-value');
  });
});
