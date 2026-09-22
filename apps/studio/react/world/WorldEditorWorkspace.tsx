import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { WORLD_EDITOR_UTILITIES } from '../../navigation/StudioNavigation.js';
import { ArtifactTrayView } from '../artifacts/ArtifactTray';
import { AuthoringPromotionView } from '../authoring/AuthoringPromotionView';
import { ObjectInspectorView } from '../inspect/ObjectInspector';
import { SceneExplorerView } from '../scene/SceneExplorer';
import { useStudioStore } from '../state/studioStore';

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
        {state.worlds.map((item:any)=><option key={item.id} value={item.id}>{item.name || item.id}</option>)}
      </select>
      <button id="authoring-new" type="button" onClick={()=>void controller.createNew()}>新建创作世界</button>
      <button id="authoring-open" type="button" onClick={()=>void controller.open(selected)}>打开创作世界</button>
      <button id="authoring-save" type="button" onClick={()=>void controller.save()}>保存创作世界</button>
      <button id="authoring-save-as" type="button" onClick={()=>void controller.saveAs()}>另存创作世界</button>
      <span id="authoring-save-status" className="toolbar-menu-status">{state.status?.name || 'Untitled World'}{state.status?.dirty ? ' · 未保存' : ' · 已保存'}</span>
      <AuthoringPromotionView state={state} controller={controller} />
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

export function WorldEditorWorkspace({
  bridgeState,
  presentation,
  active,
  notifyLayout
}: {
  bridgeState:any;
  presentation:any;
  active:boolean;
  notifyLayout:()=>void;
}) {
  const contextOpen = useStudioStore((state)=>state.layout.contextOpen);
  const sceneCollapsed = useStudioStore((state)=>state.layout.sceneCollapsed);
  const selection = useStudioStore((state)=>state.editor.selection);
  const openView = useStudioStore((state)=>state.openView);
  const closeContext = useStudioStore((state)=>state.closeContext);
  const content = bridgeState.content;

  const commitLayoutChange = (change:()=>void) => {
    flushSync(change);
    notifyLayout();
  };

  const chooseUtility = (view:'inspect') => {
    commitLayoutChange(()=>{
      if (contextOpen) closeContext();
      else openView(view);
    });
  };

  return (
    <section className={'world-editor-workspace' + (active ? ' is-active' : ' is-background')} aria-label="World Editor" aria-hidden={!active}>
      <section className="workspace">
        <aside className="scene-panel" aria-hidden={sceneCollapsed}>
          {content ? <SceneExplorerView {...content.sceneExplorer} /> : null}
        </aside>
        <div id="viewport" className="viewport">
          <SceneToolbar bridgeState={bridgeState} />
          <div className="world-intro">
            <div className="world-kicker">{presentation.number || 'WORLD'} // {String(presentation.title || presentation.id).toUpperCase()}</div>
            <h2>{presentation.headline || presentation.title}</h2>
            <p>{presentation.description || ''}</p>
            <div className="world-facts">{(presentation.facts || []).map((fact:string)=><span key={fact}>{fact}</span>)}</div>
          </div>
          <div className="hint">点击选择 · W 移动 · E 旋转 · Del 删除</div>
        </div>

        <aside className="panel" data-view="inspect" aria-label="上下文面板">
          <section className="inspector">
            {content ? <ObjectInspectorView {...content.inspector} /> : null}
          </section>
        </aside>
      </section>

      <div className="artifact-tray-host world-artifact-tray">{content ? <ArtifactTrayView {...content.artifactTray} /> : null}</div>

      <nav className="utility-rail" aria-label="World Editor utilities">
        {WORLD_EDITOR_UTILITIES.map(({ view,label })=>{
          const selected = contextOpen && view === 'inspect';
          const hasSelection = view === 'inspect' && Boolean(selection);
          return (
            <button
              key={view}
              type="button"
              data-dock-view={view}
              data-dock-group="utility"
              className={hasSelection ? 'has-selection' : ''}
              aria-pressed={selected}
              title={label}
              onClick={()=>chooseUtility(view as 'inspect')}
            >
              <span>{label}</span>
            </button>
          );
        })}
        {bridgeState.dockActions.length ? <span className="utility-rail-divider" aria-hidden="true" /> : null}
        {bridgeState.dockActions.map((action:any)=>(
          <button
            key={action.id}
            id={action.id}
            type="button"
            className={['dock-extension',action.className].filter(Boolean).join(' ')}
            title={action.title || action.label}
            onClick={action.onClick}
          >
            <span>{action.label}</span>
          </button>
        ))}
      </nav>
    </section>
  );
}
