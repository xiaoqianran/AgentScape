export const CONNECTOR_CONTRACT_VERSION = '1';
export const CONNECTOR_CLIENT_ID = 'agentscape';
export const CONNECTOR_SESSION_PATH = '/connector/v1/session';
export const CONNECTOR_SESSION_SCOPES = Object.freeze([
  'capabilities.read',
  'jobs.submit',
  'jobs.read',
  'jobs.cancel',
  'artifacts.read'
]);

const ALLOWED_SCOPE_SET = new Set(CONNECTOR_SESSION_SCOPES);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const clone = (value) => value == null ? value : structuredClone(value);

export class ConnectorContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ConnectorContractError';
    this.code = code;
    this.details = clone(details);
  }
}

const requireText = (value, field) => {
  const text = String(value ?? '').trim();
  if (!text) throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', `Connector response requires ${field}`, { field });
  return text;
};

export function normalizeConnectorEndpoint(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new ConnectorContractError('CONNECTOR_ENDPOINT_INVALID', 'Connector endpoint must be a valid URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorContractError('CONNECTOR_ENDPOINT_INVALID', 'Connector endpoint must use http or https');
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new ConnectorContractError('CONNECTOR_ENDPOINT_INVALID', 'Connector endpoint must be a bare loopback origin');
  }
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ConnectorContractError('CONNECTOR_ENDPOINT_NOT_LOOPBACK', 'AgentScape Connector must use a loopback host', { hostname:url.hostname });
  }
  return url.origin;
}

export function normalizeClientOrigin(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new ConnectorContractError('CONNECTOR_ORIGIN_REQUIRED', 'AgentScape client origin is required for pairing'); }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ConnectorContractError('CONNECTOR_ORIGIN_REQUIRED', 'AgentScape client origin must use http or https');
  }
  return url.origin;
}

export function normalizeRequestedScopes(scopes = CONNECTOR_SESSION_SCOPES) {
  const values = [...new Set((Array.isArray(scopes) ? scopes : [scopes]).map((scope) => String(scope || '').trim()).filter(Boolean))];
  if (!values.length) throw new ConnectorContractError('CONNECTOR_SCOPE_INVALID', 'Connector pairing requires at least one scope');
  const invalid = values.filter((scope) => !ALLOWED_SCOPE_SET.has(scope));
  if (invalid.length) {
    throw new ConnectorContractError('CONNECTOR_SCOPE_INVALID', 'AgentScape requested a scope outside the allowed Connector surface', { invalid });
  }
  return values;
}

function normalizeDate(value, field) {
  const text = requireText(value, field);
  const time = Date.parse(text);
  if (!Number.isFinite(time)) throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', `Connector response has invalid ${field}`, { field });
  return { text:new Date(time).toISOString(), time };
}

function normalizeAllowedOrigins(origins = []) {
  if (!Array.isArray(origins)) throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector allowedOrigins must be an array');
  return origins.map(normalizeClientOrigin);
}

