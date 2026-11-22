import { SelectionActionDock } from './SelectionActionDock';
import { StudioMcpConnection } from './StudioMcpConnection';
import { StudioIcon } from '../shared/StudioIcon';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { WORLD_EDITOR_UTILITIES } from '../../navigation/StudioNavigation.js';
import { ArtifactTrayView } from '../artifacts/ArtifactTray';
import { AuthoringPromotionView } from '../authoring/AuthoringPromotionView';
import { ObjectInspectorView } from '../inspect/ObjectInspector';
import { SceneExplorerView } from '../scene/SceneExplorer';
import { useStudioStore } from '../state/studioStore';
import { TaskPanelView } from '../agent/TaskPanelView';
import { CommandBar } from '../shell/ProductPages';
import { CodeProjectEditor, CodeProjectActions, emptyCodeSubscribe, emptyCodeSnapshot } from './CodeProjectWorkbench';
import { CodeWorldVisualEditor } from './CodeWorldVisualEditor';
import { guardAsync } from '../shared/guardAsync';

function AuthoringMenu({ controller }: { controller:any }) {
  const state:any = useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const [selected,setSelected] = useState('');
  const authoringActive = state.status?.active === true;
  useEffect(()=>{
    setSelected(authoringActive && state.status?.id ? state.status.id : '');
  },[authoringActive,state.status?.id]);
  const statusLabel = authoringActive
    ? `${state.status?.name==='Untitled World'?'未命名草稿':state.status?.name || '未命名草稿'}${!state.status?.id ? ' · 尚未保存' : state.status?.dirty ? ' · 有未保存更改' : ' · 已保存'}`
    : '当前世界 · 未启用创作草稿';
  return (
    <>
      <div className="toolbar-menu-label">创作世界</div>
      <select id="authoring-world-select" className="world-select" aria-label="创作世界存档" value={selected} onChange={(event)=>setSelected(event.target.value)}>
        <option value="">选择创作世界…</option>
        {state.worlds.map((item:any)=><option key={item.id} value={item.id}>{item.name || item.id}</option>)}
      </select>
      <button id="authoring-new" type="button" onClick={()=>guardAsync('新建草稿', () => controller.createNew())}>新建草稿</button>
      <button id="authoring-open" disabled={!selected} type="button" onClick={()=>guardAsync('打开草稿', () => controller.open(selected))}>打开草稿</button>
      <button id="authoring-save" disabled={!authoringActive} type="button" onClick={()=>guardAsync('保存草稿', () => controller.save())}>保存草稿</button>
      <button id="authoring-save-as" disabled={!authoringActive} type="button" onClick={()=>guardAsync('草稿另存为', () => controller.saveAs())}>草稿另存为</button>
      <span id="authoring-save-status" className="toolbar-menu-status">{statusLabel}</span>
      {state.fileError ? <span className="toolbar-menu-status" role="alert">{state.fileError}</span> : null}
      {authoringActive ? <AuthoringPromotionView state={state} controller={controller} /> : null}
    </>
  );
}

