import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { STUDIO_NAVIGATION } from '../navigation/StudioNavigation.js';
import { GenerationJobCenterView } from './generation/GenerationJobCenterView';
import { DeveloperSettingsView } from './developer/DeveloperSettingsView';
import { useStudioStore } from './state/studioStore';
import { SceneExplorerView } from './scene/SceneExplorer';
import { ObjectInspectorView } from './inspect/ObjectInspector';
import { BuildWorkbenchView } from './build/BuildWorkbench';
import { ArtifactTrayView } from './artifacts/ArtifactTray';
import { TaskPanelView } from './agent/TaskPanelView';
import { RunsPanelView } from './runs/RunsPanelView';
import { ResourceLibraryView } from './resources/ResourceLibraryView';

type EnvironmentDefinition = {
  id:string;
  title:string;
  number?:string;
  headline?:string;
  description?:string;
  facts?:string[];
  worldFirst?:boolean;
};

type Bridge = {
  subscribe:(listener:()=>void)=>()=>void;
  getSnapshot:()=>any;
  notifyLayout:()=>void;
  openWorld:(id:string)=>Promise<unknown>;
};

function AuthoringMenu({ controller }: { controller:any }) {
  const state:any = useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const [selected,setSelected] = useState('');
  useEffect(()=>{
    if (state.status?.id) setSelected(state.status.id);
  },[state.status?.id]);
  return (
    <>
      <div className="toolbar-menu-label">创作世界</div>
      <select id="authoring-world-select" className="world-select" aria-label="创作世界存档" value={selected} onChange={(event)=>setSelected(event.target.value)}>
        <option value="">选择创作世界…</option>
        {state.worlds.map((world:any)=><option key={world.id} value={world.id}>{world.name || world.id}</option>)}
      </select>
      <button id="authoring-new" type="button" onClick={()=>void controller.createNew()}>新建创作世界</button>
      <button id="authoring-open" type="button" onClick={()=>void controller.open(selected)}>打开创作世界</button>
      <button id="authoring-save" type="button" onClick={()=>void controller.save()}>保存创作世界</button>
      <button id="authoring-save-as" type="button" onClick={()=>void controller.saveAs()}>另存创作世界</button>
      <span id="authoring-save-status" className="toolbar-menu-status">{state.status?.name || 'Untitled World'}{state.status?.dirty ? ' · 未保存' : ' · 已保存'}</span>
    </>
  );
}

function ConnectedSceneToolbar({ controls, authoring }: { controls:any; authoring:any }) {
  const state:any = useSyncExternalStore(controls.subscribe,controls.snapshot,controls.snapshot);
  const importRef = useRef<HTMLInputElement|null>(null);
  return (
    <div className="editor-toolbar" aria-label="场景编辑工具">
      <button data-mode="translate" className={state.mode === 'translate' ? 'active' : ''} type="button" onClick={()=>controls.setMode('translate')}>移动 <kbd>W</kbd></button>
      <button data-mode="rotate" className={state.mode === 'rotate' ? 'active' : ''} type="button" onClick={()=>controls.setMode('rotate')}>旋转 <kbd>E</kbd></button>
      <span className="toolbar-divider" />
      <button id="duplicate" type="button" onClick={()=>void controls.duplicate()}>复制</button>
      <button id="delete" className="danger" type="button" onClick={()=>void controls.deleteSelected()}>删除</button>
      <details className="toolbar-more scene-menu">
        <summary>场景</summary>
        <div className="toolbar-menu">
          <button id="undo" type="button" disabled={!state.history?.canUndo} onClick={()=>void controls.undo()}>撤销 <kbd>⌘Z</kbd></button>
          <button id="redo" type="button" disabled={!state.history?.canRedo} onClick={()=>void controls.redo()}>重做</button>
          {authoring ? <AuthoringMenu controller={authoring} /> : null}
          <div className="toolbar-menu-label">运行时场景</div>
          <button id="save-scene" type="button" onClick={()=>controls.saveScene()}>保存到本机</button>
          <button id="load-scene" type="button" onClick={()=>void controls.loadScene()}>加载本机存档</button>
          <button id="export-scene" type="button" onClick={()=>controls.exportScene()}>导出 JSON</button>
          <button id="import-scene" type="button" onClick={()=>importRef.current?.click()}>导入 JSON</button>
          <button id="reset-world" className="danger" type="button" disabled={state.resetBusy} onClick={()=>void controls.resetWorld()}>
            {state.resetBusy ? '正在重置…' : state.resetWorldArmed ? '确认重置' : '重置世界'}
          </button>
        </div>
      </details>
      <details className="toolbar-more debug-overlay-menu">
        <summary>调试图层</summary>
        <div className="toolbar-menu debug-layer-menu" id="debug-layer-menu" />
      </details>
      <input
        ref={importRef}
        id="import-scene-file"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event)=>{
          const file=event.target.files?.[0];
          if (file) void controls.importScene(file);
          event.target.value='';
        }}
      />
    </div>
  );
}

