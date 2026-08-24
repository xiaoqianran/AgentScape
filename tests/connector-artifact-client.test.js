import { describe, expect, it, vi } from 'vitest';
import { ConnectorArtifactClient } from '../src/connector/ConnectorArtifactClient.js';

describe('ConnectorArtifactClient',()=>{
  it('derives the artifact route from opaque ID and enforces artifacts.read scope',async()=>{
    const response={ok:true,status:200,redirected:false};
    const connectorClient={request:vi.fn(async()=>response),session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}}))};
    const client=new ConnectorArtifactClient({connectorClient});
    await expect(client.open('artifact_01',{accept:'model/gltf-binary',expectedConnector:{id:'unified-connector',instance:'instance_01'}})).resolves.toBe(response);
    expect(connectorClient.request).toHaveBeenCalledWith('/connector/v1/artifacts/artifact_01',{
      scope:'artifacts.read',method:'GET',headers:{accept:'model/gltf-binary'}
    });
  });

  it('rejects unsafe IDs before Connector transport',async()=>{
    const connectorClient={request:vi.fn(),session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}}))};
    const client=new ConnectorArtifactClient({connectorClient});
    await expect(client.open('../artifact')).rejects.toMatchObject({code:'ARTIFACT_ID_INVALID'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });

  it('rejects artifact transfer when the active Connector instance does not own the declared location',async()=>{
    const connectorClient={
      request:vi.fn(),
      session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_other'}}))
    };
    const client=new ConnectorArtifactClient({connectorClient});
    await expect(client.open('artifact_01',{
      expectedConnector:{id:'unified-connector',instance:'instance_01'}
    })).rejects.toMatchObject({code:'CONNECTOR_ARTIFACT_SOURCE_MISMATCH'});
    expect(connectorClient.request).not.toHaveBeenCalled();
  });

  it('fails closed on redirects and non-success responses',async()=>{
    const redirected=new ConnectorArtifactClient({connectorClient:{request:vi.fn(async()=>({ok:true,status:200,redirected:true})),session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}}))}});
    await expect(redirected.open('artifact_01')).rejects.toMatchObject({code:'CONNECTOR_ARTIFACT_REDIRECT'});
    const failed=new ConnectorArtifactClient({connectorClient:{request:vi.fn(async()=>({ok:false,status:404,redirected:false})),session:vi.fn(()=>({status:'paired',connector:{id:'unified-connector',instance:'instance_01'}}))}});
    await expect(failed.open('artifact_01')).rejects.toMatchObject({code:'CONNECTOR_ARTIFACT_HTTP_ERROR'});
  });
});