function ConnectedSceneToolbar({ controls, authoring }: { controls:any; authoring:any }) {
  const state:any = useSyncExternalStore(controls.subscribe,controls.snapshot,controls.snapshot);
  const importRef = useRef<HTMLInputElement|null>(null);
  const worldImportRef = useRef<HTMLInputElement|null>(null);
  const selection = useStudioStore(state=>state.editor.selection);
  const interactionMode=useStudioStore(state=>state.editor.interactionMode);
  const setInteractionMode=useStudioStore(state=>state.setInteractionMode);
  const exploring=interactionMode!=='edit';
  const worldFirst=useStudioStore(state=>Boolean(state.view.worldPresentation?.worldFirst));
  return (
    <div className="editor-toolbar" aria-label="场景编辑工具">
      <div role="group" aria-label="世界交互模式">
        <button type="button" aria-pressed={exploring} title={worldFirst ? '进入第一/第三人称漫游' : '此世界不提供第一人称漫游，仅可查看'} onClick={()=>setInteractionMode('explore')}>{worldFirst ? '探索' : '只读'}</button>
        <button type="button" aria-pressed={!exploring} onClick={()=>setInteractionMode('edit')}>编辑</button>
      </div>
      <button id="undo" title="撤销 (Ctrl+Z)" aria-label="撤销" type="button" disabled={exploring || !state.history?.canUndo} onClick={()=>guardAsync('撤销', () => controls.undo())}><StudioIcon name="undo" /></button>
      <button id="redo" title="重做 (Ctrl+Shift+Z)" aria-label="重做" type="button" disabled={exploring || !state.history?.canRedo} onClick={()=>guardAsync('重做', () => controls.redo())}><StudioIcon name="redo" /></button>
      <span className="toolbar-divider" />
      <button disabled={exploring} data-mode="translate" className={state.mode === 'translate' ? 'active' : ''} type="button" onClick={()=>controls.setMode('translate')}><StudioIcon name="move" size={16} />移动 <kbd>W</kbd></button>
      <button disabled={exploring} data-mode="rotate" className={state.mode === 'rotate' ? 'active' : ''} type="button" onClick={()=>controls.setMode('rotate')}><StudioIcon name="rotate" size={16} />旋转 <kbd>E</kbd></button>
      <span className="toolbar-divider" />
      <button id="duplicate" disabled={exploring || selection?.source!=='runtime'} type="button" onClick={()=>guardAsync('复制对象', () => controls.duplicate())}>复制</button>
      <button id="delete" className="danger" disabled={exploring || selection?.source!=='runtime'} type="button" onClick={()=>guardAsync('删除对象', () => controls.deleteSelected())}>删除</button>
      <details className="toolbar-more scene-menu">
        <summary>保存与文件 <span aria-hidden="true">⌄</span></summary>
        <div className="toolbar-menu">
          {authoring ? <AuthoringMenu controller={authoring} /> : null}
          <div className="toolbar-menu-label">运行时场景</div>
          <button id="save-scene" type="button" onClick={()=>controls.saveScene()}>保存到本机</button>
          <button id="load-scene" type="button" onClick={()=>guardAsync('加载本机存档', () => controls.loadScene())}>加载本机存档</button>
          <button id="export-scene" type="button" onClick={()=>controls.exportScene()}>导出 JSON</button>
          <button id="export-world-package" type="button" onClick={()=>guardAsync('导出世界包', () => controls.exportWorldPackage())}>导出世界包</button>
          <button id="import-scene" type="button" onClick={()=>importRef.current?.click()}>导入 JSON</button>
          <button id="import-world-package" type="button" onClick={()=>worldImportRef.current?.click()}>导入世界包</button>
          {state.fileStatus ? <span id="scene-file-status" className="toolbar-menu-status" role="status">{state.fileStatus}</span> : null}
          <button id="reset-world" className="danger" type="button" disabled={state.resetBusy} onClick={()=>guardAsync('重置世界', () => controls.resetWorld())}>
            {state.resetBusy ? '正在重置…' : state.resetWorldArmed ? '确认重置' : '重置世界'}
          </button>
        </div>
      </details>
      <details className="toolbar-more debug-overlay-menu">
        <summary>调试图层</summary>
        <div className="toolbar-menu debug-layer-menu" id="debug-layer-menu" />
      </details>
      <input
        ref={worldImportRef}
        id="import-world-package-file"
        type="file"
        accept=".asworld,application/octet-stream"
        hidden
        onChange={(event)=>{
          const file=event.target.files?.[0];
          if(file)guardAsync('导入世界包', () => controls.importWorldPackage(file));
          event.target.value='';
        }}
      />
      <input
        ref={importRef}
        id="import-scene-file"
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event)=>{
          const file=event.target.files?.[0];
          if (file) guardAsync('导入场景', () => controls.importScene(file));
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
  const projects=bridgeState.codeProjects;
  const projectState:any=useSyncExternalStore(projects?.subscribe || emptyCodeSubscribe, projects?.snapshot || emptyCodeSnapshot, projects?.snapshot || emptyCodeSnapshot);
  const interactionMode=useStudioStore(state=>state.editor.interactionMode);
  const contextOpen = useStudioStore((state)=>state.layout.contextOpen);
  const contextView = useStudioStore((state)=>state.layout.activeContextView);
  const sceneCollapsed = useStudioStore((state)=>state.layout.sceneCollapsed);
  const selection = useStudioStore((state)=>state.editor.selection);
  const openView = useStudioStore((state)=>state.openView);
  const closeContext = useStudioStore((state)=>state.closeContext);
  const content = bridgeState.content;
  const commandInputRef=useRef<HTMLInputElement|null>(null);
  const [codeMode,setCodeMode]=useState<'code'|'visual'>('code');

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
    <section className={'world-editor-workspace' + (active ? ' is-active' : ' is-background') + (projectState.visible ? ' code-project-mode' : '')} aria-label="World Editor" aria-hidden={!active}>
      <section className="workspace">
        <aside className="scene-panel" aria-hidden={sceneCollapsed}>
          {projectState.visible ? <>
            <div className="code-world-mode-tabs" role="group" aria-label="代码世界编辑方式">
              <button type="button" aria-pressed={codeMode==='code'} onClick={()=>setCodeMode('code')}>源码</button>
              <button type="button" aria-pressed={codeMode==='visual'} onClick={()=>setCodeMode('visual')}>可视化</button>
            </div>
            <div className="code-world-source-host" hidden={codeMode!=='code'}>
              <CodeProjectEditor controller={projects} />
            </div>
            {codeMode==='visual' ? <CodeWorldVisualEditor controller={projects} /> : null}
          </> : content ? <SceneExplorerView {...content.sceneExplorer} /> : null}
        </aside>
        {projectState.visible ? <div className="editor-toolbar"><strong>{projectState.project?.name || '完整代码项目'}</strong><span>{projectState.active ? '代码世界运行中 · 可切换可视化编辑' : '编辑源码后运行'}</span></div> : <SceneToolbar bridgeState={bridgeState} />}
        <div id="viewport" className="viewport">
          {active && content && !projectState.active ? <SelectionActionDock {...content.inspector} openInspect={()=>commitLayoutChange(()=>openView('inspect'))} /> : null}

        </div>

        <aside className={'panel'+(contextView==='task'?' task-mode-panel':'')} data-view={contextView} aria-label="上下文面板">
          <div className="inspector-chrome">
            <button id="world-inspect-mode" type="button" aria-pressed={contextView==='inspect'} onClick={()=>commitLayoutChange(()=>openView('inspect'))}>对象属性</button>
            <button id="world-task-mode" type="button" aria-pressed={contextView==='task'} onClick={()=>commitLayoutChange(()=>openView('world-task'))}>任务过程</button>
            <button type="button" aria-label="关闭上下文面板" onClick={()=>commitLayoutChange(closeContext)}><StudioIcon name="close" size={17} /></button>
          </div>
          {contextView==='task' ? <div className="world-task-content">
            {active && bridgeState.agent ? <><TaskPanelView controller={bridgeState.agent.taskPanel} /><CommandBar taskPanel={bridgeState.agent.taskPanel} inputRef={commandInputRef} draft={bridgeState.commandDraft} /></> : <p role="status">任务面板启动中…</p>}
          </div> : <section className="inspector">
            {active && contextOpen && projectState.visible ? <CodeProjectActions controller={projects} /> : active && contextOpen && content ? <ObjectInspectorView key={selection?.source+':'+selection?.id} {...content.inspector} /> : null}
          </section>}
        </aside>
        <div className="editor-statusbar"><span>{projectState.active ? projectState.project?.name : presentation.title}</span><span>{projectState.active ? '完整代码项目 · 动态动作可由 AI 调用' : selection ? '已选中 '+selection.id : '点击画布或左侧列表选择对象'}</span></div>
      </section>

      <div className="artifact-tray-host world-artifact-tray">{content && !projectState.active ? <ArtifactTrayView {...content.artifactTray} /> : null}</div>

      <nav className="utility-rail" aria-label="World Editor utilities">
        {projects ? <button type="button" onClick={()=>{projects.show();commitLayoutChange(()=>openView('inspect'));}}>代码世界</button> : null}
        {bridgeState.liveBridge ? <StudioMcpConnection controller={bridgeState.liveBridge} /> : null}
        <button id="open-world-task" type="button" aria-pressed={contextOpen && contextView==='task'} onClick={()=>commitLayoutChange(()=>openView('world-task'))}>任务</button>
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
        {bridgeState.dockActions.length && !projectState.active ? <span className="utility-rail-divider" aria-hidden="true" /> : null}
        {(projectState.active ? [] : bridgeState.dockActions).map((action:any)=>(
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
