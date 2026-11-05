const SAFE_FORWARD_HEADERS = new Set(['accept', 'content-type']);
export const INVOKE_TIMEOUT_MS = 120_000;
export const HEALTH_TIMEOUT_MS = 3_000;
export const HEALTH_SLOW_MS = 1_500;

export const CAPABILITIES = Object.freeze({
  AGENT: 'agent',
  ASSET_COMPILE: 'asset.compile'
});

export const DEPLOYMENT_ADAPTERS = Object.freeze({
  [CAPABILITIES.AGENT]: Object.freeze({
    urlEnv: 'AGENT_ADAPTER_URL',
    authorizationEnv: 'AGENT_ADAPTER_AUTHORIZATION',
    healthUrlEnv: 'AGENT_ADAPTER_HEALTH_URL'
  }),
  [CAPABILITIES.ASSET_COMPILE]: Object.freeze({
    urlEnv: 'ASSET_COMPILE_ADAPTER_URL',
    authorizationEnv: 'ASSET_COMPILE_ADAPTER_AUTHORIZATION',
    healthUrlEnv: 'ASSET_COMPILE_ADAPTER_HEALTH_URL'
  })
});

export function capabilityAvailability(env = process.env) {
  return Object.fromEntries(Object.entries(DEPLOYMENT_ADAPTERS).map(([capability, adapter]) => [
    capability,
    { available: Boolean(normalizeTarget(env[adapter.urlEnv])) }
  ]));
}

export async function invokeCapability(req, res, capability, { env = process.env, fetchImpl = fetch, timeoutMs = INVOKE_TIMEOUT_MS } = {}) {
  if (req.method !== 'POST') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' }, { allow: 'POST' });
  const adapter = DEPLOYMENT_ADAPTERS[capability];
  if (!adapter) return sendJson(res, 404, { code: 'CAPABILITY_NOT_FOUND' });
  const target = normalizeTarget(env[adapter.urlEnv]);
  if (!target) return sendJson(res, 503, { code: 'CAPABILITY_UNAVAILABLE' });

  const controller = new AbortController();
  const disconnected=()=>{ if (!res.writableEnded) controller.abort(); };
  res.once?.('close',disconnected);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = await requestBody(req);
    const response = await fetchImpl(target, {
      method: 'POST',
      headers: forwardHeaders(req.headers, env[adapter.authorizationEnv]),
      body,
      redirect: 'error',
      signal: controller.signal
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (res.destroyed) return;
    res.statusCode = response.status;
    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);
    res.setHeader('cache-control', 'no-store');
    res.end(bytes);
  } catch (error) {
    if (res.headersSent || res.writableEnded || res.destroyed) return;
    if (error?.name === 'AbortError') return sendJson(res, 504, { code: 'ADAPTER_TIMEOUT', message: safeMessage(error) });
    sendJson(res, 502, { code: 'ADAPTER_UNAVAILABLE', message: safeMessage(error) });
  } finally {
    clearTimeout(timer);
    res.removeListener?.('close',disconnected);
  }
}

/**
 * Probe each configured adapter's health endpoint from the server.
 * Never returns URLs, headers, or upstream bodies: only state, latency and a reason code.
 * state: unconfigured | ok | slow | down
 */
export async function probeCapabilities(env = process.env, { fetchImpl = fetch, timeoutMs = HEALTH_TIMEOUT_MS, now = () => Date.now() } = {}) {
  const entries = await Promise.all(Object.entries(DEPLOYMENT_ADAPTERS).map(async ([capability, adapter]) => {
    const checkedAt = new Date(now()).toISOString();
    const invokeTarget = normalizeTarget(env[adapter.urlEnv]);
    if (!invokeTarget) {
      return [capability, { available: false, state: 'unconfigured', latencyMs: null, reason: 'NOT_CONFIGURED', checkedAt }];
    }
    const healthTarget = normalizeTarget(env[adapter.healthUrlEnv]) || new URL('/health', invokeTarget).toString();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    try {
      const response = await fetchImpl(healthTarget, {
        method: 'GET',
        headers: forwardHeaders({ accept: 'application/json' }, env[adapter.authorizationEnv]),
        redirect: 'error',
        signal: controller.signal
      });
      const latencyMs = Math.max(0, now() - started);
      if (!response.ok) {
        return [capability, { available: true, state: 'down', latencyMs, reason: 'HTTP_' + response.status, checkedAt }];
      }
      return [capability, { available: true, state: latencyMs > HEALTH_SLOW_MS ? 'slow' : 'ok', latencyMs, reason: null, checkedAt }];
    } catch (error) {
      return [capability, { available: true, state: 'down', latencyMs: null, reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE', checkedAt }];
    } finally {
      clearTimeout(timer);
    }
  }));
  return Object.fromEntries(entries);
}

export async function sendCapabilityHealth(req, res, env = process.env, options = {}) {
  if (req.method !== 'GET') return sendJson(res, 405, { code: 'METHOD_NOT_ALLOWED' }, { allow: 'GET' });
  return sendJson(res, 200, { capabilities: await probeCapabilities(env, options) });
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
