import http from 'node:http';
import fs from 'node:fs';

export const DEFAULT_BASE_URL = 'https://newapi-jp1.202820.xyz/v1';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 8788;
export const DEFAULT_MODELS = Object.freeze([
  'openai/gpt-oss-120b',
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'stepfun-ai/step-3.7-flash'
]);
export const DEFAULT_MODEL = DEFAULT_MODELS[0];
export const ALTERNATE_MODEL = DEFAULT_MODELS[1];

const normalizeModels = ({ model, models } = {}) => {
  const values = Array.isArray(models) ? models : typeof models === 'string' ? models.split(',') : model ? [model] : DEFAULT_MODELS;
  const normalized = [...new Set(values.flatMap((value) => String(value || '').split(',')).map((value) => value.trim()).filter(Boolean))];
  if (!normalized.length) throw new Error('At least one LLM model is required');
  return normalized;
};

const retryableUpstreamStatus = (status) => status === 408 || status === 425 || status === 429 || status >= 500;

export function loadEnvFile(path = '.env.local', target = process.env) {
  if (!fs.existsSync(path)) return false;
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const split = value.indexOf('=');
    if (split <= 0) continue;
    const key = value.slice(0, split).trim();
    if (target[key] != null) continue;
    let raw = value.slice(split + 1).trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) raw = raw.slice(1, -1);
    target[key] = raw;
  }
  return true;
}

export function toOpenAITools(tools = []) {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || { type: 'object', properties: {} }
    }
  }));
}

export function toOpenAIMessages(messages = []) {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content ?? '' };
    }
    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      return {
        role: 'assistant',
        content: message.content || null,
        tool_calls: message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: JSON.stringify(call.args || {}) }
        }))
      };
    }
    return { role: message.role, content: message.content ?? '' };
  });
}

const parseArgs = (value, name) => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('arguments must decode to an object');
    return parsed;
  } catch (error) {
    throw new Error(`Model returned invalid JSON arguments for ${name}: ${error.message}`);
  }
};

export function fromOpenAIResponse(payload = {}) {
  const choice = payload.choices?.[0] || {};
  const message = choice.message || {};
  const toolCalls = (message.tool_calls || []).map((call, index) => ({
    id: call.id || `call_${index}`,
    name: call.function?.name,
    args: parseArgs(call.function?.arguments, call.function?.name || `call_${index}`)
  }));
  return {
    message: message.content || '',
    final: toolCalls.length === 0 && Boolean(message.content),
    toolCalls
  };
}

export function createUpstreamPayload(request, model = DEFAULT_MODEL) {
  const messages = toOpenAIMessages(request.messages || []);
  if (request.context && Object.keys(request.context).length) {
    const contextMessage = {
      role:'system',
      content:`AgentScape current read-only request context (tools remain authoritative): ${JSON.stringify(request.context)}`
    };
    messages.splice(messages[0]?.role === 'system' ? 1 : 0, 0, contextMessage);
  }
  return {
    model,
    temperature: 0,
    stream: false,
    messages,
    tools: toOpenAITools(request.tools || []),
    tool_choice: 'auto'
  };
}

export function isAllowedOrigin(origin, extraOrigins = []) {
  if (!origin || !extraOrigins.length) return true;
  try {
    const url = new URL(origin);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) return true;
  } catch {}
  return extraOrigins.includes(origin);
}

const json = (response, status, payload, origin = null) => {
  const body = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST,GET,OPTIONS',
    vary: 'Origin'
  };
  if (origin) headers['access-control-allow-origin'] = origin;
  response.writeHead(status, headers);
  response.end(body);
};

const readJson = async (request, maxBytes = 2 * 1024 * 1024) => {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('Gateway request is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

export function createAgentGateway({ baseUrl, apiKey, model, models, fetchImpl = fetch } = {}) {
  if (!baseUrl) throw new Error('AGENTSCAPE_LLM_BASE_URL is required');
  if (!apiKey) throw new Error('AGENTSCAPE_LLM_API_KEY is required');
  const chatUrl = `${String(baseUrl).replace(/\/$/, '')}/chat/completions`;
  const modelChain = normalizeModels({ model, models });

  return async (request) => {
    let lastError = null;
    for (let index = 0; index < modelChain.length; index++) {
      const currentModel = modelChain[index];
      let upstream;
      try {
        upstream = await fetchImpl(chatUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(createUpstreamPayload(request, currentModel))
        });
      } catch (error) {
        lastError = new Error(`OpenAI-compatible upstream transport failed for ${currentModel}: ${error.message}`);
        if (index + 1 < modelChain.length) continue;
        throw lastError;
      }
      const payload = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const detail = payload.error?.message || `HTTP ${upstream.status}`;
        lastError = new Error(`OpenAI-compatible upstream failed for ${currentModel}: ${detail}`);
        if (retryableUpstreamStatus(upstream.status) && index + 1 < modelChain.length) continue;
        throw lastError;
      }
      return fromOpenAIResponse(payload);
    }
    throw lastError || new Error('OpenAI-compatible upstream failed');
  };
}

export function startServer(options = {}) {
  const host = options.host || DEFAULT_HOST;
  const port = Number(options.port ?? DEFAULT_PORT);
  const complete = createAgentGateway(options);
  const extraOrigins = Array.isArray(options.allowedOrigins) ? options.allowedOrigins : [];
  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin || null;
    if (!isAllowedOrigin(origin, extraOrigins)) return json(response, 403, { error:'Origin not allowed' });
    if (request.method === 'OPTIONS') return json(response, 204, {}, origin);
    if (request.method === 'GET' && request.url === '/health') {
      const models=normalizeModels(options);
      return json(response, 200, { ok:true, model:models[0], models }, origin);
    }
    if (request.method !== 'POST' || request.url !== '/agent') return json(response, 404, { error:'Not found' }, origin);
    try {
      const body = await readJson(request);
      json(response, 200, await complete(body), origin);
    } catch (error) {
      json(response, 502, { error:error.message }, origin);
    }
  });
  server.listen(port, host, () => {
    if (!options.quiet) console.log(`AgentScape LLM gateway · http://${host}:${server.address().port}/agent · models=${normalizeModels(options).join(',')}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loadEnvFile();
  startServer({
    baseUrl: process.env.AGENTSCAPE_LLM_BASE_URL || process.env.AGENTSCAPE_TEST_LLM_BASE_URL || DEFAULT_BASE_URL,
    apiKey: process.env.AGENTSCAPE_LLM_API_KEY || process.env.AGENTSCAPE_TEST_LLM_API_KEY,
    models: process.env.AGENTSCAPE_LLM_MODELS || process.env.AGENTSCAPE_TEST_LLM_MODELS || undefined,
    model: process.env.AGENTSCAPE_LLM_MODEL || process.env.AGENTSCAPE_TEST_LLM_MODEL || undefined,
    host: process.env.AGENTSCAPE_LLM_HOST || process.env.AGENTSCAPE_TEST_LLM_HOST || DEFAULT_HOST,
    port: process.env.AGENTSCAPE_LLM_PORT || process.env.AGENTSCAPE_TEST_LLM_PORT || DEFAULT_PORT,
    allowedOrigins:(process.env.AGENTSCAPE_ALLOWED_ORIGINS ?? process.env.AGENTSCAPE_TEST_LLM_ALLOWED_ORIGINS ?? '').split(',').map((value)=>value.trim()).filter(Boolean)
  });
}
