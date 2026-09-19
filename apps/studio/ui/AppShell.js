import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { StudioApp } from '../react/StudioApp.tsx';
import { useStudioStore } from '../react/state/studioStore.ts';
import { createStudioUiBridge } from './StudioUiBridge.js';
import './content/StudioContent.css';
import './chrome/studio-shell.css';
import './chrome/studio-spatial.css';

export function createAppShell({ app, environmentDefinition, environments }) {
  if (!app) throw new TypeError('createAppShell requires #app');
  const bridge = createStudioUiBridge();
  const reactRoot = createRoot(app);

  useStudioStore.setState({
    worldPresentation:{
      id:environmentDefinition.id,
      title:environmentDefinition.title,
      number:environmentDefinition.number,
      headline:environmentDefinition.headline,
      description:environmentDefinition.description,
      facts:environmentDefinition.facts || [],
      worldFirst:Boolean(environmentDefinition.worldFirst)
    },
    activeWorkspace:'world',
    activeContextView:'create',
    contextOpen:false
  });

  flushSync(()=>{
    reactRoot.render(createElement(StudioApp,{ bridge, environmentDefinition, environments }));
  });

  const shell = app.querySelector('.shell');
  const panel = app.querySelector('.panel');
  const viewport = app.querySelector('#viewport');
  if (!shell || !panel || !viewport) throw new Error('StudioApp failed to materialize required shell hosts');

  const setView = (view) => useStudioStore.getState().openView(view);
  const closeContext = () => useStudioStore.getState().closeContext();

  return {
    shell,
    panel,
    viewport,
    developerDialog:app.querySelector('#developer-dialog'),
    setView,
    closeContext,
    addDockAction:(action)=>bridge.addDockAction(action),
    setWorldPresentation:(identity)=>useStudioStore.getState().setWorldPresentation(identity),
    setWorldChangeHandler:(handler)=>bridge.setWorldChangeHandler(handler),
    setRuntimeStatus:(state,label)=>bridge.setRuntimeStatus(state,label),
    setRuntimeRecoveryAction:(handler,label)=>bridge.setRuntimeRecoveryAction(handler,label),
    setLayoutChangeHandler:(handler)=>bridge.setLayoutChangeHandler(handler),
    attachAgent:(agent)=>bridge.attachAgent(agent),
    attachContent:(content)=>bridge.attachContent(content),
    attachSceneControls:(controls)=>bridge.attachSceneControls(controls),
    attachAuthoring:(authoring)=>bridge.attachAuthoring(authoring),
    setDeveloperOpenHandler:(handler)=>bridge.setDeveloperOpenHandler(handler),
    prefillAgentCommand:(value)=>bridge.prefillAgentCommand(value),
    destroyChrome() {
      reactRoot.unmount();
      bridge.dispose();
    }
  };
}
