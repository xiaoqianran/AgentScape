import { RESOURCE_BUDGET } from '../../../../modules/asset/model/resourceBudget.js';
import '../../react/developer/DeveloperSettings.css';
import { readCapabilityStatus, unavailableCapabilityStatus } from '../../config/capabilityEntry.js';

export class DeveloperSettings {
  constructor({ dialog, world, tools, gateway, initialCapabilityStatus = unavailableCapabilityStatus(), log = () => {}, onCapabilityStatusChange = () => {} }) {
    this.dialog = dialog;
    this.world = world;
    this.tools = tools;
    this.gateway = gateway;
    this.capabilityStatus = initialCapabilityStatus;
    this.log = log;
    this.onCapabilityStatusChange = onCapabilityStatusChange;
    const q = (selector) => dialog.querySelector(selector);
    this.capabilityRows = {
      agent: q('#capability-agent-status'),
      assetCompile: q('#capability-compile-status')
    };
    this.capabilityHelp = q('#capability-status-help');
    this.refreshCapabilitiesButton = q('#refresh-capabilities');
    this.rendererReport = q('#renderer-report');
    this.engineReport = q('#engine-report');
    this.compilerReport = q('#compiler-report');
    this.assetQuery = q('#asset-query');
    this.assetResults = q('#asset-results');
    this.lastValidation = null;
  }

