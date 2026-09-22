import { useEffect, useRef, useSyncExternalStore } from 'react';
import { DeveloperSettingsView } from './developer/DeveloperSettingsView';
import { WorldEditorWorkspace } from './world/WorldEditorWorkspace';
import { ProductHeader } from './shell/ProductHeader';
import { ProductPages } from './shell/ProductPages';
import { useStudioProductRouter } from './routing/useStudioProductRouter';
import { useStudioShellModel } from './shell/useStudioShellModel';
import { PersistentGenerationHost } from './shell/PersistentGenerationHost';

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
  const commandInputRef = useRef<HTMLInputElement|null>(null);
  const { commitLayoutChange, choosePage, chooseAgentView } = useStudioProductRouter(bridge.notifyLayout);
  const {
    activePage,
    agentView,
    buildAdvancedOpen,
    cinematic,
    sceneCollapsed,
    presentation,
    worldId,
    generated,
    worldSelectValue,
    shellClass,
    setBuildAdvancedOpen,
    setCinematic,
    setSceneCollapsed
  } = useStudioShellModel({ environmentDefinition, commitLayoutChange });

  useEffect(()=>{
    if (activePage === 'agent' && agentView === 'tasks') requestAnimationFrame(()=>commandInputRef.current?.focus());
  },[activePage,agentView]);

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

      <PersistentGenerationHost
        active={activePage === 'build' && buildAdvancedOpen}
        close={()=>setBuildAdvancedOpen(false)}
      />

      <DeveloperSettingsView />
    </main>
  );
}