function SceneToolbar({ bridgeState }: { bridgeState:any }) {
  if (!bridgeState.sceneControls) {
    return <div className="editor-toolbar" aria-label="场景编辑工具" aria-busy="true"><span>场景工具启动中…</span><div id="debug-layer-menu" /></div>;
  }
  return <ConnectedSceneToolbar controls={bridgeState.sceneControls} authoring={bridgeState.authoring} />;
}

function CommandBar({ taskPanel, inputRef, draft }: { taskPanel:any; inputRef:React.RefObject<HTMLInputElement|null>; draft:any }) {
  const [value,setValue] = useState('');
  const state:any = useSyncExternalStore(taskPanel.subscribe,taskPanel.snapshot,taskPanel.snapshot);
  useEffect(()=>{
    if (!draft) return;
    setValue(draft.value || '');
    requestAnimationFrame(()=>inputRef.current?.focus());
  },[draft?.id,inputRef]);
  const submit = (event:FormEvent) => {
    event.preventDefault();
    const prompt = value.trim();
    if (!prompt || state.busy || !state.available) return;
    setValue('');
    void taskPanel.submit(prompt);
  };
  return (
    <form id="command" className="command-bar" autoComplete="off" onSubmit={submit}>
      <div className="command-field">
        <span className="command-prefix" aria-hidden="true">›</span>
        <input
          ref={inputRef}
          id="input"
          value={value}
          disabled={!state.available}
          readOnly={state.busy}
          onChange={(event)=>setValue(event.target.value)}
          placeholder="描述你希望这个世界发生什么…"
          aria-label="智能体任务"
        />
      </div>
      <button type="submit" disabled={state.busy || !state.available}><span>{state.busy ? '执行中…' : '执行任务'}</span></button>
    </form>
  );
}