  init() {
    this.renderCapabilityStatus(this.capabilityStatus);
    this.renderRendererStatus();
    this.refreshCapabilitiesButton.addEventListener('click', () => this.refreshCapabilityStatus());
    this.dialog.querySelector('#validate-world').addEventListener('click', () => this.validate());
    this.dialog.querySelector('#repair-world').addEventListener('click', () => this.repair());
    this.dialog.querySelector('#verify-trace').addEventListener('click', () => this.verifyTrace());
    this.dialog.querySelector('#compile-url-button').addEventListener('click', () => {
      const url = this.dialog.querySelector('#compiler-url').value.trim();
      if (url) this.compileAndRegister({ url });
    });
    this.dialog.querySelector('#compile-file-button').addEventListener('click', async () => {
      const file = this.dialog.querySelector('#compiler-file').files?.[0];
      if (!file) return;
      if (file.size > RESOURCE_BUDGET.maxInputBytes) {
        this.compilerReport.textContent = `文件过大：${Math.ceil(file.size / 1024 / 1024)} MiB；上限 ${Math.ceil(RESOURCE_BUDGET.maxInputBytes / 1024 / 1024)} MiB。`;
        return;
      }
      await this.compileAndRegister({ bytes: new Uint8Array(await file.arrayBuffer()), sourceName: file.name });
    });
    this.dialog.querySelector('#asset-search-button').addEventListener('click', () => this.searchAssets());
    this.assetQuery.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); this.searchAssets(); }
    });
    this.renderAssetResults(this.world.assetModule.catalog.list().slice(0, 5));
    return this;
  }

  open() {
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.renderRendererStatus();
    requestAnimationFrame(() => this.refreshCapabilitiesButton.focus());
  }

  renderRendererStatus() {
    const info = this.world.rendering?.diagnostics?.() || {};
    const backend = info.backend === 'webgpu' ? 'WebGPU' : info.backend === 'webgl2' ? 'WebGL2' : String(info.backend || 'unknown');
    const mode = info.requestedMode || 'auto';
    const health = info.health || 'ready';
    const gpuTime = Number.isFinite(info.gpuTimeMs) ? `${info.gpuTimeMs.toFixed(3)} ms` : '—';
    const timing = info.gpuTiming ? `启用 · ${gpuTime}` : '关闭';
    const compatibility = info.compatibilityMode === true ? 'compatibility' : info.compatibilityMode === false ? 'core' : '—';
    const features = rendererFeatureSummary(info.features);
    const limits = rendererLimitSummary(info.limits);
    const generatedVisual = rendererGeneratedVisualSummary(info.generatedVisual);
    const milliseconds=value=>Number.isFinite(value)?`${value.toFixed(2)} ms`:'—';
    const performanceSummary=`帧间隔 P50/P95 ${milliseconds(info.frameIntervalMs?.p50)} / ${milliseconds(info.frameIntervalMs?.p95)} · 渲染提交 CPU P95 ${milliseconds(info.renderCpuMs?.p95)} · Draw calls ${info.workload?.drawCalls ?? '—'} · 三角形 ${info.workload?.triangles ?? '—'}`;
    renderTechnicalReport(
      this.rendererReport,
      `${backend} · ${health}`,
      `模式 ${mode} · fallback ${info.fallback ? '是' : '否'} · GPU timing ${timing} · ${performanceSummary} · WebGPU ${compatibility} · ${features} · ${limits} · ${generatedVisual}`
    );
  }

  async refreshCapabilityStatus() {
    this.refreshCapabilitiesButton.disabled = true;
    this.refreshCapabilitiesButton.textContent = '检查中…';
    const status = await readCapabilityStatus();
    this.capabilityStatus = status;
    this.renderCapabilityStatus(status);
    this.onCapabilityStatusChange(status);
    this.refreshCapabilitiesButton.disabled = false;
    this.refreshCapabilitiesButton.textContent = '刷新';
  }

  renderCapabilityStatus(status) {
    for (const key of ['agent', 'assetCompile']) {
      const configured = Boolean(status?.[key]?.available);
      const row = this.capabilityRows[key];
      row.textContent = configured ? '可用' : '不可用';
      row.dataset.available = configured ? 'true' : 'false';
    }
    this.capabilityHelp.textContent = status?.source === 'server'
      ? '能力由部署适配器提供；浏览器不保存适配器地址或凭据。'
      : `无法读取能力状态：${status?.reason || '未知错误'}`;
  }

  async validate() {
    try {
      this.lastValidation = await this.tools.call('validateWorld', {});
      const report = this.lastValidation;
      renderTechnicalReport(this.engineReport, report.ok ? '通过' : '失败', `严重问题 ${report.counts.hard} · 建议项 ${report.counts.advisory} · ${report.coverage.objects} 个对象 · ${report.coverage.relations} 条关系`);
      this.log(`验证 · 严重问题 ${report.counts.hard} · 建议项 ${report.counts.advisory}`, report.ok ? 'result' : 'error');
    } catch (error) {
      this.engineReport.textContent = `验证失败：${error.message}`;
      this.log(`验证错误：${error.message}`, 'error');
    }
  }

  async repair() {
    try {
      const result = await this.tools.call('repairWorld', { report: this.lastValidation || undefined });
      this.lastValidation = await this.tools.call('validateWorld', {});
      const report = this.lastValidation;
      renderTechnicalReport(this.engineReport, report.ok ? '通过' : '失败', `严重问题 ${report.counts.hard} · 建议项 ${report.counts.advisory}`);
      this.log(`修复 · ${result.accepted ? '已接受' : '已拒绝'} · ${result.applied?.length || 0} 项变更`, result.accepted ? 'result' : 'error');
    } catch (error) {
      this.log(`修复错误：${error.message}`, 'error');
    }
  }

  async verifyTrace() {
    try {
      const result = await this.tools.call('verifyTrace', {});
      this.engineReport.textContent = `追踪链 ${result.ok ? '通过' : '失败'} · ${result.entries ?? 0} 个事件 · ${result.lastHash || '无哈希'}`;
    } catch (error) {
      this.log(`追踪链错误：${error.message}`, 'error');
    }
  }

  async compileAndRegister(input) {
    try {
      this.compilerReport.textContent = '编译中…';
      const response = await this.world.skills.invoke('compileAsset', input, { profile: 'builder', actor: 'human' });
      if (!response.success) throw new Error(response.error.message);
      const result = response.result;
      const manifest = result.manifest;
      const inspection = result.inspection.stats;
      renderTechnicalReport(this.compilerReport, manifest.id, `${result.quality.status} · ${manifest.type} · ${inspection.nodes} 个节点 · ${inspection.meshes} 个网格 · 碰撞体 ${manifest.compiler.collisionStrategy}`);
      this.log(`资产已编译：${manifest.id}`, 'result');
      this.renderAssetResults(this.world.assetModule.catalog.list().slice(0, 8));
    } catch (error) {
      this.compilerReport.textContent = `编译失败：${error.message}`;
      this.log(`编译错误：${error.message}`, 'error');
    }
  }

  searchAssets() {
    this.renderAssetResults(this.world.assetModule.catalog.search(this.assetQuery.value, { limit: 8 }));
  }

  renderAssetResults(assets) {
    this.assetResults.replaceChildren();
    for (const asset of assets) {
      const row = document.createElement('div');
      row.className = 'asset-result';
      const meta = document.createElement('div');
      const title = document.createElement('strong');
      const detail = document.createElement('small');
      title.textContent = assetDisplayLabel(asset);
      detail.textContent = `${asset.id} · ${asset.source}`;
      meta.append(title, detail);
      const spawn = document.createElement('button');
      spawn.type = 'button';
      spawn.textContent = '加入世界';
      spawn.addEventListener('click', async () => {
        try {
          const id = await this.tools.call('spawnAsset', { assetId: asset.id, position: [1.5, 0, 1.2] });
          this.log(`已加入世界：${id}`, 'result');
        } catch (error) {
          this.log(`错误：${error.message}`, 'error');
        }
      });
      row.append(meta, spawn);
      this.assetResults.append(row);
    }
    if (!assets.length) {
      const empty = document.createElement('span');
      empty.className = 'muted-copy';
      empty.textContent = '没有找到可复用资产。';
      this.assetResults.append(empty);
    }
  }
}

