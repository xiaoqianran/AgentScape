import { useCallback, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { parseStudioRoute, studioProductUrl } from '../../navigation/StudioRoutes.js';
import { useStudioStore, type ProductPage } from '../state/studioStore';

const currentHref = () => globalThis.location?.href || 'http://127.0.0.1/';

export function useStudioProductRouter(notifyLayout:()=>void) {
  const openPage = useStudioStore((state)=>state.openPage);
  const openAgentView = useStudioStore((state)=>state.openAgentView);

  const commitLayoutChange = useCallback((change:()=>void) => {
    flushSync(change);
    notifyLayout();
  },[notifyLayout]);

  const choosePage = useCallback((page:ProductPage) => {
    commitLayoutChange(()=>openPage(page));
    globalThis.history?.pushState?.(
      globalThis.history.state,
      '',
      studioProductUrl(currentHref(),{ page })
    );
  },[commitLayoutChange,openPage]);

  const chooseAgentView = useCallback((view:'tasks'|'runs') => {
    commitLayoutChange(()=>openAgentView(view));
    globalThis.history?.pushState?.(
      globalThis.history.state,
      '',
      studioProductUrl(currentHref(),{ page:'agent', agentView:view })
    );
  },[commitLayoutChange,openAgentView]);

  useEffect(()=>{
    const onPopState = () => {
      const route=parseStudioRoute(currentHref());
      commitLayoutChange(()=>{
        if (route.page === 'agent') openAgentView(route.agentView);
        else openPage(route.page as ProductPage);
      });
    };
    globalThis.window?.addEventListener?.('popstate',onPopState);
    return ()=>globalThis.window?.removeEventListener?.('popstate',onPopState);
  },[commitLayoutChange,openAgentView,openPage]);

  return { commitLayoutChange, choosePage, chooseAgentView };
}