export function StudioApp({
  bridge,
  environmentDefinition,
  environments
}: {
  bridge:Bridge;
  environmentDefinition:EnvironmentDefinition;
  environments:EnvironmentDefinition[];
}) {
  const bridgeState = useSyncExternalStore(bridge.subscribe,bridge.getSnapshot,bridge.getSnapshot);
  const activeWorkspace = useStudioStore((state)=>state.activeWorkspace);
  const activeContextView = useStudioStore((state)=>state.activeContextView);
  const contextOpen = useStudioStore((state)=>state.contextOpen);
  const buildAdvancedOpen = useStudioStore((state)=>state.buildAdvancedOpen);
  const selectedObjectId = useStudioStore((state)=>state.selectedObjectId);
  const worldPresentation = useStudioStore((state)=>state.worldPresentation);
  const openView = useStudioStore((state)=>state.openView);
  const closeContext = useStudioStore((state)=>state.closeContext);
  const setBuildAdvancedOpen = useStudioStore((state)=>state.setBuildAdvancedOpen);
  const [cinematic,setCinematic] = useState(false);
  const commandInputRef = useRef<HTMLInputElement|null>(null);

  const presentation = {
    ...environmentDefinition,
    ...(worldPresentation || {})
  };
  const worldId = presentation.id || environmentDefinition.id;
  const generated = Boolean(presentation.generated);
  const worldSelectValue = generated ? `runtime:${presentation.persistenceSource || worldId}` : worldId;

  const chooseView = (view:string) => openView(view as any);

  useEffect(()=>{
    bridge.notifyLayout();
    if (contextOpen && activeContextView === 'task') requestAnimationFrame(()=>commandInputRef.current?.focus());
  },[activeContextView,activeWorkspace,bridge,cinematic,contextOpen]);

  useEffect(()=>{
    const onKeyDown = (event:KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (cinematic) {
        setCinematic(false);
        return;
      }
      if (contextOpen) closeContext();
    };
    document.addEventListener('keydown',onKeyDown);
    return ()=>document.removeEventListener('keydown',onKeyDown);
  },[cinematic,closeContext,contextOpen]);

  const shellClass = [
    'shell',
    'spatial-editor',
    presentation.worldFirst ? 'world-first' : '',
    contextOpen ? 'context-open' : '',
    cinematic ? 'cinematic' : ''
  ].filter(Boolean).join(' ');

  const content = bridgeState.content;
  const agent = bridgeState.agent;

  return (
    <main className={shellClass} data-world={worldId} data-workspace={activeWorkspace} data-context-view={activeContextView}>
      <header className="brandbar">
        <div className="brand-lockup"><strong>AgentScape <em>Studio</em></strong><span>{presentation.title}</span></div>
        <div className="brand-actions">
          <label className="world-control">
            <span>世界</span>
            <select
              id="world-select"
              className="world-select"
              aria-label="当前世界"
              value={worldSelectValue}
              onChange={(event)=>{ if (!event.target.value.startsWith('runtime:')) void bridge.openWorld(event.target.value); }}
            >
              {environments.map((item)=><option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}
              {generated ? <option value={worldSelectValue}>GENERATED · {presentation.title}</option> : null}
            </select>
          </label>
          <button
            id="runtime-status"
            className={`runtime-status${bridgeState.runtimeStatus.recoveryAction ? ' is-actionable' : ''}`}
            data-state={bridgeState.runtimeStatus.state}
            type="button"
            disabled={!bridgeState.runtimeStatus.recoveryAction}
            aria-live="polite"
            onClick={()=>bridgeState.runtimeStatus.recoveryAction?.()}
          ><i /><span>{bridgeState.runtimeStatus.label}</span></button>
          <button id="cinematic-toggle" className="header-button" type="button" aria-pressed={cinematic} onClick={()=>setCinematic((value)=>!value)}>
            {cinematic ? '返回编辑' : '沉浸模式'}
          </button>
          <button id="open-developer" className="icon-button" type="button" aria-label="打开开发者设置" title="开发者设置" onClick={()=>bridgeState.developerOpenHandler?.()}>⋯</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="scene-panel">
          {content ? <SceneExplorerView {...content.sceneExplorer} /> : null}
        </aside>
        <div id="viewport" className="viewport">
          <SceneToolbar bridgeState={bridgeState} />
          <div className="world-intro">
            <div className="world-kicker">{presentation.number || 'WORLD'} // {String(presentation.title || worldId).toUpperCase()}</div>
            <h2>{presentation.headline || presentation.title}</h2>
            <p>{presentation.description || ''}</p>
            <div className="world-facts">{(presentation.facts || []).map((fact:string)=><span key={fact}>{fact}</span>)}</div>
          </div>
          <div className="hint">点击选择 · W 移动 · E 旋转 · Del 删除</div>
        </div>

        <aside className={`panel${buildAdvancedOpen ? ' build-advanced-open' : ''}`} data-view={activeContextView} aria-label="上下文面板">
          {agent ? <TaskPanelView controller={agent.taskPanel} /> : null}
          <div className="build-workbench-host">
            {content ? <BuildWorkbenchView {...content.buildWorkbench} /> : null}
          </div>
          <div className="build-advanced-shell">
            <div className="build-advanced-header">
              <button id="build-close-advanced" type="button" onClick={()=>setBuildAdvancedOpen(false)}>← 返回 Build Workbench</button>
              <span>Advanced Generation Console</span>
            </div>
            <GenerationJobCenterView />
          </div>
          {content ? <ResourceLibraryView {...content.resourceLibrary} /> : null}
          <section className="inspector">
            {content ? <ObjectInspectorView {...content.inspector} /> : null}
          </section>
          {agent ? <RunsPanelView controller={agent.runsPanel} /> : null}
        </aside>
      </section>

      <div className="artifact-tray-host">{content ? <ArtifactTrayView {...content.artifactTray} /> : null}</div>

      {agent ? <CommandBar taskPanel={agent.taskPanel} inputRef={commandInputRef} draft={bridgeState.commandDraft} /> : (
        <form id="command" className="command-bar" autoComplete="off">
          <div className="command-field"><span className="command-prefix" aria-hidden="true">›</span><input id="input" ref={commandInputRef} disabled placeholder="正在启动…" aria-label="智能体任务" /></div>
          <button type="submit" disabled><span>启动中…</span></button>
        </form>
      )}

      <DeveloperSettingsView />

      <nav className="world-dock" aria-label="Studio workspace">
        {STUDIO_NAVIGATION.map(({ view,label,group })=>{
          const selected = group === 'primary'
            ? (view === 'world' ? activeWorkspace === 'world' : view === 'create' ? activeWorkspace === 'create' : activeWorkspace === 'agent')
            : contextOpen && activeContextView === view;
          const hasSelection = view === 'inspect' && Boolean(selectedObjectId);
          return <button key={view} type="button" data-dock-view={view} data-dock-group={group} className={hasSelection ? 'has-selection' : ''} aria-pressed={selected} onClick={()=>chooseView(view)}>{label}</button>;
        })}
        {bridgeState.dockActions.map((action:any)=><button key={action.id} id={action.id} type="button" className={['dock-extension',action.className].filter(Boolean).join(' ')} title={action.title || action.label} onClick={action.onClick}>{action.label}</button>)}
      </nav>
    </main>
  );
}
