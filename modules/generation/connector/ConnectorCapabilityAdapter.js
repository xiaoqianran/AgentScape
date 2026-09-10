import { ConnectorContractError } from './ConnectorSession.js';
import { normalizeProviderDescriptor } from '../providers/ProviderRegistry.js';

export const CONNECTOR_CAPABILITIES_PATH = '/connector/v1/capabilities';

const SECRET_KEY = /(authorization|api[-_]?key|access[-_]?token|refresh[-_]?token|secret|credential)/i;
const clone = (value) => value == null ? value : structuredClone(value);

const requireText = (value, field) => {
  const text=String(value ?? '').trim();
  if (!text) throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', `Capability snapshot requires ${field}`, { field });
  return text;
};

function assertNoSecretFields(value, path='snapshot') {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item,index)=>assertNoSecretFields(item,`${path}[${index}]`));
    return;
  }
  for (const [key,item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_SECRET_FIELD', 'Capability snapshot contains a secret-like field', { path:`${path}.${key}` });
    }
    assertNoSecretFields(item,`${path}.${key}`);
  }
}

function normalizeTime(value, field) {
  const text=requireText(value,field);
  const time=Date.parse(text);
  if (!Number.isFinite(time)) throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', `Capability snapshot has invalid ${field}`, { field });
  return { text:new Date(time).toISOString(), time };
}

function canonicalProvider(provider) {
  if (!provider || typeof provider !== 'object' || Array.isArray(provider)) {
    throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Capability provider must be an object');
  }
  const capabilities=Array.isArray(provider.capabilities) ? provider.capabilities.map((capability)=>({
    ...capability,
    prerequisites:{
      authMode:'connector-session',
      connection:true,
      license:capability?.prerequisites?.license || null
    }
  })) : provider.capabilities;
  try {
    return normalizeProviderDescriptor({ ...provider, capabilities });
  } catch (error) {
    throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', error?.message || 'Invalid provider capability descriptor');
  }
}

async function readJson(response) {
  const payload=await response.json().catch(()=>null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Connector returned invalid capability JSON');
  }
  return payload;
}

export class ConnectorCapabilityAdapter {
  constructor({ now=()=>Date.now() }={}) { this.now=now; }

  normalizeSnapshot(payload, session) {
    if (!session || session.status !== 'paired') {
      throw new ConnectorContractError('CONNECTION_REQUIRED', 'A paired Connector session is required for capability discovery');
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Capability snapshot must be an object');
    }
    assertNoSecretFields(payload);
    const contractVersion=requireText(payload.contractVersion,'contractVersion');
    if (contractVersion !== session.contractVersion) {
      throw new ConnectorContractError('CONNECTOR_CONTRACT_MISMATCH', 'Capability snapshot contract version does not match the paired session', {
        expected:session.contractVersion,actual:contractVersion
      });
    }
    const connector=payload.connector;
    if (!connector || typeof connector !== 'object' || Array.isArray(connector)) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Capability snapshot requires connector identity');
    }
    const normalizedConnector={
      id:requireText(connector.id,'connector.id'),
      instance:requireText(connector.instance,'connector.instance'),
      version:requireText(connector.version,'connector.version')
    };
    for (const field of ['id','instance','version']) {
      if (normalizedConnector[field] !== session.connector?.[field]) {
        throw new ConnectorContractError('CONNECTOR_CAPABILITY_CONNECTOR_MISMATCH', 'Capability snapshot belongs to a different Connector', {
          field,expected:session.connector?.[field],actual:normalizedConnector[field]
        });
      }
    }
    const revision=requireText(payload.revision,'revision');
    const hash=requireText(payload.hash,'hash');
    if (revision !== session.capabilityRevision) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_REVISION_MISMATCH', 'Capability revision does not match the paired session', {
        expected:session.capabilityRevision,actual:revision
      });
    }
    if (hash !== session.capabilityHash) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_HASH_MISMATCH', 'Capability hash does not match the paired session', {
        expected:session.capabilityHash,actual:hash
      });
    }
    const generated=normalizeTime(payload.generatedAt,'generatedAt');
    const expires=payload.expiresAt ? normalizeTime(payload.expiresAt,'expiresAt') : null;
    if (expires && expires.time <= generated.time) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Capability snapshot expiresAt must be after generatedAt', {
        generatedAt:generated.text,expiresAt:expires.text
      });
    }
    if (expires && expires.time <= this.now()) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_EXPIRED', 'Capability snapshot is already expired', { expiresAt:expires.text });
    }
    if (!Array.isArray(payload.providers)) {
      throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', 'Capability snapshot requires providers array');
    }
    const providers=payload.providers.map(canonicalProvider);
    const ids=new Set();
    for (const provider of providers) {
      if (ids.has(provider.id)) throw new ConnectorContractError('CONNECTOR_CAPABILITY_INVALID', `Duplicate capability provider: ${provider.id}`);
      ids.add(provider.id);
    }
    return {
      contractVersion,
      connector:normalizedConnector,
      sourceId:`connector:${normalizedConnector.id}`,
      revision,
      hash,
      generatedAt:generated.text,
      expiresAt:expires?.text || null,
      cachePolicy:clone(payload.cachePolicy || null),
      providers
    };
  }

  async fetchSnapshot(connectorClient) {
    const session=connectorClient?.session?.();
    if (!session || session.status !== 'paired') {
      throw new ConnectorContractError('CONNECTION_REQUIRED', 'Connector pairing is required before capability discovery');
    }
    const response=await connectorClient.request(CONNECTOR_CAPABILITIES_PATH,{scope:'capabilities.read'});
    const payload=await readJson(response);
    if (!response.ok) {
      throw new ConnectorContractError(payload.code || 'CONNECTOR_CAPABILITY_HTTP_ERROR', payload.message || `Connector HTTP ${response.status}`, { status:response.status });
    }
    return this.normalizeSnapshot(payload,session);
  }

  applySnapshot(registry, snapshot) {
    if (!registry?.applyProviderSnapshot) throw new ConnectorContractError('CONNECTOR_CAPABILITY_REGISTRY_INVALID', 'ProviderRegistry snapshot API is required');
    return registry.applyProviderSnapshot(snapshot,{sourceId:snapshot.sourceId,sourceKind:'connector'});
  }

  async refresh(connectorClient, registry) {
    const snapshot=await this.fetchSnapshot(connectorClient);
    const state=this.applySnapshot(registry,snapshot);
    return { snapshot,state };
  }

  clearForSession(registry, session) {
    const connectorId=String(session?.connector?.id || '').trim();
    if (!connectorId) throw new ConnectorContractError('CONNECTOR_CAPABILITY_SESSION_INVALID', 'Connector session identity is required to clear capabilities');
    return registry.clearProviderSnapshot(`connector:${connectorId}`);
  }
}
