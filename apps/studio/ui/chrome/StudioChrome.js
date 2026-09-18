export function createStudioChrome({
  app,
  shell,
  panel,
  environmentDefinition,
  onViewChange = () => {}
}) {
  const tabs = [...app.querySelectorAll('[data-panel-view]')];
  const runtimeStatus = app.querySelector('#runtime-status');
  const runtimeStatusLabel = runtimeStatus?.querySelector('span');
  const commandForm = app.querySelector('#command');
  const commandInput = app.querySelector('#input');
  const commandButton = commandForm?.querySelector('button[type="submit"]');
  const cinematicButton = app.querySelector('#cinematic-toggle');
  const worldSelect = app.querySelector('#world-select');

  let onLayoutChange = () => {};
  let runtimeRecoveryAction = null;
  let activeView = 'create';
  let dock = null;
  const disposers = [];

  const listen = (target, type, listener, options) => {
    target?.addEventListener(type, listener, options);
    if (target) disposers.push(() => target.removeEventListener(type, listener, options));
  };

  const notifyLayout = () => requestAnimationFrame(() => onLayoutChange());

  const syncTabs = () => {
    for (const tab of tabs) {
      const selected = tab.dataset.panelView === activeView;
      tab.classList.toggle('active', selected);
      tab.setAttribute('aria-selected', selected ? 'true' : 'false');
    }
  };

  const syncDock = () => {
    if (!dock) return;
    for (const button of dock.querySelectorAll('[data-dock-view]')) {
      const selected = button.dataset.dockView === activeView && shell.classList.contains('context-open');
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    }
  };

  const closeContext = () => {
    shell.classList.remove('context-open');
    syncDock();
    notifyLayout();
  };

  const setView = (view, { focus = true } = {}) => {
    if (!tabs.some((tab) => tab.dataset.panelView === view)) return false;
    activeView = view;
    shell.classList.add('context-open');
    panel.dataset.view = view;
    shell.dataset.contextView = view;
    onViewChange(view);
    syncTabs();
    syncDock();
    notifyLayout();
    if (focus && view === 'task') requestAnimationFrame(() => commandInput?.focus());
    return true;
  };

  const setRuntimeStatus = (state, label) => {
    if (!runtimeStatus) return;
    runtimeStatus.dataset.state = state;
    if (runtimeStatusLabel) runtimeStatusLabel.textContent = label;
  };

  const setRuntimeRecoveryAction = (handler, label = null) => {
    runtimeRecoveryAction = typeof handler === 'function' ? handler : null;
    if (!runtimeStatus) return;
    runtimeStatus.disabled = !runtimeRecoveryAction;
    runtimeStatus.classList.toggle('is-actionable', Boolean(runtimeRecoveryAction));
    if (label && runtimeStatusLabel) runtimeStatusLabel.textContent = label;
  };

  listen(runtimeStatus, 'click', () => runtimeRecoveryAction?.());
  for (const tab of tabs) listen(tab, 'click', () => setView(tab.dataset.panelView));

  listen(worldSelect, 'change', (event) => {
    const url = new URL(location.href);
    url.searchParams.set('world', event.target.value);
    location.href = url.toString();
  });

  listen(cinematicButton, 'click', () => {
    const enabled = shell.classList.toggle('cinematic');
    cinematicButton.textContent = enabled ? '返回编辑' : '沉浸模式';
    cinematicButton.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    notifyLayout();
  });

  listen(document, 'keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (shell.classList.contains('cinematic')) {
      shell.classList.remove('cinematic');
      cinematicButton.textContent = '沉浸模式';
      cinematicButton.setAttribute('aria-pressed', 'false');
      notifyLayout();
      return;
    }
    if (environmentDefinition.worldFirst && shell.classList.contains('context-open')) closeContext();
  });

  if (environmentDefinition.worldFirst) {
    dock = document.createElement('nav');
    dock.className = 'world-dock';
    dock.setAttribute('aria-label', '世界工具');

    const entries = [
      ['world', '世界'],
      ['create', 'Build'],
      ['task', 'Agent'],
      ['resources', 'Library'],
      ['inspect', 'Inspect'],
      ['runs', 'Runs']
    ];

    for (const [view, label] of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.dockView = view;
      button.textContent = label;
      button.setAttribute('aria-pressed', 'false');
      listen(button, 'click', () => view === 'world' ? closeContext() : setView(view));
      dock.append(button);
    }

    shell.append(dock);
  }

  const addDockAction = ({ id, label, title = label, onClick, className = '' } = {}) => {
    if (!dock || !id || !label || typeof onClick !== 'function') return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = id;
    button.className = ['dock-extension', className].filter(Boolean).join(' ');
    button.textContent = label;
    button.title = title;
    listen(button, 'click', onClick);
    dock.append(button);
    return button;
  };

  return {
    dock,
    commandForm,
    commandInput,
    commandButton,
    setView,
    closeContext,
    addDockAction,
    setRuntimeStatus,
    setRuntimeRecoveryAction,
    setLayoutChangeHandler(handler) {
      onLayoutChange = typeof handler === 'function' ? handler : () => {};
    },
    destroy() {
      while (disposers.length) disposers.pop()?.();
      dock?.remove();
    }
  };
}
