import { generationJobCenterMarkup } from '../authoring/GenerationJobCenter.js';
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
            <span>World</span>
            <select id="world-select" class="world-select" aria-label="Current world">${environmentOptions}</select>
          </label>
          <div id="runtime-status" class="runtime-status" data-state="loading" role="status" aria-live="polite">
            <i></i><span>Starting</span>
          </div>
          <button id="cinematic-toggle" class="header-button" type="button">Immersive</button>
          <button id="open-developer" class="icon-button" type="button" aria-label="Open developer settings" title="Developer settings">⋯</button>
        </div>
      </header>

      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="editor-toolbar" aria-label="Scene editor tools">
            <button data-mode="translate" class="active" type="button">Move <kbd>W</kbd></button>
            <button data-mode="rotate" type="button">Rotate <kbd>E</kbd></button>
            <span class="toolbar-divider"></span>
            <button id="duplicate" type="button">Duplicate</button>
            <button id="delete" class="danger" type="button">Delete</button>
            <details class="toolbar-more">
              <summary>Scene</summary>
              <div class="toolbar-menu">
                <button id="undo" type="button" disabled>Undo <kbd>⌘Z</kbd></button>
                <button id="redo" type="button" disabled>Redo</button>
                <button id="save-scene" type="button">Save locally</button>
                <button id="load-scene" type="button">Load local</button>
                <button id="export-scene" type="button">Export JSON</button>
                <button id="import-scene" type="button">Import JSON</button>
                <button id="reset-world" class="danger" type="button">Reset world</button>
              </div>
            </details>
            <input id="import-scene-file" type="file" accept="application/json,.json" hidden />
          </div>

          <div class="world-intro">
            <div class="world-kicker">${environmentDefinition.number} // ${environmentDefinition.title.toUpperCase()}</div>
            <h2>${environmentDefinition.headline}</h2>
            <p>${environmentDefinition.description}</p>
            <div class="world-facts">${environmentDefinition.facts.map((fact) => `<span>${fact}</span>`).join('')}</div>
          </div>
          <div class="hint">Click to select · W move · E rotate · Del delete</div>
        </div>

        <aside class="panel" data-view="task" aria-label="Context panel">
          <nav class="panel-tabs" aria-label="Workspace views">
            <button type="button" data-panel-view="task" class="active" aria-selected="true">Task</button>
            <button type="button" data-panel-view="create" aria-selected="false">Create</button>
            <button type="button" data-panel-view="inspect" aria-selected="false">Inspect</button>
            <button type="button" data-panel-view="runs" aria-selected="false">Runs</button>
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
          <input id="input" placeholder="Describe what you want to happen in the world…" aria-label="Agent task" />
        </div>
        <button type="submit"><span>Run Task</span></button>
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
    cinematicButton.textContent = enabled ? 'Edit' : 'Immersive';
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
