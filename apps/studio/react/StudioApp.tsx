import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { flushSync } from 'react-dom';
import { PRODUCT_NAVIGATION } from '../navigation/StudioNavigation.js';
import { isProductNavigationActive, parseStudioRoute, studioProductUrl } from '../navigation/StudioRoutes.js';
import { GenerationJobCenterView } from './generation/GenerationJobCenterView';
import { DeveloperSettingsView } from './developer/DeveloperSettingsView';
import { useStudioStore, type ProductPage } from './state/studioStore';
import { BuildWorkbenchView } from './build/BuildWorkbench';
import { ArtifactTrayView } from './artifacts/ArtifactTray';
import { TaskPanelView } from './agent/TaskPanelView';
import { RunsPanelView } from './runs/RunsPanelView';
import { ResourceLibraryView } from './resources/ResourceLibraryView';
import { WorldEditorWorkspace } from './world/WorldEditorWorkspace';
import { WorldsPage } from './worlds/WorldsPage';

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
    <form id="command" className="command-bar product-command-bar" autoComplete="off" onSubmit={submit}>
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

function LoadingPage({ label }: { label:string }) {
  return <div className="product-page-loading" role="status">{label} 正在连接当前 World Runtime…</div>;
}

function ProductPages({
  activePage,
  bridgeState,
  environments,
  presentation,
  openBuiltinWorld,
  agentView,
  openAgentView,
  commandInputRef
}: {
  activePage:ProductPage;
  bridgeState:any;
  environments:EnvironmentDefinition[];
  presentation:any;
  openBuiltinWorld:(id:string)=>Promise<unknown>;
  agentView:'tasks'|'runs';
  openAgentView:(view:'tasks'|'runs')=>void;
  commandInputRef:React.RefObject<HTMLInputElement|null>;
}) {
  const content = bridgeState.content;
  const agent = bridgeState.agent;
  if (activePage === 'world') return null;

  return (
    <section className="product-page-layer" aria-label="AgentScape product page">
      {activePage === 'worlds' ? (
        <WorldsPage
          environments={environments}
          presentation={presentation}
          resources={content?.resourceLibrary?.resources || null}
          authoring={bridgeState.authoring}
          openBuiltinWorld={openBuiltinWorld}
          openGeneratedWorld={content?.resourceLibrary?.openGeneratedWorld}
        />
      ) : null}
      {activePage === 'build' ? (
        <section className="product-page product-build-page" data-product-page="build">
          {content ? (
            <>
              <div className="product-feature-frame product-build-surface"><BuildWorkbenchView {...content.buildWorkbench} /></div>
              <div className="product-artifact-tray"><ArtifactTrayView {...content.artifactTray} /></div>
            </>
          ) : <LoadingPage label="Build" />}
        </section>
      ) : null}

      {activePage === 'assets' ? (
        <section className="product-page product-assets-page" data-product-page="assets">
          {content ? <div className="product-feature-frame product-assets-surface"><ResourceLibraryView {...content.resourceLibrary} /></div> : <LoadingPage label="Assets" />}
        </section>
      ) : null}

      {activePage === 'agent' ? (
        <section className="product-page product-agent-page" data-product-page="agent">
          <nav className="product-subnav" aria-label="Agent sections">
            <button type="button" aria-pressed={agentView === 'tasks'} onClick={()=>openAgentView('tasks')}>Tasks</button>
            <button type="button" aria-pressed={agentView === 'runs'} onClick={()=>openAgentView('runs')}>Runs</button>
          </nav>
          <div className="product-feature-frame product-agent-surface">
            {agent ? (
              agentView === 'tasks'
                ? <TaskPanelView controller={agent.taskPanel} />
                : <RunsPanelView controller={agent.runsPanel} />
            ) : <LoadingPage label="Agent" />}
          </div>
          {agent && agentView === 'tasks' ? <CommandBar taskPanel={agent.taskPanel} inputRef={commandInputRef} draft={bridgeState.commandDraft} /> : null}
        </section>
      ) : null}
    </section>
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
  const activePage = useStudioStore((state)=>state.product.activePage);
  const agentView = useStudioStore((state)=>state.product.agentView);
  const contextOpen = useStudioStore((state)=>state.layout.contextOpen);
  const buildAdvancedOpen = useStudioStore((state)=>state.layout.buildAdvancedOpen);
  const cinematic = useStudioStore((state)=>state.layout.cinematic);
  const sceneCollapsed = useStudioStore((state)=>state.layout.sceneCollapsed);
  const worldPresentation = useStudioStore((state)=>state.view.worldPresentation);
  const openPage = useStudioStore((state)=>state.openPage);
  const openAgentView = useStudioStore((state)=>state.openAgentView);
  const closeContext = useStudioStore((state)=>state.closeContext);
  const setBuildAdvancedOpen = useStudioStore((state)=>state.setBuildAdvancedOpen);
  const setCinematic = useStudioStore((state)=>state.setCinematic);
  const setSceneCollapsed = useStudioStore((state)=>state.setSceneCollapsed);
  const commandInputRef = useRef<HTMLInputElement|null>(null);

  const presentation = {
    ...environmentDefinition,
    ...(worldPresentation || {})
  };
  const worldId = presentation.id || environmentDefinition.id;
  const generated = Boolean(presentation.generated);
  const worldSelectValue = generated ? 'runtime:' + (presentation.persistenceSource || worldId) : worldId;

  const commitLayoutChange = (change:()=>void) => {
    flushSync(change);
    bridge.notifyLayout();
  };

  const choosePage = (page:ProductPage) => {
    commitLayoutChange(()=>openPage(page));
    globalThis.history?.pushState?.(
      globalThis.history.state,
      '',
      studioProductUrl(globalThis.location?.href || 'http://127.0.0.1/',{ page })
    );
  };

  const chooseAgentView = (view:'tasks'|'runs') => {
    commitLayoutChange(()=>openAgentView(view));
    globalThis.history?.pushState?.(
      globalThis.history.state,
      '',
      studioProductUrl(globalThis.location?.href || 'http://127.0.0.1/',{ page:'agent', agentView:view })
    );
  };

  useEffect(()=>{
    if (activePage === 'agent' && agentView === 'tasks') requestAnimationFrame(()=>commandInputRef.current?.focus());
  },[activePage,agentView]);

  useEffect(()=>{
    const onPopState = () => {
      const route=parseStudioRoute(globalThis.location?.href || 'http://127.0.0.1/');
      commitLayoutChange(()=>{
        if (route.page === 'agent') openAgentView(route.agentView);
        else openPage(route.page as ProductPage);
      });
    };
    globalThis.window?.addEventListener?.('popstate',onPopState);
    return ()=>globalThis.window?.removeEventListener?.('popstate',onPopState);
  },[bridge,openAgentView,openPage]);

  useEffect(()=>{
    const onKeyDown = (event:KeyboardEvent) => {
      if (event.key !== 'Escape' || activePage !== 'world') return;
      if (cinematic) {
        commitLayoutChange(()=>setCinematic(false));
        return;
      }
      if (contextOpen) commitLayoutChange(closeContext);
    };
    document.addEventListener('keydown',onKeyDown);
    return ()=>document.removeEventListener('keydown',onKeyDown);
  },[activePage,bridge,cinematic,closeContext,contextOpen,setCinematic]);

  const shellClass = [
    'shell',
    'spatial-editor',
    presentation.worldFirst ? 'world-first' : '',
    activePage === 'world' && contextOpen ? 'context-open' : '',
    sceneCollapsed ? 'scene-collapsed' : '',
    activePage === 'world' && cinematic ? 'cinematic' : '',
    activePage !== 'world' ? 'product-page-open' : ''
  ].filter(Boolean).join(' ');

  return (
    <main className={shellClass} data-world={worldId} data-page={activePage} data-agent-view={agentView}>
      <header className="brandbar">
        <div className="brand-lockup">
          {activePage === 'world' ? (
            <button
              id="scene-sidebar-toggle"
              className="scene-sidebar-toggle"
              type="button"
              aria-label={sceneCollapsed ? '展开场景侧边栏' : '收起场景侧边栏'}
              aria-expanded={!sceneCollapsed}
              title={sceneCollapsed ? '展开场景侧边栏' : '收起场景侧边栏'}
              onClick={()=>commitLayoutChange(()=>setSceneCollapsed(!sceneCollapsed))}
            ><span aria-hidden="true">{sceneCollapsed ? '›' : '‹'}</span></button>
          ) : null}
          <strong>AgentScape <em>Studio</em></strong><span>{presentation.title}</span>
        </div>

        <nav className="product-navigation" aria-label="AgentScape product">
          {PRODUCT_NAVIGATION.map((item:any)=>(
            item.href ? (
              <a key={item.page} href={item.href}>{item.label}</a>
            ) : (
              <button
                key={item.page}
                type="button"
                data-product-nav={item.page}
                aria-pressed={isProductNavigationActive(activePage,item.page)}
                onClick={()=>choosePage(item.page as ProductPage)}
              >{item.label}</button>
            )
          ))}
        </nav>

        <div className="brand-actions">
          {activePage !== 'worlds' ? (
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
          ) : null}
          <button
            id="runtime-status"
            className={'runtime-status' + (bridgeState.runtimeStatus.recoveryAction ? ' is-actionable' : '')}
            data-state={bridgeState.runtimeStatus.state}
            type="button"
            disabled={!bridgeState.runtimeStatus.recoveryAction}
            aria-live="polite"
            onClick={()=>bridgeState.runtimeStatus.recoveryAction?.()}
          ><i /><span>{bridgeState.runtimeStatus.label}</span></button>
          {activePage === 'world' ? (
            <button id="cinematic-toggle" className="header-button" type="button" aria-pressed={cinematic} onClick={()=>commitLayoutChange(()=>setCinematic(!cinematic))}>
              {cinematic ? '返回编辑' : '沉浸模式'}
            </button>
          ) : null}
          <button id="open-developer" className="icon-button" type="button" aria-label="打开开发者设置" title="开发者设置" onClick={()=>bridgeState.developerOpenHandler?.()}>⋯</button>
        </div>
      </header>

      <WorldEditorWorkspace
        bridgeState={bridgeState}
        presentation={presentation}
        active={activePage === 'world'}
        notifyLayout={bridge.notifyLayout}
      />

      <ProductPages
        activePage={activePage}
        bridgeState={bridgeState}
        environments={environments}
        presentation={presentation}
        openBuiltinWorld={bridge.openWorld}
        agentView={agentView}
        openAgentView={chooseAgentView}
        commandInputRef={commandInputRef}
      />

      <section
        className={'persistent-generation-host' + (activePage === 'build' && buildAdvancedOpen ? ' is-active' : '')}
        aria-hidden={!(activePage === 'build' && buildAdvancedOpen)}
      >
        <div className="product-page product-advanced-page">
          <div className="product-page-toolbar">
            <button id="build-close-advanced" type="button" onClick={()=>setBuildAdvancedOpen(false)}>← 返回 Build</button>
            <span>Advanced Generation Console</span>
          </div>
          <GenerationJobCenterView />
        </div>
      </section>

      <DeveloperSettingsView />
    </main>
  );
}
