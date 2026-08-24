import {
  CONNECTOR_CLIENT_ID,
  CONNECTOR_CONTRACT_VERSION,
  CONNECTOR_SESSION_SCOPES,
  CONNECTOR_SESSION_PATH,
  ConnectorContractError,
  ConnectorSession,
  normalizeClientOrigin,
  normalizeConnectorEndpoint,
  normalizeConnectorSessionResponse,
  normalizeRequestedScopes
} from './ConnectorSession.js';



function normalizeConnectorPath(path) {
  const value = String(path || '').trim();
  let decoded = value;
  try { decoded = decodeURIComponent(value); }
  catch { throw new ConnectorContractError('CONNECTOR_PATH_INVALID', 'Connector request path contains invalid encoding', { path:value }); }
  const segments = decoded.split('/');
  if (
    !value.startsWith('/connector/v1/')
    || value.includes('://')
    || value.includes('\\')
    || value.includes('?')
    || value.includes('#')
    || segments.includes('..')
    || segments.includes('.')
  ) {
    throw new ConnectorContractError('CONNECTOR_PATH_INVALID', 'Connector request must stay within /connector/v1/*', { path:value });
  }
  return value;
}

async function fetchConnector(fetchImpl, url, options) {
  try { return await fetchImpl(url, options); }
  catch (error) {
    throw new ConnectorContractError('CONNECTION_REQUIRED', 'Connector is not reachable', {
      recoverable:true,
      cause:error instanceof Error ? error.message : String(error)
    });
  }
}

function normalizeApprovalRequired(payload, expectedContractVersion) {
  const pairingId = String(payload.pairingId || '').trim();
  if (!pairingId) throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector approval response requires pairingId');
  const contractVersion = String(payload.contractVersion || '').trim();
  if (!contractVersion || contractVersion !== String(expectedContractVersion)) {
    throw new ConnectorContractError('CONNECTOR_CONTRACT_MISMATCH', 'Connector approval response has an incompatible contract version', {
      expected:String(expectedContractVersion), actual:contractVersion || null
    });
  }
  const connector = payload.connector;
  if (!connector || typeof connector !== 'object' || Array.isArray(connector)) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector approval response requires connector identity');
  }
  const normalizedConnector = {
    id:String(connector.id || '').trim(),
    instance:String(connector.instance || '').trim(),
    version:String(connector.version || '').trim()
  };
  if (!normalizedConnector.id || !normalizedConnector.instance || !normalizedConnector.version) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector approval response requires connector id, instance, and version');
  }
  return { status:'approval_required', pairingId, connector:normalizedConnector, contractVersion };
}

function normalizeCallerHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new ConnectorContractError('CONNECTOR_REQUEST_INVALID', 'Connector request headers must be an object');
  }
  const normalized={};
  for (const [key,value] of Object.entries(headers)) {
    if (key.toLowerCase() === 'authorization') {
      throw new ConnectorContractError('CONNECTOR_AUTH_HEADER_FORBIDDEN', 'Connector authorization is managed by the session boundary');
    }
    normalized[key]=value;
  }
  return normalized;
}

async function readJson(response) {
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector returned an invalid JSON response');
  }
  return payload;
}

export class ConnectorClient {
  #session = null;

  constructor({
    endpoint,
    origin = globalThis.location?.origin,
    fetchImpl = fetch,
    scopes = CONNECTOR_SESSION_SCOPES,
    contractVersion = CONNECTOR_CONTRACT_VERSION,
    clientIdentity = CONNECTOR_CLIENT_ID,
    now = () => Date.now()
  } = {}) {
    this.endpoint = normalizeConnectorEndpoint(endpoint);
    this.origin = normalizeClientOrigin(origin);
    this.fetchImpl = fetchImpl;
    this.scopes = normalizeRequestedScopes(scopes);
    this.contractVersion = String(contractVersion);
    this.clientIdentity = String(clientIdentity);
    this.now = now;
  }

  session() { return this.#session?.snapshot(this.now()) || null; }

  state() {
    return this.#session?.isActive(this.now()) ? 'paired' : 'connection_required';
  }

  isPaired() { return this.state() === 'paired'; }

  async pair({ pairingId = null } = {}) {
    const body = {
      clientIdentity: this.clientIdentity,
      contractVersion: this.contractVersion,
      origin: this.origin,
      scopes: [...this.scopes],
      ...(pairingId ? { pairingId:String(pairingId) } : {})
    };
    const response = await fetchConnector(this.fetchImpl, `${this.endpoint}${CONNECTOR_SESSION_PATH}`, {
      method:'POST',
      headers:{ 'content-type':'application/json', accept:'application/json' },
      body:JSON.stringify(body),
      credentials:'omit'
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new ConnectorContractError(payload.code || 'CONNECTOR_HTTP_ERROR', payload.message || `Connector HTTP ${response.status}`, {
        status:response.status
      });
    }
    if (payload.status === 'approval_required') {
      this.#session = null;
      return normalizeApprovalRequired(payload, this.contractVersion);
    }
    if (payload.status !== 'paired') {
      throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector session response must be paired or approval_required');
    }
    const normalized = normalizeConnectorSessionResponse(payload, {
      origin:this.origin,
      requestedScopes:this.scopes,
      contractVersion:this.contractVersion,
      clientIdentity:this.clientIdentity,
      now:this.now()
    });
    this.#session = new ConnectorSession(normalized);
    return { status:'paired', session:this.#session.snapshot(this.now()) };
  }

  async request(path, { scope, method='GET', headers={}, body } = {}) {
    if (!this.#session) throw new ConnectorContractError('CONNECTION_REQUIRED', 'Connector pairing is required');
    if (!scope) throw new ConnectorContractError('CONNECTOR_SCOPE_REQUIRED', 'Connector request requires an explicit scope');
    const normalizedPath = normalizeConnectorPath(path);
    const callerHeaders = normalizeCallerHeaders(headers);
    const authorization = this.#session.authorizationValue(scope, this.now());
    return fetchConnector(this.fetchImpl, `${this.endpoint}${normalizedPath}`, {
      method,
      headers:{ ...callerHeaders, authorization },
      ...(body === undefined ? {} : { body }),
      credentials:'omit',
      redirect:'error'
    });
  }

  async revoke() {
    if (!this.#session) return { status:'connection_required' };
    const authorization = this.#session.authorizationValue(null, this.now());
    const response = await fetchConnector(this.fetchImpl, `${this.endpoint}${CONNECTOR_SESSION_PATH}`, {
      method:'DELETE',
      headers:{ authorization, accept:'application/json' },
      credentials:'omit'
    });
    const payload = await readJson(response);
    if (!response.ok) {
      throw new ConnectorContractError(payload.code || 'CONNECTOR_HTTP_ERROR', payload.message || `Connector HTTP ${response.status}`, {
        status:response.status
      });
    }
    this.#session.revoke();
    return { status:'revoked', session:this.#session.snapshot(this.now()) };
  }

  disconnect() {
    if (this.#session) this.#session.revoke();
    this.#session = null;
    return { status:'connection_required' };
  }
}
