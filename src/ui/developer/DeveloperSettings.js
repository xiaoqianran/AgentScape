import { RESOURCE_BUDGET } from '../../compiler/resourceBudget.js';

export const developerSettingsMarkup = () => `
  <dialog id="developer-dialog" class="developer-dialog" aria-labelledby="developer-title">
    <form method="dialog" class="dialog-shell">
      <header class="dialog-heading">
        <div>
          <div class="eyebrow">开发者</div>
          <h2 id="developer-title">运行时设置</h2>
          <p>高级配置按需提供，正常执行世界任务时无需处理这些设置。</p>
        </div>
        <button class="icon-button" value="close" aria-label="关闭开发者设置">×</button>
      </header>

      <div class="dialog-scroll">
        <section class="settings-section">
          <h3>智能体网关</h3>
          <label>网关地址<input id="gateway-endpoint" type="url" placeholder="https://your-server.example/agent" /></label>
          <p class="settings-help">这里只保存网关地址；模型 API Key 不会保存在浏览器中。</p>
        </section>

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
          <summary>资产编译器</summary>
          <div class="settings-body">
            <label>编译器地址<input id="compiler-endpoint" type="url" placeholder="https://your-server.example/compile" /></label>
            <div class="inline-input"><input id="compiler-url" type="url" placeholder="https://…/model.glb" /><button id="compile-url-button" type="button">编译 URL</button></div>
            <div class="inline-input"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button" type="button">编译文件</button></div>
            <p class="settings-help">未配置远程编译器时，AgentScape 使用浏览器本地检查；重型碰撞与语义处理仍位于编译器提供方边界之后。</p>
            <div id="compiler-report" class="technical-report">尚未编译资产。</div>
          </div>
        </details>

        <details class="settings-section disclosure">
          <summary>资产库</summary>
          <div class="settings-body">
            <div class="inline-input"><input id="asset-query" placeholder="搜索椅子 / 杯子 / 资产 ID" /><button id="asset-search-button" type="button">搜索</button></div>
            <div id="asset-results" class="asset-results"></div>
            <label>生成器地址<input id="asset-generator-endpoint" type="url" placeholder="https://your-server.example/generate-3d" /></label>
            <p class="settings-help">优先复用已有资产；生成只作为回退方案，而不是默认路径。</p>
          </div>
        </details>
      </div>

      <footer class="dialog-footer"><button class="secondary-button" value="close">完成</button></footer>
    </form>
  </dialog>`;

export class DeveloperSettings {
  constructor({ dialog, world, tools, gateway, log = () => {}, onGatewayChange = () => {} }) {
    this.dialog = dialog;
    this.world = world;
    this.tools = tools;
    this.gateway = gateway;
    this.log = log;
    this.onGatewayChange = onGatewayChange;
    const q = (selector) => dialog.querySelector(selector);
    this.gatewayInput = q('#gateway-endpoint');
    this.engineReport = q('#engine-report');
    this.compilerEndpointInput = q('#compiler-endpoint');
    this.compilerReport = q('#compiler-report');
    this.assetGeneratorInput = q('#asset-generator-endpoint');
    this.assetQuery = q('#asset-query');
    this.assetResults = q('#asset-results');
    this.lastValidation = null;
  }

  init() {
    this.gatewayInput.value = this.gateway.endpoint || '';
    this.gatewayInput.addEventListener('change', () => {
      this.gateway.setEndpoint(this.gatewayInput.value);
      if (this.gateway.endpoint) localStorage.setItem('agentscape.gatewayEndpoint', this.gateway.endpoint);
      else localStorage.removeItem('agentscape.gatewayEndpoint');
      this.onGatewayChange(this.gateway.isConfigured());
      this.log(this.gateway.isConfigured() ? `大模型网关已配置` : '大模型网关已禁用；智能体规划不可用', 'result');
    });

    this.dialog.querySelector('#validate-world').addEventListener('click', () => this.validate());
    this.dialog.querySelector('#repair-world').addEventListener('click', () => this.repair());
    this.dialog.querySelector('#verify-trace').addEventListener('click', () => this.verifyTrace());

    this.compilerEndpointInput.value = this.world.compilerProvider.endpoint || '';
    this.compilerEndpointInput.addEventListener('change', () => {
      this.world.compilerProvider.setEndpoint(this.compilerEndpointInput.value);
      if (this.world.compilerProvider.endpoint) localStorage.setItem('agentscape.compilerEndpoint', this.world.compilerProvider.endpoint);
      else localStorage.removeItem('agentscape.compilerEndpoint');
      this.log(this.world.compilerProvider.isConfigured() ? '编译器提供方已启用' : '编译器提供方已禁用；使用本地检查', 'result');
    });
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

    this.assetGeneratorInput.value = this.world.assetGenerator.endpoint || '';
    this.assetGeneratorInput.addEventListener('change', () => {
      this.world.assetGenerator.setEndpoint(this.assetGeneratorInput.value);
      if (this.world.assetGenerator.endpoint) localStorage.setItem('agentscape.assetGeneratorEndpoint', this.world.assetGenerator.endpoint);
      else localStorage.removeItem('agentscape.assetGeneratorEndpoint');
      this.log(this.world.assetGenerator.isConfigured() ? '资产生成器已启用' : '资产生成器已禁用', 'result');
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
    requestAnimationFrame(() => this.gatewayInput.focus());
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