function assetDisplayLabel(asset) {
  const byId = { agent: '智能体', chair: '椅子', cup: '杯子', table: '桌子', cabinet: '柜子' };
  return byId[asset?.id] || asset?.label || asset?.id || '未命名资产';
}

function renderTechnicalReport(container, heading, detail) {
  const strong = document.createElement('strong');
  strong.textContent = String(heading ?? '');
  container.replaceChildren(strong, document.createTextNode(` · ${String(detail ?? '')}`));
}

function rendererGeneratedVisualSummary(visual = {}) {
  const status = visual.status || 'none';
  if (status === 'none') return 'Generated visual none';
  const format = String(visual.format || 'unknown').toUpperCase();
  const count = Number.isFinite(visual.splatCount) ? visual.splatCount.toLocaleString() : '?';
  return status === 'ready'
    ? `Generated visual ${format} ready · ${count} splats`
    : `Generated visual ${format} ${status}`;
}

function rendererFeatureSummary(features = []) {
  const set = new Set(features || []);
  const important = ['timestamp-query', 'shader-f16', 'subgroups', 'texture-compression-bc'].filter((name) => set.has(name));
  return important.length ? `features ${important.join(', ')}` : 'features —';
}

function rendererLimitSummary(limits = {}) {
  if (!limits || !Object.keys(limits).length) return 'limits —';
  const storage = formatBytes(limits.maxStorageBufferBindingSize);
  const invocations = Number.isFinite(limits.maxComputeInvocationsPerWorkgroup) ? limits.maxComputeInvocationsPerWorkgroup : '—';
  const group = [limits.maxComputeWorkgroupSizeX, limits.maxComputeWorkgroupSizeY, limits.maxComputeWorkgroupSizeZ]
    .map((value) => Number.isFinite(value) ? value : '—')
    .join('×');
  const bindGroups = Number.isFinite(limits.maxBindGroups) ? limits.maxBindGroups : '—';
  return `storage ${storage} · compute ${group} / ${invocations} invocations · bind groups ${bindGroups}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(0)} KiB`;
  return `${value} B`;
}
