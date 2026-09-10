export const CAPABILITY_API = Object.freeze({
  status: '/api/capabilities',
  agent: '/api/capabilities/agent',
  assetCompile: '/api/capabilities/asset-compile'
});

export const LOCAL_ADAPTER_HOST = Object.freeze({
  connector: 'http://127.0.0.1:48123'
});

export const LEGACY_ENDPOINT_STORAGE_KEYS = Object.freeze([
  'agentscape.gatewayEndpoint',
  'agentscape.compilerEndpoint',
  'agentscape.assetGeneratorEndpoint',
  'agentscape.connectorEndpoint'
]);

export function clearLegacyEndpointOverrides(storage = globalThis.localStorage) {
  for (const key of LEGACY_ENDPOINT_STORAGE_KEYS) {
    try { storage?.removeItem?.(key); } catch {}
  }
}

export async function readCapabilityStatus({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(CAPABILITY_API.status, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`能力状态 HTTP ${response.status}`);
    return normalizeCapabilityStatus(await response.json());
  } catch (error) {
    return unavailableCapabilityStatus(error?.name === 'AbortError' ? '能力状态检查超时' : '能力状态不可用');
  } finally {
    clearTimeout(timer);
  }
}

export function applyCapabilityStatus({ gateway, generation } = {}, status = unavailableCapabilityStatus()) {
  gateway?.setEndpoint?.(status.agent?.available ? CAPABILITY_API.agent : '');
  generation?.setCompilerEndpoint?.(status.assetCompile?.available ? CAPABILITY_API.assetCompile : '');
  return status;
}

export function normalizeCapabilityStatus(payload = {}) {
  const capabilities = payload?.capabilities || {};
  return {
    source: 'server',
    agent: normalizeCapability(capabilities.agent),
    assetCompile: normalizeCapability(capabilities['asset.compile'])
  };
}

export function unavailableCapabilityStatus(reason = '能力状态不可用') {
  return {
    source: 'unavailable',
    reason,
    agent: { available: false },
    assetCompile: { available: false }
  };
}

function normalizeCapability(value) {
  return { available: Boolean(value?.available) };
}
