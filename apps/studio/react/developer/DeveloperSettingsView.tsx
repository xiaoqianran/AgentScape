import '../../ui/developer/DeveloperSettings.css';

export function DeveloperSettingsView() {
  return (
    <dialog id="developer-dialog" className="developer-dialog" aria-labelledby="developer-title">
      <form method="dialog" className="dialog-shell">
        <header className="dialog-heading">
          <div>
            <div className="eyebrow">开发者</div>
            <h2 id="developer-title">运行时设置</h2>
            <p>能力由 AgentScape 自动提供；具体适配器地址和凭据属于部署细节。</p>
          </div>
          <button className="icon-button" value="close" aria-label="关闭开发者设置">×</button>
        </header>

        <div className="dialog-scroll">
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>能力状态</h3>
              <button id="refresh-capabilities" className="secondary-button" type="button">刷新</button>
            </div>
            <div className="capability-status-list" aria-live="polite">
              <div className="capability-status-row"><span>智能体能力</span><strong id="capability-agent-status">检查中…</strong></div>
              <div className="capability-status-row"><span>资产编译能力</span><strong id="capability-compile-status">检查中…</strong></div>
              <div className="capability-status-row"><span>资产生成能力</span><strong id="capability-generate-status">检查中…</strong></div>
            </div>
            <p id="capability-status-help" className="settings-help">适配器地址和凭据只存在于部署环境，不写入浏览器。</p>
          </section>

          <details className="settings-section disclosure" open>
            <summary>渲染运行时</summary>
            <div className="settings-body">
              <div id="renderer-report" className="technical-report">读取渲染状态中…</div>
              <p className="settings-help">使用 ?renderer=webgpu 强制 WebGPU，?renderer=webgl 强制 WebGL2；追加 ?gpuTiming=1 可启用 GPU timestamp query。</p>
            </div>
          </details>

          <details className="settings-section disclosure" open>
            <summary>世界验证</summary>
            <div className="settings-body">
              <div className="button-row">
                <button id="validate-world" type="button">验证</button>
                <button id="repair-world" type="button">修复</button>
                <button id="verify-trace" type="button">验证追踪链</button>
              </div>
              <div id="engine-report" className="technical-report">引擎已就绪。</div>
            </div>
          </details>

          <details className="settings-section disclosure">
            <summary>资产编译</summary>
            <div className="settings-body">
              <div className="inline-input"><input id="compiler-url" type="url" placeholder="https://…/model.glb" /><button id="compile-url-button" type="button">编译 URL</button></div>
              <div className="inline-input"><input id="compiler-file" type="file" accept=".glb,model/gltf-binary" /><button id="compile-file-button" type="button">编译文件</button></div>
              <p className="settings-help">远程编译服务未配置时，编译器自动跳过远程增强并保留本地检查路径。</p>
              <div id="compiler-report" className="technical-report">尚未编译资产。</div>
            </div>
          </details>

          <details className="settings-section disclosure">
            <summary>资产库</summary>
            <div className="settings-body">
              <div className="inline-input"><input id="asset-query" placeholder="搜索椅子 / 杯子 / 资产 ID" /><button id="asset-search-button" type="button">搜索</button></div>
              <div id="asset-results" className="asset-results" />
              <p className="settings-help">优先复用已有资产；服务端生成只作为回退方案。</p>
            </div>
          </details>
        </div>

        <footer className="dialog-footer"><button className="secondary-button" value="close">完成</button></footer>
      </form>
    </dialog>
  );
}
