import { generationJobCenterMarkup } from './generation/GenerationJobCenter.js';
import { taskPanelMarkup } from './task/TaskPanel.js';
import { objectInspectorMarkup } from './inspect/ObjectInspector.js';
import { runsPanelMarkup } from './runs/RunsPanel.js';
import { developerSettingsMarkup } from './developer/DeveloperSettings.js';

export function createAppShell({ app, environmentDefinition, environments }) {
  const environmentOptions = environments.map((item) => `
    <option value="${item.id}"${item.id === environmentDefinition.id ? ' selected' : ''}>
      ${item.number} · ${item.title}
    </option>`).join('');

  app.innerHTML = `
    <main class="shell" data-world="${environmentDefinition.id}">
      <header class="brandbar">
        <div class="brand-lockup">
          <strong>AgentScape</strong>
          <span>${environmentDefinition.title}</span>
        </div>
        <div class="brand-actions">
          <label class="world-control">
            <span>世界</span>
            <select id="world-select" class="world-select" aria-label="当前世界">${environmentOptions}</select>
          </label>
          <div id="runtime-status" class="runtime-status" data-state="loading" role="status" aria-live="polite">
            <i></i><span>启动中</span>
          </div>
          <button id="cinematic-toggle" class="header-button" type="button">沉浸模式</button>
          <button id="open-developer" class="icon-button" type="button" aria-label="打开开发者设置" title="开发者设置">⋯</button>
        </div>
      </header>

      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="editor-toolbar" aria-label="场景编辑工具">
            <button data-mode="translate" class="active" type="button">移动 <kbd>W</kbd></button>
            <button data-mode="rotate" type="button">旋转 <kbd>E</kbd></button>
            <span class="toolbar-divider"></span>
            <button id="duplicate" type="button">复制</button>
            <button id="delete" class="danger" type="button">删除</button>
            <details class="toolbar-more">
              <summary>场景</summary>
              <div class="toolbar-menu">
                <button id="undo" type="button" disabled>撤销 <kbd>⌘Z</kbd></button>
                <button id="redo" type="button" disabled>重做</button>
                <button id="save-scene" type="button">保存到本机</button>
                <button id="load-scene" type="button">加载本机存档</button>
                <button id="export-scene" type="button">导出 JSON</button>
                <button id="import-scene" type="button">导入 JSON</button>
                <button id="reset-world" class="danger" type="button">重置世界</button>
              </div>
            </details>
            <details class="toolbar-more debug-overlay-menu">
              <summary>调试图层</summary>
              <div class="toolbar-menu debug-layer-menu" id="debug-layer-menu"></div>
            </details>
            <input id="import-scene-file" type="file" accept="application/json,.json" hidden />
          </div>

          <div class="world-intro">
            <div class="world-kicker">${environmentDefinition.number} // ${environmentDefinition.title.toUpperCase()}</div>
            <h2>${environmentDefinition.headline}</h2>
            <p>${environmentDefinition.description}</p>
            <div class="world-facts">${environmentDefinition.facts.map((fact) => `<span>${fact}</span>`).join('')}</div>
          </div>
          <div class="hint">点击选择 · W 移动 · E 旋转 · Del 删除</div>
        </div>

        <aside class="panel" data-view="task" aria-label="上下文面板">
          <nav class="panel-tabs" aria-label="工作区视图">
            <button type="button" data-panel-view="task" class="active" aria-selected="true">任务</button>
            <button type="button" data-panel-view="create" aria-selected="false">创建</button>
            <button type="button" data-panel-view="inspect" aria-selected="false">检查</button>
            <button type="button" data-panel-view="runs" aria-selected="false">记录</button>
          </nav>
          ${taskPanelMarkup()}
          ${generationJobCenterMarkup()}
          ${objectInspectorMarkup()}
          ${runsPanelMarkup()}
        </aside>
      </section>

      <form id="command" class="command-bar" autocomplete="off">
        <div class="command-field">
          <span class="command-prefix" aria-hidden="true">›</span>
          <input id="input" placeholder="描述你希望这个世界发生什么…" aria-label="智能体任务" />
        </div>
        <button type="submit"><span>执行任务</span></button>
      </form>

      ${developerSettingsMarkup()}
    </main>`;

  const shell = app.querySelector('.shell');
  const panel = app.querySelector('.panel');
  const tabs = [...app.querySelectorAll('[data-panel-view]')];
  const runtimeStatus = app.querySelector('#runtime-status');
  const runtimeStatusLabel = runtimeStatus.querySelector('span');
  const commandForm = app.querySelector('#command');
  const commandInput = app.querySelector('#input');
  const commandButton = commandForm.querySelector('button[type="submit"]');
  const cinematicButton = app.querySelector('#cinematic-toggle');
  let onLayoutChange = () => {};

  const setView = (view) => {
    panel.dataset.view = view;
    for (const tab of tabs) {
      const active = tab.dataset.panelView === view;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    requestAnimationFrame(() => onLayoutChange());
  };

  const setRuntimeStatus = (state, label) => {
    runtimeStatus.dataset.state = state;
    runtimeStatusLabel.textContent = label;
  };

  tabs.forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.panelView)));
  app.querySelector('#world-select').addEventListener('change', (event) => {
    const url = new URL(location.href);
    url.searchParams.set('world', event.target.value);
    location.href = url.toString();
  });
  cinematicButton.addEventListener('click', () => {
    const enabled = shell.classList.toggle('cinematic');
    cinematicButton.textContent = enabled ? '返回编辑' : '沉浸模式';
    requestAnimationFrame(() => onLayoutChange());
  });

  return {
    shell,
    panel,
    viewport: app.querySelector('#viewport'),
    commandForm,
    commandInput,
    commandButton,
    developerButton: app.querySelector('#open-developer'),
    developerDialog: app.querySelector('#developer-dialog'),
    setView,
    setRuntimeStatus,
    setLayoutChangeHandler(handler) { onLayoutChange = handler || (() => {}); }
  };
}
