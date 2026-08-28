const SAFE_FORWARD_HEADERS = new Set(['accept', 'content-type']);

export const CAPABILITIES = Object.freeze({
  AGENT: 'agent',
  ASSET_COMPILE: 'asset.compile',
  ASSET_GENERATE: 'asset.generate'
});

export const DEPLOYMENT_ADAPTERS = Object.freeze({
  [CAPABILITIES.AGENT]: Object.freeze({
    urlEnv: 'AGENT_ADAPTER_URL',
    authorizationEnv: 'AGENT_ADAPTER_AUTHORIZATION'
  }),
  [CAPABILITIES.ASSET_COMPILE]: Object.freeze({
    urlEnv: 'ASSET_COMPILE_ADAPTER_URL',
    authorizationEnv: 'ASSET_COMPILE_ADAPTER_AUTHORIZATION'
  }),
  [CAPABILITIES.ASSET_GENERATE]: Object.freeze({
    urlEnv: 'ASSET_GENERATE_ADAPTER_URL',
    authorizationEnv: 'ASSET_GENERATE_ADAPTER_AUTHORIZATION'
  })
});

export function capabilityAvailability(env = process.env) {
  return Object.fromEntries(Object.entries(DEPLOYMENT_ADAPTERS).map(([capability, adapter]) => [
    capability,
    { available: Boolean(normalizeTarget(env[adapter.urlEnv])) }
  ]));
}

export async function invokeCapability(req, res, capability, { env = process.env, fetchImpl = fetch } = {}) {
  if (req.method !== 'POST') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' });
  const adapter = DEPLOYMENT_ADAPTERS[capability];
  if (!adapter) return sendJson(res, 404, { code: 'CAPABILITY_NOT_FOUND' });
  const target = normalizeTarget(env[adapter.urlEnv]);
  if (!target) return sendJson(res, 503, { code: 'CAPABILITY_UNAVAILABLE' });

  try {
    const body = await requestBody(req);
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: forwardHeaders(req.headers, env[adapter.authorizationEnv]),
      body,
      redirect: 'error'
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    res.statusCode = response.status;
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-store');
    res.end(bytes);
  } catch (error) {
    sendJson(res, 502, { code: 'ADAPTER_UNAVAILABLE', message: safeMessage(error) });
  }
}

export function sendCapabilityStatus(req, res, env = process.env) {
  if (req.method !== 'GET') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' });
  return sendJson(res, 200, { capabilities: capabilityAvailability(env) });
}

function forwardHeaders(headers = {}, deploymentAuthorization = '') {
  const forwarded = {};
  for (const [key, value] of Object.entries(headers)) {
    if (SAFE_FORWARD_HEADERS.has(key.toLowerCase()) && value) forwarded[key.toLowerCase()] = String(value);
  }
  const authorization = String(deploymentAuthorization || '').trim();
  if (authorization) forwarded.authorization = authorization;
  return forwarded;
}

async function requestBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  if (req.body && typeof req.body === 'object') {
    const type = String(req.headers?.['content-type'] || '');
    if (type.includes('application/json')) return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function normalizeTarget(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch { return null; }
}

function safeMessage(error) {
  return error?.name === 'AbortError' ? '适配器请求超时' : '适配器不可用';
}

function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  res.end(JSON.stringify(payload));
}