export function normalizeConnectorSessionResponse(payload = {}, {
  origin,
  requestedScopes = CONNECTOR_SESSION_SCOPES,
  contractVersion = CONNECTOR_CONTRACT_VERSION,
  clientIdentity = CONNECTOR_CLIENT_ID,
  now = Date.now()
} = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector session response must be an object');
  }
  const token = requireText(payload.token, 'token');
  const session = payload.session;
  if (!session || typeof session !== 'object' || Array.isArray(session)) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector response requires session');
  }
  const connector = session.connector;
  if (!connector || typeof connector !== 'object' || Array.isArray(connector)) {
    throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector response requires connector identity');
  }

  const responseContractVersion = requireText(session.contractVersion, 'session.contractVersion');
  if (responseContractVersion !== String(contractVersion)) {
    throw new ConnectorContractError('CONNECTOR_CONTRACT_MISMATCH', 'Connector contract version is not compatible', {
      expected:String(contractVersion), actual:responseContractVersion
    });
  }
  const responseClientIdentity = requireText(session.clientIdentity, 'session.clientIdentity');
  if (responseClientIdentity !== clientIdentity) {
    throw new ConnectorContractError('CONNECTOR_CLIENT_MISMATCH', 'Connector session is bound to a different client identity', {
      expected:clientIdentity, actual:responseClientIdentity
    });
  }

  const requested = normalizeRequestedScopes(requestedScopes);
  const rawGranted = [...new Set((Array.isArray(session.scopes) ? session.scopes : [session.scopes])
    .map((scope) => String(scope || '').trim()).filter(Boolean))];
  if (!rawGranted.length) throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector session requires scopes');
  const escalation = rawGranted.filter((scope) => !ALLOWED_SCOPE_SET.has(scope) || !requested.includes(scope));
  if (escalation.length) {
    throw new ConnectorContractError('CONNECTOR_SCOPE_ESCALATION', 'Connector granted scopes that AgentScape did not request', { escalation });
  }
  const granted = rawGranted;

  const normalizedOrigin = normalizeClientOrigin(origin);
  const allowedOrigins = normalizeAllowedOrigins(session.allowedOrigins);
  if (!allowedOrigins.includes(normalizedOrigin)) {
    throw new ConnectorContractError('CONNECTOR_ORIGIN_MISMATCH', 'Connector session does not allow the current AgentScape origin', {
      origin:normalizedOrigin, allowedOrigins
    });
  }

  const issued = normalizeDate(session.issuedAt, 'session.issuedAt');
  const expires = normalizeDate(session.expiresAt, 'session.expiresAt');
  if (expires.time <= issued.time || expires.time <= now) {
    throw new ConnectorContractError('CONNECTOR_SESSION_EXPIRED', 'Connector session is already expired', { expiresAt:expires.text });
  }

  const descriptor = {
    connector: {
      id: requireText(connector.id, 'session.connector.id'),
      instance: requireText(connector.instance, 'session.connector.instance'),
      version: requireText(connector.version, 'session.connector.version')
    },
    contractVersion: responseContractVersion,
    clientIdentity: responseClientIdentity,
    tokenId: requireText(session.tokenId, 'session.tokenId'),
    scopes: granted,
    issuedAt: issued.text,
    expiresAt: expires.text,
    allowedOrigins,
    capabilityRevision: requireText(session.capabilityRevision, 'session.capabilityRevision'),
    capabilityHash: requireText(session.capabilityHash, 'session.capabilityHash'),
    revokeEndpoint: (() => {
      const endpoint = String(session.revokeEndpoint || CONNECTOR_SESSION_PATH);
      if (endpoint !== CONNECTOR_SESSION_PATH) {
        throw new ConnectorContractError('CONNECTOR_RESPONSE_INVALID', 'Connector revokeEndpoint does not match the v1 session contract', { endpoint });
      }
      return endpoint;
    })(),
    status: 'paired'
  };

  return { descriptor, token };
}

export class ConnectorSession {
  #descriptor;
  #token;
  #revoked = false;

  constructor(normalized) {
    this.#descriptor = clone(normalized.descriptor);
    this.#token = normalized.token;
  }

  snapshot(now = Date.now()) {
    const status = this.#revoked ? 'revoked' : (Date.parse(this.#descriptor.expiresAt) <= now ? 'expired' : 'paired');
    return { ...clone(this.#descriptor), status };
  }

  isActive(now = Date.now()) {
    return !this.#revoked && Date.parse(this.#descriptor.expiresAt) > now;
  }

  assertActive(scope = null, now = Date.now()) {
    if (this.#revoked) throw new ConnectorContractError('CONNECTOR_SESSION_REVOKED', 'Connector session has been revoked');
    if (!this.isActive(now)) throw new ConnectorContractError('CONNECTION_REQUIRED', 'Connector session has expired');
    if (scope && !this.#descriptor.scopes.includes(scope)) {
      throw new ConnectorContractError('CONNECTOR_SCOPE_REQUIRED', 'Connector session does not grant the required scope', { scope });
    }
    return true;
  }

  authorizationValue(scope = null, now = Date.now()) {
    this.assertActive(scope, now);
    return `Bearer ${this.#token}`;
  }

  revoke() {
    this.#revoked = true;
    this.#token = '';
  }
}
