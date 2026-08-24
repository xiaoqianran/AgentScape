import { ConnectorContractError } from './ConnectorSession.js';
import { requireSafeArtifactId } from '../artifacts/ArtifactDescriptor.js';

const ARTIFACTS_PATH='/connector/v1/artifacts';

export class ConnectorArtifactClient {
  constructor({connectorClient}={}) {
    if (!connectorClient?.request || !connectorClient?.session) throw new ConnectorContractError('CONNECTOR_ARTIFACT_CLIENT_INVALID','ConnectorArtifactClient requires ConnectorClient with paired session snapshots');
    this.connectorClient=connectorClient;
  }

  async open(artifactId,{accept='application/octet-stream',expectedConnector=null}={}) {
    const id=requireSafeArtifactId(artifactId);
    if (expectedConnector) {
      const session=this.connectorClient.session();
      if (!session || session.status!=='paired') throw new ConnectorContractError('CONNECTION_REQUIRED','Paired Connector session is required for artifact transfer');
      if (session.connector?.id!==expectedConnector.id || session.connector?.instance!==expectedConnector.instance) {
        throw new ConnectorContractError('CONNECTOR_ARTIFACT_SOURCE_MISMATCH','Artifact source belongs to a different Connector instance',{
          expected:{id:expectedConnector.id,instance:expectedConnector.instance},
          actual:session.connector?{id:session.connector.id,instance:session.connector.instance}:null
        });
      }
    }
    const response=await this.connectorClient.request(`${ARTIFACTS_PATH}/${id}`,{
      scope:'artifacts.read',method:'GET',headers:{accept:String(accept||'application/octet-stream')}
    });
    if (response?.redirected) throw new ConnectorContractError('CONNECTOR_ARTIFACT_REDIRECT','Connector artifact response must not redirect',{status:response.status});
    if (!response?.ok) throw new ConnectorContractError('CONNECTOR_ARTIFACT_HTTP_ERROR',`Connector artifact HTTP ${response?.status ?? 'unknown'}`,{status:response?.status ?? null});
    return response;
  }
}
