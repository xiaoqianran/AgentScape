const STORAGE_KEY = 'agentscape.demo.generated-placement.v1';
const TERMINAL_FAILURES = new Set(['generation-failed', 'generation-cancelled', 'generation-expired']);

const clone = (value) => value == null ? value : structuredClone(value);

function loadState(storage) {
  try {
    const value = JSON.parse(storage?.getItem?.(STORAGE_KEY) || 'null');
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}

function saveState(storage, state) {
  storage?.setItem?.(STORAGE_KEY, JSON.stringify(state));
  return state;
}

function clearState(storage) { storage?.removeItem?.(STORAGE_KEY); }

function pickCapability(generation, category, inputType) {
  return generation.listGenerationCapabilities({ availableOnly: true }).capabilities
    .find((capability) => String(capability.category || '').includes(category) && capability.input?.types?.includes(inputType)) || null;
}

function preferredProfile(capability) {
  const profiles = capability?.profiles || {};
  return Object.hasOwn(profiles, 'recommended') ? 'recommended' : Object.keys(profiles)[0] || null;
}

function requiredRoles(capability) {
  return [...(capability?.output?.required?.length ? capability.output.required : capability?.output?.roles || [])];
}

function defaultedInputs(capability, seed) {
  const inputs = { ...seed };
  for (const key of capability?.input?.schema?.required || []) {
    if (inputs[key] !== undefined) continue;
    const property = capability.input.schema.properties?.[key];
    if (property?.default !== undefined) inputs[key] = clone(property.default);
    else if (Array.isArray(property?.enum) && property.enum.length) inputs[key] = clone(property.enum[0]);
    else throw new Error(`生成能力缺少必需输入默认值：${key}`);
  }
  return inputs;
}

export class GeneratedPlacementDemoRunner {
  constructor({ world, storage = globalThis.localStorage, log = () => {}, pollIntervalMs = 1500 } = {}) {
    if (!world?.generation || !world?.interactions) throw new Error('GeneratedPlacementDemoRunner requires generation and interaction runtime');
    this.world = world;
    this.storage = storage;
    this.log = log;
    this.pollIntervalMs = pollIntervalMs;
  }

  state() { return loadState(this.storage); }
  clear() { clearState(this.storage); }

  async run(spec) {
    const existing = this.world.assetCatalog.resolveExisting(spec.assetId, { assetId: spec.assetId, limit: 1 });
    if (existing.status === 'found') return this.#place(spec);

    let state = this.state();
    if (!state || state.assetId !== spec.assetId) {
      state = saveState(this.storage, { version: 1, assetId: spec.assetId, prompt: spec.assetPrompt, phase: 'image', imageJobId: null, assetJobId: null });
    }

    const imageCapability = pickCapability(this.world.generation, 'image-generation', 'text');
    const assetCapability = pickCapability(this.world.generation, 'asset-generation', 'image');
    if (!imageCapability || !assetCapability) throw new Error('当前没有可用的 Text→Image→3D 生成链');

    if (!state.imageJobId) {
      const image = await this.world.generation.submitGenerationJob({
        provider: imageCapability.provider,
        operation: imageCapability.operation,
        inputs: defaultedInputs(imageCapability, { prompt: spec.assetPrompt }),
        profile: preferredProfile(imageCapability),
        outputRoles: requiredRoles(imageCapability),
        metadata: { purpose: 'generated-placement-demo', assetId: spec.assetId }
      });
      state.imageJobId = image.jobId;
      saveState(this.storage, state);
      this.log(`Demo 参考图任务：${image.jobId}`, 'result');
    }

    const imageJob = await this.#wait(state.imageJobId);
    const source = imageJob.artifacts.find((artifact) => artifact.mime === 'image/png');
    if (!source?.id || !source.hash) throw new Error('参考图任务未产生可用于 3D 的 PNG Artifact');

    if (!state.assetJobId) {
      const asset = await this.world.generation.submitGenerationJob({
        provider: assetCapability.provider,
        operation: assetCapability.operation,
        inputs: defaultedInputs(assetCapability, { sourceArtifact: { id: source.id, role: source.role, mime: source.mime, hash: source.hash } }),
        profile: preferredProfile(assetCapability),
        outputRoles: requiredRoles(assetCapability),
        parent: { jobId: state.imageJobId },
        metadata: { purpose: 'generated-placement-demo', assetId: spec.assetId }
      });
      state.assetJobId = asset.jobId;
      state.phase = 'asset';
      saveState(this.storage, state);
      this.log(`Demo 3D 任务：${asset.jobId}`, 'result');
    }

    await this.#wait(state.assetJobId);
    state.phase = 'compile';
    saveState(this.storage, state);

    const produced = await this.world.generation.generateAndCompileAsset({
      jobId: state.assetJobId,
      assetId: spec.assetId,
      label: spec.assetLabel || spec.assetPrompt || spec.assetId
    });
    if (!['asset-ready', 'asset-provisional'].includes(produced.status)) throw new Error(`生成资产未通过准入：${produced.status}`);

    const result = await this.#place(spec);
    clearState(this.storage);
    return { ...result, generation: { imageJobId: state.imageJobId, assetJobId: state.assetJobId, status: produced.status } };
  }

  async #wait(jobId) {
    for (;;) {
      const job = await this.world.generation.getGenerationJob(jobId);
      if (job.status === 'provider-succeeded') return job;
      if (TERMINAL_FAILURES.has(job.status)) throw new Error(`生成任务失败：${job.status}${job.error?.message ? ` · ${job.error.message}` : ''}`);
      if (job.status === 'connection-required') throw new Error('生成连接器不可用');
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  async #place(spec) {
    if (!this.world.store.has(spec.instanceId)) await this.world.spawn(spec.assetId, { id: spec.instanceId });
    const placed = this.world.interactions.place(spec.instanceId, spec.supportId, { surfaceId: spec.surfaceId, clearance: 0.03 });
    const support = this.world.spatial.supportStatus(spec.instanceId, spec.supportId, { surfaceId: spec.surfaceId });
    if (!support.on) throw new Error('Runtime 未验证 ON 关系');
    return { status: 'completed', assetId: spec.assetId, instanceId: spec.instanceId, placed, support };
  }
}
