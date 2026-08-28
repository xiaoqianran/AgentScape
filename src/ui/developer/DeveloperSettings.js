import { RESOURCE_BUDGET } from '../../compiler/resourceBudget.js';

export const developerSettingsMarkup = () => `
  <dialog id="developer-dialog" class="developer-dialog" aria-labelledby="developer-title">
    <form method="dialog" class="dialog-shell">
      <header class="dialog-heading">
        <div>
          <div class="eyebrow">Developer</div>
          <h2 id="developer-title">Runtime settings</h2>
          <p>Advanced configuration is available when you need it, not required for normal world tasks.</p>
        </div>
        <button class="icon-button" value="close" aria-label="Close developer settings">×</button>
      </header>

      <div class="dialog-scroll">
        <section class="settings-section">
          <h3>Agent Gateway</h3>
          <label>Endpoint<input id="gateway-endpoint" type="url" placeholder="https://your-server.example/agent" /></label>
          <p class="settings-help">Only the Gateway URL is stored. Model API keys are never stored in the browser.</p>
        </section>

        <details class="settings-section disclosure" open>
          <summary>World validation</summary>
          <div class="settings-body">
            <div class="button-row">
              <button id="validate-world" type="button">Validate</button>
              <button id="repair-world" type="button">Repair</button>
              <button id="verify-trace" type="button">Verify trace</button>
            </div>
            <div id="engine-report" class="technical-report">Engine ready.</div>
          </div>
        </details>

        <details class="settings-section disclosure">
          <summary>Asset compiler</summary>
          <div class="settings-body">
            <label>Compiler Endpoint<input id="compiler-endpoint" type="url" placeholder="https://your-server.example/compile" /></label>
            <div class="inline-input"><input id="compiler-url" type="url" placeholder="https://…/model.glb" /><button id="compile-url-button" type="button">Compile URL</button></div>
            <div class="inline-input"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button" type="button">Compile file</button></div>
            <p class="settings-help">Without a remote compiler, AgentScape uses local browser checks. Heavy collision and semantic processing stays behind the Compiler Provider boundary.</p>
            <div id="compiler-report" class="technical-report">No asset compiled yet.</div>
          </div>
        </details>

        <details class="settings-section disclosure">
          <summary>Asset library</summary>
          <div class="settings-body">
            <div class="inline-input"><input id="asset-query" placeholder="Search chair / cup / asset id" /><button id="asset-search-button" type="button">Search</button></div>
            <div id="asset-results" class="asset-results"></div>
            <label>Generator Endpoint<input id="asset-generator-endpoint" type="url" placeholder="https://your-server.example/generate-3d" /></label>
            <p class="settings-help">Search reusable Assets first. Generation is the fallback, not the default.</p>
          </div>
        </details>
      </div>

      <footer class="dialog-footer"><button class="secondary-button" value="close">Done</button></footer>
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
      this.log(this.gateway.isConfigured() ? `LLM gateway configured` : 'LLM gateway disabled; Agent planning is unavailable', 'result');
    });

    this.dialog.querySelector('#validate-world').addEventListener('click', () => this.validate());
    this.dialog.querySelector('#repair-world').addEventListener('click', () => this.repair());
    this.dialog.querySelector('#verify-trace').addEventListener('click', () => this.verifyTrace());

    this.compilerEndpointInput.value = this.world.compilerProvider.endpoint || '';
    this.compilerEndpointInput.addEventListener('change', () => {
      this.world.compilerProvider.setEndpoint(this.compilerEndpointInput.value);
      if (this.world.compilerProvider.endpoint) localStorage.setItem('agentscape.compilerEndpoint', this.world.compilerProvider.endpoint);
      else localStorage.removeItem('agentscape.compilerEndpoint');
      this.log(this.world.compilerProvider.isConfigured() ? 'compiler provider enabled' : 'compiler provider disabled; using local passes', 'result');
    });
    this.dialog.querySelector('#compile-url-button').addEventListener('click', () => {
      const url = this.dialog.querySelector('#compiler-url').value.trim();
      if (url) this.compileAndRegister({ url });
    });
    this.dialog.querySelector('#compile-file-button').addEventListener('click', async () => {
      const file = this.dialog.querySelector('#compiler-file').files?.[0];
      if (!file) return;
      if (file.size > RESOURCE_BUDGET.maxInputBytes) {
        this.compilerReport.textContent = `File too large: ${Math.ceil(file.size / 1024 / 1024)} MiB. Limit ${Math.ceil(RESOURCE_BUDGET.maxInputBytes / 1024 / 1024)} MiB.`;
        return;
      }
      await this.compileAndRegister({ bytes: new Uint8Array(await file.arrayBuffer()), sourceName: file.name });
    });

    this.assetGeneratorInput.value = this.world.assetGenerator.endpoint || '';
    this.assetGeneratorInput.addEventListener('change', () => {
      this.world.assetGenerator.setEndpoint(this.assetGeneratorInput.value);
      if (this.world.assetGenerator.endpoint) localStorage.setItem('agentscape.assetGeneratorEndpoint', this.world.assetGenerator.endpoint);
      else localStorage.removeItem('agentscape.assetGeneratorEndpoint');
      this.log(this.world.assetGenerator.isConfigured() ? 'asset generator enabled' : 'asset generator disabled', 'result');
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
      this.engineReport.innerHTML = `<strong>${report.ok ? 'PASS' : 'FAIL'}</strong> · hard ${report.counts.hard} · advisory ${report.counts.advisory} · ${report.coverage.objects} objects · ${report.coverage.relations} relations`;
      this.log(`validate · hard ${report.counts.hard} advisory ${report.counts.advisory}`, report.ok ? 'result' : 'error');
    } catch (error) {
      this.engineReport.textContent = `Validation failed: ${error.message}`;
      this.log(`validate error: ${error.message}`, 'error');
    }
  }

  async repair() {
    try {
      const result = await this.tools.call('repairWorld', { report: this.lastValidation || undefined });
      this.lastValidation = await this.tools.call('validateWorld', {});
      const report = this.lastValidation;
      this.engineReport.innerHTML = `<strong>${report.ok ? 'PASS' : 'FAIL'}</strong> · hard ${report.counts.hard} · advisory ${report.counts.advisory}`;
      this.log(`repair · ${result.accepted ? 'accepted' : 'rejected'} · ${result.applied?.length || 0} changes`, result.accepted ? 'result' : 'error');
    } catch (error) {
      this.log(`repair error: ${error.message}`, 'error');
    }
  }

  async verifyTrace() {
    try {
      const result = await this.tools.call('verifyTrace', {});
      this.engineReport.textContent = `Trace ${result.ok ? 'PASS' : 'FAIL'} · ${result.entries ?? 0} events · ${result.lastHash || 'no hash'}`;
    } catch (error) {
      this.log(`trace error: ${error.message}`, 'error');
    }
  }

  async compileAndRegister(input) {
    try {
      this.compilerReport.textContent = 'Compiling…';
      const response = await this.world.skills.invoke('compileAsset', input, { profile: 'builder', actor: 'human' });
      if (!response.success) throw new Error(response.error.message);
      const result = response.result;
      const manifest = result.manifest;
      const inspection = result.inspection.stats;
      this.compilerReport.innerHTML = `<strong>${manifest.id}</strong> · ${result.quality.status} · ${manifest.type} · ${inspection.nodes} nodes · ${inspection.meshes} meshes · collider ${manifest.compiler.collisionStrategy}`;
      this.log(`compiled asset: ${manifest.id}`, 'result');
      this.renderAssetResults(this.world.assetCatalog.list().slice(0, 8));
    } catch (error) {
      this.compilerReport.textContent = `Compile failed: ${error.message}`;
      this.log(`compile error: ${error.message}`, 'error');
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
      title.textContent = asset.label;
      detail.textContent = `${asset.id} · ${asset.source}`;
      meta.append(title, detail);
      const spawn = document.createElement('button');
      spawn.type = 'button';
      spawn.textContent = 'Add to world';
      spawn.addEventListener('click', async () => {
        try {
          const id = await this.tools.call('spawnAsset', { assetId: asset.id, position: [1.5, 0, 1.2] });
          this.log(`spawned ${id}`, 'result');
        } catch (error) {
          this.log(`error: ${error.message}`, 'error');
        }
      });
      row.append(meta, spawn);
      this.assetResults.append(row);
    }
    if (!assets.length) {
      const empty = document.createElement('span');
      empty.className = 'muted-copy';
      empty.textContent = 'No reusable asset found.';
      this.assetResults.append(empty);
    }
  }
}
