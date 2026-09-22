import { useEffect, useState, useSyncExternalStore, type FormEvent, type RefObject } from 'react';
import { BuildWorkbenchView } from '../build/BuildWorkbench';
import { ArtifactTrayView } from '../artifacts/ArtifactTray';
import { TaskPanelView } from '../agent/TaskPanelView';
import { RunsPanelView } from '../runs/RunsPanelView';
import { ResourceLibraryView } from '../resources/ResourceLibraryView';
import { WorldsPage } from '../worlds/WorldsPage';
import type { ProductPage } from '../state/studioStore';

type EnvironmentDefinition = {
  id:string;
  title:string;
  number?:string;
};

function CommandBar({ taskPanel, inputRef, draft }: { taskPanel:any; inputRef:RefObject<HTMLInputElement|null>; draft:any }) {
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

export function ProductPages({
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
  commandInputRef:RefObject<HTMLInputElement|null>;
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
