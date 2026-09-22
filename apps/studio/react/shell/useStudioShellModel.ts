import { useEffect, useMemo } from 'react';
import { useStudioStore } from '../state/studioStore';

export function useStudioShellModel({
  environmentDefinition,
  commitLayoutChange
}: {
  environmentDefinition:any;
  commitLayoutChange:(change:()=>void)=>void;
}) {
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

  const presentation = useMemo(()=>({
    ...environmentDefinition,
    ...(worldPresentation || {})
  }),[environmentDefinition,worldPresentation]);

  const worldId = presentation.id || environmentDefinition.id;
  const generated = Boolean(presentation.generated);
  const worldSelectValue = generated ? 'runtime:' + (presentation.persistenceSource || worldId) : worldId;

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

  return {
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
  };
}
