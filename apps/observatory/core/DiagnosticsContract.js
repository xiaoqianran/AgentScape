// Diagnostics is a read-only projection. It does not own or mutate runtime truth.
export const DIAGNOSTICS_SCHEMA = 'agentscape.observatory.diagnostics';
export const DIAGNOSTICS_VERSION = 1;

export function normalizeDiagnostics({inspector = null, metrics = {}, assertions = [], capabilities = {}} = {}) {
  return {
    schema: DIAGNOSTICS_SCHEMA,
    version: DIAGNOSTICS_VERSION,
    inspector: inspector && typeof inspector === 'object' ? {
      title: String(inspector.title || 'Runtime'), kind: String(inspector.kind || ''),
      values: {...(inspector.values || {})}
    } : null,
    metrics: {...(metrics || {})},
    assertions: Array.isArray(assertions) ? [...assertions] : [],
    capabilities: {
      gpu: Boolean(capabilities.gpu),
      tools: Boolean(capabilities.tools),
      resources: Boolean(capabilities.resources),
      layers: Array.isArray(capabilities.layers) ? [...capabilities.layers] : []
    }
  };
}
