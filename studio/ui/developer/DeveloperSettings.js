import { RESOURCE_BUDGET } from '../../../asset/compiler/resourceBudget.js';
import { readCapabilityStatus, unavailableCapabilityStatus } from '../../config/capabilityEntry.js';

export const developerSettingsMarkup = () => `
  <dialog id="developer-dialog" class="developer-dialog" aria-labelledby="developer-title">
    <form method="dialog" class="dialog-shell">
      <header class="dialog-heading">
        <div>
          <div class="eyebrow">开发者</div>
          <h2 id="developer-title">运行时设置</h2>
          <p>能力由 AgentScape 自动提供；具体适配器地址和凭据属于部署细节。</p>
        </div>
        <button class="icon-button" value="close" aria-label="关闭开发者设置">×</button>
      </header>

      <div class="dialog-scroll">
        <section class="settings-section">
          <div class="settings-section-heading">
            <h3>能力状态</h3>
            <button id="refresh-capabilities" class="secondary-button" type="button">刷新</button>
          </div>
          <div class="capability-status-list" aria-live="polite">
            <div class="capability-status-row"><span>智能体能力</span><strong id="capability-agent-status">检查中…</strong></div>
            <div class="capability-status-row"><span>资产编译能力</span><strong id="capability-compile-status">检查中…</strong></div>
            <div class="capability-status-row"><span>资产生成能力</span><strong id="capability-generate-status">检查中…</strong></div>
          </div>
          <p id="capability-status-help" class="settings-help">适配器地址和凭据只存在于部署环境，不写入浏览器。</p>
        </section>

        <details class="settings-section disclosure" open>
          <summary>渲染运行时</summary>
          <div class="settings-body">
            <div id="renderer-report" class="technical-report">读取渲染状态中…</div>
            <p class="settings-help">使用 ?renderer=webgpu 强制 WebGPU，?renderer=webgl 强制 WebGL2；追加 ?gpuTiming=1 可启用 GPU timestamp query。</p>
          </div>
        </details>

        <details class="settings-section disclosure" open>
          <summary>世界验证</summary>
          <div class="settings-body">
            <div class="button-row">
              <button id="validate-world" type="button">验证</button>
              <button id="repair-world" type="button">修复</button>
              <button id="verify-trace" type="button">验证追踪链</button>
            </div>
            <div id="engine-report" class="technical-report">引擎已就绪。</div>
          </div>
        </details>

        <details class="settings-section disclosure">
          <summary>资产编译</summary>
          <div class="settings-body">
            <div class="inline-input"><input id="compiler-url" type="url" placeholder="https://…/model.glb" /><button id="compile-url-button" type="button">编译 URL</button></div>
            <div class="inline-input"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button" type="button">编译文件</button></div>
            <p class="settings-help">远程编译服务未配置时，编译器自动跳过远程增强并保留本地检查路径。</p>
            <div id="compiler-report" class="technical-report">尚未编译资产。</div>
          </div>
        </details>

        <details class="settings-section disclosure">
          <summary>资产库</summary>
          <div class="settings-body">
            <div class="inline-input"><input id="asset-query" placeholder="搜索椅子 / 杯子 / 资产 ID" /><button id="asset-search-button" type="button">搜索</button></div>
            <div id="asset-results" class="asset-results"></div>
            <p class="settings-help">优先复用已有资产；服务端生成只作为回退方案。</p>
          </div>
        </details>
      </div>

      <footer class="dialog-footer"><button class="secondary-button" value="close">完成</button></footer>
    </form>
  </dialog>`;

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
    this.renderAssetResults(this.world.assetCatalog.list().slice(0, 5));
    return this;
  }

  open() {
    if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
    else this.dialog.setAttribute('open', '');
    this.renderRendererStatus();
    requestAnimationFrame(() => this.refreshCapabilitiesButton.focus());
  }

  renderRendererStatus() {
    const info = this.world.renderingDiagnostics?.() || this.world.rendererInfo || {};
    const backend = info.backend === 'webgpu' ? 'WebGPU' : info.backend === 'webgl2' ? 'WebGL2' : String(info.backend || 'unknown');
    const mode = info.requestedMode || 'auto';
    const health = info.health || 'ready';
    const gpuTime = Number.isFinite(info.gpuTimeMs) ? `${info.gpuTimeMs.toFixed(3)} ms` : '—';
    const timing = info.gpuTiming ? `启用 · ${gpuTime}` : '关闭';
    const compatibility = info.compatibilityMode === true ? 'compatibility' : info.compatibilityMode === false ? 'core' : '—';
    renderTechnicalReport(
      this.rendererReport,
      `${backend} · ${health}`,
      `模式 ${mode} · fallback ${info.fallback ? '是' : '否'} · GPU timing ${timing} · WebGPU ${compatibility}`
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
      this.renderAssetResults(this.world.assetCatalog.list().slice(0, 8));
    } catch (error) {
      this.compilerReport.textContent = `编译失败：${error.message}`;
      this.log(`编译错误：${error.message}`, 'error');
    }
  }

  searchAssets() {
    this.renderAssetResults(this.world.assetCatalog.search(this.assetQuery.value, { limit: 8 }));
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
