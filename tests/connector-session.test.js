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
const APPROVAL='pairing-approval-secret';

const response = (payload, status=200) => ({
  ok:status>=200&&status<300,
  status,
  json:async()=>structuredClone(payload)
});

const pairedPayload = (overrides={}) => ({
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
    const result=await client.pair({approval:APPROVAL});
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
    expect(options.headers['X-Connector-Pairing']).toBe(APPROVAL);
    expect(options.headers.Origin).toBe(ORIGIN);
    const request=JSON.parse(options.body);
    expect(request).toEqual({
      clientIdentity:'agentscape',contractVersion:'1',origin:ORIGIN,scopes:CONNECTOR_SESSION_SCOPES
    });
    expect(request.scopes.some((scope)=>scope.includes('credential'))).toBe(false);
  });

  it('lets browser fetch own the Origin header while keeping the session origin bound',async()=>{
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
    Object.defineProperty(globalThis,'location',{value:{origin:ORIGIN},configurable:true});
    try {
      const fetchImpl=vi.fn(async()=>response(pairedPayload()));
      const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
      await client.pair({approval:APPROVAL});
      const [,options]=fetchImpl.mock.calls[0];
      expect(options.headers.Origin).toBeUndefined();
      expect(JSON.parse(options.body).origin).toBe(ORIGIN);
    } finally {
      if (descriptor) Object.defineProperty(globalThis,'location',descriptor);
      else delete globalThis.location;
    }
  });

  it('requires pairing approval locally and sends it only in the pairing header',async()=>{
    const fetchImpl=vi.fn(async()=>response(pairedPayload()));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair()).rejects.toMatchObject({code:'PAIRING_REQUIRED'});
    expect(fetchImpl).not.toHaveBeenCalled();

    await client.pair({approval:APPROVAL});
    const [,options]=fetchImpl.mock.calls[0];
    expect(options.headers['X-Connector-Pairing']).toBe(APPROVAL);
    expect(options.headers.Origin).toBe(ORIGIN);
    expect(options.redirect).toBe('error');
    expect(options.body).not.toContain(APPROVAL);
  });

  it('rejects scope escalation from the Connector',async()=>{
    const fetchImpl=vi.fn(async()=>response(pairedPayload({session:{
      scopes:[...CONNECTOR_SESSION_SCOPES,'credentials.read']
    }})));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair({approval:APPROVAL})).rejects.toMatchObject({code:'CONNECTOR_SCOPE_ESCALATION'});
  });

  it('rejects sessions bound to a different origin',async()=>{
    const fetchImpl=vi.fn(async()=>response(pairedPayload({session:{allowedOrigins:['https://evil.example']}})));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await expect(client.pair({approval:APPROVAL})).rejects.toMatchObject({code:'CONNECTOR_ORIGIN_MISMATCH'});
  });

  it('rejects incompatible contract versions and already-expired sessions',async()=>{
    const versionClient=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response(pairedPayload({session:{contractVersion:'2'}})))
    });
    await expect(versionClient.pair({approval:APPROVAL})).rejects.toMatchObject({code:'CONNECTOR_CONTRACT_MISMATCH'});

    const expiredClient=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>NOW,
      fetchImpl:vi.fn(async()=>response(pairedPayload({session:{expiresAt:'2026-08-24T05:59:30.000Z'}})))
    });
    await expect(expiredClient.pair({approval:APPROVAL})).rejects.toMatchObject({code:'CONNECTOR_SESSION_EXPIRED'});
  });

  it('changes the public session state to expired without persisting or exposing the token',async()=>{
    let now=NOW;
    const client=new ConnectorClient({
      endpoint:ENDPOINT,origin:ORIGIN,now:()=>now,
      fetchImpl:vi.fn(async()=>response(pairedPayload()))
    });
    await client.pair({approval:APPROVAL});
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
    await expect(client.pair({approval:APPROVAL})).rejects.toMatchObject({
      code:'CONNECTION_REQUIRED',details:{recoverable:true}
    });
    expect(client.state()).toBe('connection_required');
  });

  it('keeps authenticated Connector requests inside the v1 facade without exposing the token',async()=>{
    const fetchImpl=vi.fn()
      .mockImplementationOnce(async()=>response(pairedPayload()))
      .mockImplementationOnce(async()=>response({revision:'caprev_2026_08_24_01',providers:[]}));
    const client=new ConnectorClient({endpoint:ENDPOINT,origin:ORIGIN,fetchImpl,now:()=>NOW});
    await client.pair({approval:APPROVAL});
    const result=await client.request('/connector/v1/capabilities',{scope:'capabilities.read'});
    expect(result.ok).toBe(true);
    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toBe(`${ENDPOINT}/connector/v1/capabilities`);
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(options.headers.authorization).toBe('Bearer session-secret-value');
    expect(options.headers.Origin).toBe(ORIGIN);
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
    await client.pair({approval:APPROVAL});
    const result=await client.revoke();
    expect(result).toMatchObject({status:'revoked',session:{status:'revoked'}});
    const [url,options]=fetchImpl.mock.calls[1];
    expect(url).toBe(`${ENDPOINT}/connector/v1/session`);
    expect(options.method).toBe('DELETE');
    expect(options.headers.authorization).toBe('Bearer session-secret-value');
    expect(options.headers.Origin).toBe(ORIGIN);
    expect(client.state()).toBe('connection_required');
    expect(JSON.stringify(client.session())).not.toContain('session-secret-value');
  });
});
