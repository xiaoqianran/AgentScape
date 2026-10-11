export function renderObservatoryLayout({icon, debugToggle}) {
  return `
      <div class="obs-app">
        <div class="obs-bg" aria-hidden="true"><i></i><i></i></div>

        <header class="obs-topbar">
          <div class="obs-topbar-left">
            <a class="obs-brand" href="/observatory/" aria-label="AgentScape 工作台">
              <span class="obs-brand-dot" aria-hidden="true"></span>
              <div class="obs-brand-copy">
                <strong>AgentScape 工作台</strong>
                <span id="obs-lab-title">观测台 · 运行时验证</span>
              </div>
            </a>
            <nav class="obs-domain-nav" aria-label="工作区">
              <button type="button" data-workspace="simulation">仿真与验证</button>
              <button type="button" data-workspace="assets">资产检查</button>
              <button type="button" data-workspace="agent">智能体验证</button>
              <button type="button" data-workspace="rendering">渲染诊断</button>
            </nav>
            <div class="obs-context" aria-label="实验上下文">
              <label class="obs-context-field obs-workspace-picker"><span>工作区</span><select id="obs-workspace-select" aria-label="工作区选择"></select></label>
              <label class="obs-context-field">
                <span>当前工具</span>
                <select id="obs-lab-select" aria-label="Lab"></select>
              </label>
              <label class="obs-context-field">
                <span>运行后端</span>
                <select id="obs-backend-select" aria-label="Backend"></select>
              </label>
            </div>
          </div>
          <div class="obs-topbar-right">
            <button id="obs-focus-view" class="obs-top-action" type="button" title="聚焦当前场景" aria-label="聚焦当前场景">
              ${icon("focus")}
              <span>聚焦</span>
            </button>
            <a class="obs-studio-link" href="/">${icon("terminal")}<span>工作室</span></a>
            <i class="obs-top-separator" aria-hidden="true"></i>
            <button class="obs-top-icon" type="button" data-open-right="layers" title="调试图层" aria-label="打开 调试图层">${icon("settings")}</button>
            <button class="obs-top-icon" type="button" data-open-right="inspect" title="运行时检视" aria-label="打开运行时检视">${icon("help")}</button>
          </div>
        </header>

        <main class="obs-workspace">
          <aside class="obs-left-sidebar obs-glass" aria-label="实验场景">
            <button id="obs-scenarios-toggle" class="obs-edge-toggle obs-edge-toggle-right" type="button" aria-label="显示或隐藏场景面板" aria-pressed="true">${icon("chevron-left")}</button>
            <div class="obs-sidebar-head">
              <strong id="obs-sidebar-title">测试场景</strong>
              <span id="obs-sidebar-subtitle">选择一个场景开始验证</span>
            </div>
            <div id="obs-scenario-list" class="obs-scenario-list"></div>
            <div id="obs-resource-browser-host" class="obs-resource-browser-host" hidden></div>
          </aside>

          <section class="obs-center-column" aria-label="运行时视口">
            <div class="obs-center-toolbar">
              <div class="obs-view-tabs" role="tablist" aria-label="视图模式">
                <button class="obs-view-tab is-active" type="button" data-view="world" aria-label="真实世界">${icon("world")}<span>3D 视口 <b>世界</b></span></button>
                <button class="obs-view-tab" type="button" data-view="evidence" aria-label="运行证据">${icon("evidence")}<span>测试结果 <b>结果</b></span></button>
                <button class="obs-view-tab" type="button" data-view="inspect" aria-label="运行时检视">${icon("cube")}<span>状态指标 <b>指标</b></span></button>
              </div>
              <div class="obs-fixed-pill"><i></i><span>仿真 · 固定 60 HZ</span></div>
            </div>

            <section class="obs-stage obs-glass" aria-label="运行时 3D 世界">
              <div id="obs-viewport" class="obs-viewport"></div>
              <div class="obs-stage-wash" aria-hidden="true"></div>
              <button class="obs-stage-title" id="obs-scenario-badge" type="button" aria-expanded="false" aria-label="查看当前场景详情"></button>
              <div class="obs-focus-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
              <div id="obs-status-layer" class="obs-status-layer" hidden>
                <div class="obs-spinner" aria-hidden="true"></div>
                <span id="obs-status-text">正在加载实验…</span>
                <button id="obs-status-action" class="obs-status-action" type="button" hidden>重新加载</button>
              </div>
            </section>
          </section>

          <aside class="obs-right-sidebar obs-glass" aria-label="验证与检视">
            <button id="obs-results-toggle" class="obs-edge-toggle obs-edge-toggle-left" type="button" aria-label="显示或隐藏验证面板" aria-pressed="true">${icon("chevron-right")}</button>
            <div class="obs-right-tabs" role="tablist" aria-label="右侧工具">
              <button class="obs-right-tab is-active" type="button" data-right-tab="run">${icon("flow")}<span>执行流</span></button>
              <button id="obs-tools-tab" class="obs-right-tab" type="button" data-right-tab="tools" hidden>${icon("terminal")}<span>工具</span></button>
              <button id="obs-resources-tab" class="obs-right-tab" type="button" data-right-tab="resources" hidden>${icon("cube")}<span>资源</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="layers">${icon("layers")}<span>图层</span></button>
              <button class="obs-right-tab" type="button" data-right-tab="inspect">${icon("info")}<span>检视</span></button>
            </div>

            <div class="obs-right-body">
              <section class="obs-right-panel is-active" data-right-panel="run">
                <div class="obs-run-summary">
                  <div><span>验证</span><strong>当前执行流</strong></div>
                  <span id="obs-result-summary" class="obs-result-summary is-neutral">—</span>
                </div>
                <div class="obs-run-graph">
                  <div class="obs-flow-line" aria-hidden="true"></div>
                  <article class="obs-flow-node obs-flow-scenario">
                    <div class="obs-flow-dot">${icon("assignment")}</div>
                    <div class="obs-flow-content">
                      <span class="obs-flow-kicker">场景</span>
                      <div id="obs-run-scenario-card" class="obs-flow-card"><strong>等待场景</strong><small>选择一个运行时验证任务</small></div>
                    </div>
                  </article>
                  <div id="obs-assertions" class="obs-assertions"></div>
                </div>
              </section>

              <section class="obs-right-panel obs-tool-panel" data-right-panel="tools">
                <div class="obs-panel-heading"><span>AGENT TOOLS</span><strong>工具工作台</strong><small>选择真实领域工具，编辑参数并查看调用结果。</small></div>
                <label class="obs-tool-search">
                  ${icon("search")}
                  <input id="obs-tool-search" type="search" placeholder="搜索工具或能力…" autocomplete="off" />
                </label>
                <div id="obs-tool-list" class="obs-tool-list" role="listbox" aria-label="可用智能体工具"></div>
                <div class="obs-tool-detail">
                  <div class="obs-tool-detail-head">
                    <div><span>当前工具</span><strong id="obs-tool-name">—</strong></div>
                    <span id="obs-tool-required" class="obs-tool-required">无必填参数</span>
                  </div>
                  <p id="obs-tool-description">选择一个工具以查看定义。</p>
                  <label class="obs-tool-args-label" for="obs-tool-args">调用参数 <small>JSON</small></label>
                  <textarea id="obs-tool-args" class="obs-tool-args" rows="7" spellcheck="false">{}</textarea>
                  <div id="obs-tool-error" class="obs-tool-error" role="alert" hidden></div>
                  <button id="obs-tool-invoke" class="obs-tool-invoke" type="button" disabled>${icon("play")}<span>调用工具</span><small>⌘ ↵</small></button>
                </div>
                <section class="obs-tool-output" aria-live="polite">
                  <div class="obs-tool-section-title"><span>最近响应</span><b id="obs-tool-outcome">等待调用</b></div>
                  <pre id="obs-tool-result">选择工具并发起调用，结果会显示在这里。</pre>
                </section>
                <section class="obs-tool-history-section">
                  <div class="obs-tool-section-title"><span>调用历史</span><button id="obs-tool-clear" type="button">清空</button></div>
                  <div id="obs-tool-history" class="obs-tool-history"><div class="obs-empty">暂无手动调用</div></div>
                </section>
              </section>

              <section class="obs-right-panel obs-resource-panel" data-right-panel="resources">
                <div id="obs-resource-host"></div>
              </section>

              <section class="obs-right-panel" data-right-panel="layers">
                <div class="obs-panel-heading"><span>调试视图</span><strong>视觉图层</strong><small>只改变观测方式，不改变 Runtime 真值。</small></div>
                <div class="obs-layer-presets" role="group" aria-label="调试图层预设"><button type="button" data-layer-preset="defaults">默认</button><button type="button" data-layer-preset="all">全部开启</button><button type="button" data-layer-preset="off">全部关闭</button></div>
                <div class="obs-debug-controls">
                  ${debugToggle("native", "native-debug", "原生物理")}
                  ${debugToggle("manifest", "manifest-debug", "清单碰撞体")}
                  ${debugToggle("difference", "difference-debug", "真值差异")}
                  ${debugToggle("normalized", "normalized-debug", "归一化碰撞体")}
                  ${debugToggle("velocity", "velocity-debug", "速度")}
                  ${debugToggle("joint", "joint-debug", "关节坐标系")}
                  ${debugToggle("contact", "contact-debug", "接触法线")}
                  ${debugToggle("bounds", "bounds-debug", "边界 / 重叠")}
                  ${debugToggle("ray", "ray-debug", "射线 / 命中")}
                  ${debugToggle("spatial-query", "spatial-query-debug", "空间查询")}
                  ${debugToggle("navmesh", "navmesh-debug", "NavMesh")}
                  ${debugToggle("path", "path-debug", "Path")}
                  ${debugToggle("endpoints", "endpoints-debug", "Start / End")}
                  ${debugToggle("obstacles", "obstacles-debug", "动态障碍物")}
                  ${debugToggle("interaction-los", "interaction-los-debug", "视线 / 命中")}
                  ${debugToggle("interaction-support", "interaction-support-debug", "支撑面")}
                  ${debugToggle("interaction-state", "interaction-state-debug", "交互状态")}
                  ${debugToggle("agent-tool", "agent-tool-debug", "工具结果")}
                  ${debugToggle("labels", "labels-debug", "世界标签")}
                  ${debugToggle("grid", "grid-debug", "网格 / 坐标轴")}
                </div>
              </section>

              <section class="obs-right-panel" data-right-panel="inspect">
                <div class="obs-panel-heading"><span>运行时</span><strong>运行时检视</strong><small>关键状态、测量与后端观测值。</small></div>
                <div id="obs-inspector" class="obs-inspector"></div>
                <div class="obs-metrics-title"><span>测量</span><strong>测量数据</strong></div>
                <div id="obs-metrics" class="obs-metrics"></div>
                <div class="obs-metrics-title" data-gpu-diagnostics><span>WebGPU</span><strong>GPU 诊断实验</strong></div>
                <div class="obs-compute-probe" data-gpu-diagnostics>
                  <button id="obs-compute-probe" type="button">运行计算与回读测试</button>
                  <pre id="obs-compute-probe-result">尚未运行。仅验证当前 WebGPU renderer 的 storage buffer / compute / readback。</pre>
                  <button id="obs-spatial-probe" type="button">运行 GPU / CPU 空间对比</button><button id="obs-resident-culling-probe" type="button">显示 GPU 剔除</button><button id="obs-indirect-draw-probe" type="button">显示间接绘制</button><button id="obs-compaction-probe" type="button">显示 GPU 压缩</button>
                  <pre id="obs-spatial-probe-result">尚未运行。GPU 与 CPU 将对同一批位置做距离阈值筛选并逐项比对。</pre>
                </div>
              </section>
            </div>
          </aside>
        </main>

        <div class="obs-bottom-dock" aria-label="实验控制">
          <div class="obs-commandbar obs-glass-elevated">
            <button id="obs-run" class="obs-primary" type="button">${icon("play")}<span>运行</span><small>空格</small></button>
            <button id="obs-step" type="button">${icon("step")}<span>单步</span></button>
            <button id="obs-step10" type="button"><b>+10</b><span>帧</span></button>
            <i class="obs-dock-divider" aria-hidden="true"></i>
            <button id="obs-reset" class="obs-danger" type="button">${icon("reset")}<span>重置</span></button>
            <details class="obs-more">
              <summary aria-label="更多控制">${icon("more")}</summary>
              <div class="obs-more-menu obs-glass-elevated">
                <button id="obs-checkpoint" type="button">记录检查点</button>
                <button id="obs-restore" type="button" disabled>重放到检查点</button>
                <span>记录帧：<b id="obs-checkpoint-frame">—</b></span>
              </div>
            </details>
          </div>
          <div class="obs-sim-strip obs-glass-elevated">
            <span><small>帧</small><b id="obs-frame">0</b></span>
            <i></i>
            <span><small>仿真</small><b id="obs-time">0.000 s</b></span>
            <i></i>
            <span class="obs-active-op"><em></em><b id="obs-active-action">idle</b></span>
          </div>
        </div>
      </div>`;
}
