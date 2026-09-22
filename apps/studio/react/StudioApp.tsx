import { useEffect, useRef, useSyncExternalStore } from 'react';
import { GenerationJobCenterView } from './generation/GenerationJobCenterView';
import { DeveloperSettingsView } from './developer/DeveloperSettingsView';
import { useStudioStore } from './state/studioStore';
import { WorldEditorWorkspace } from './world/WorldEditorWorkspace';
import { ProductHeader } from './shell/ProductHeader';
import { ProductPages } from './shell/ProductPages';
import { useStudioProductRouter } from './routing/useStudioProductRouter';

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
  const closeContext = useStudioStore((state)=>state.closeContext);
  const setBuildAdvancedOpen = useStudioStore((state)=>state.setBuildAdvancedOpen);
  const setCinematic = useStudioStore((state)=>state.setCinematic);
  const setSceneCollapsed = useStudioStore((state)=>state.setSceneCollapsed);
  const commandInputRef = useRef<HTMLInputElement|null>(null);
  const { commitLayoutChange, choosePage, chooseAgentView } = useStudioProductRouter(bridge.notifyLayout);

  const presentation = {
    ...environmentDefinition,
    ...(worldPresentation || {})
  };
  const worldId = presentation.id || environmentDefinition.id;
  const generated = Boolean(presentation.generated);
  const worldSelectValue = generated ? 'runtime:' + (presentation.persistenceSource || worldId) : worldId;

  useEffect(()=>{
    if (activePage === 'agent' && agentView === 'tasks') requestAnimationFrame(()=>commandInputRef.current?.focus());
  },[activePage,agentView]);

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
  },[activePage,cinematic,closeContext,commitLayoutChange,contextOpen,setCinematic]);

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
      <ProductHeader
        activePage={activePage}
        sceneCollapsed={sceneCollapsed}
        setSceneCollapsed={(value)=>commitLayoutChange(()=>setSceneCollapsed(value))}
        choosePage={choosePage}
        presentation={presentation}
        environments={environments}
        generated={generated}
        worldSelectValue={worldSelectValue}
        openWorld={bridge.openWorld}
        runtimeStatus={bridgeState.runtimeStatus}
        cinematic={cinematic}
        setCinematic={(value)=>commitLayoutChange(()=>setCinematic(value))}
        openDeveloper={()=>bridgeState.developerOpenHandler?.()}
      />

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
