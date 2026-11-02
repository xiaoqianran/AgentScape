import { worldPresentation } from '../worlds/WorldPresentation';
import { useState } from 'react';
import { StudioIcon, type StudioIconName } from '../shared/StudioIcon';
import { PRODUCT_NAVIGATION } from '../../navigation/StudioNavigation.js';
import { isProductNavigationActive } from '../../navigation/StudioRoutes.js';
import type { ProductPage } from '../state/studioStore';

type EnvironmentDefinition = { id:string; title:string; number?:string };

export function ProductHeader({
  activePage,
  sceneCollapsed,
  setSceneCollapsed,
  choosePage,
  presentation,
  environments,
  generated,
  worldSelectValue,
  openWorld,
  runtimeStatus,
  cinematic,
  setCinematic,
  openDeveloper
}: {
  activePage:ProductPage;
  sceneCollapsed:boolean;
  setSceneCollapsed:(value:boolean)=>void;
  choosePage:(page:ProductPage)=>void;
  presentation:any;
  environments:EnvironmentDefinition[];
  generated:boolean;
  worldSelectValue:string;
  openWorld:(id:string)=>Promise<unknown>;
  runtimeStatus:any;
  cinematic:boolean;
  setCinematic:(value:boolean)=>void;
  openDeveloper:()=>void;
}) {
  const [opening,setOpening] = useState(false);
  const [openError,setOpenError] = useState('');
  const switchWorld = async (id:string) => {
    if (opening || id.startsWith('runtime:')) return;
    setOpening(true);setOpenError('');
    try { await openWorld(id); }
    catch (error) { setOpenError(error instanceof Error ? error.message : '切换世界失败'); }
    finally { setOpening(false); }
  };
  const icons:Record<string,StudioIconName>={worlds:'worlds',build:'create',assets:'cube',agent:'agent'};
  return (
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
            onClick={()=>setSceneCollapsed(!sceneCollapsed)}
          ><StudioIcon name="panel" size={18} /></button>
        ) : null}
        <button className="brand-home" type="button" aria-label="AgentScape 世界工作台" onClick={()=>choosePage('worlds')}><span className="brand-symbol"><StudioIcon name="cube" size={21} /></span><strong>AgentScape <em>Studio</em></strong></button>
      </div>

      <nav className="product-navigation" aria-label="AgentScape product">
        {PRODUCT_NAVIGATION.map((item:any)=>(
          item.href ? (
            <a key={item.page} href={item.href} className="product-nav-lab">{item.label}<span aria-hidden="true">↗</span></a>
          ) : (
            <button
              key={item.page}
              type="button"
              data-product-nav={item.page}
              aria-pressed={isProductNavigationActive(activePage,item.page)}
              onClick={()=>choosePage(item.page as ProductPage)}
            ><StudioIcon name={icons[item.page]} size={17} /><span>{item.label}</span></button>
          )
        ))}
      </nav>

      <div className="brand-actions">
        {activePage !== 'worlds' ? (
          <label className="world-control">
            <span>当前世界</span>
            <select
              id="world-select"
              className="world-select"
              aria-label="当前世界"
              value={worldSelectValue}
              disabled={opening}
              onChange={(event)=>void switchWorld(event.target.value)}
            >
              {environments.map((item)=><option key={item.id} value={item.id}>{worldPresentation(item).title}</option>)}
              {generated ? <option value={worldSelectValue}>已生成 · {presentation.title}</option> : null}
            </select>
          </label>
        ) : null}
        <button
          id="runtime-status"
          className={'runtime-status' + (runtimeStatus.recoveryAction ? ' is-actionable' : '')}
          data-state={runtimeStatus.state}
          type="button"
          disabled={!runtimeStatus.recoveryAction}
          aria-live="polite"
          onClick={()=>runtimeStatus.recoveryAction?.()}
        ><i /><span>{runtimeStatus.label}</span></button>
        {activePage === 'world' ? (
          <button id="cinematic-toggle" className="header-button" type="button" aria-pressed={cinematic} onClick={()=>setCinematic(!cinematic)}>
            {cinematic ? '返回编辑' : '沉浸模式'}
          </button>
        ) : null}
        <a className="header-lab-link" href="/observatory/" aria-label="打开实验室" title="打开实验室"><StudioIcon name="worlds" size={17} /></a>
        <button id="open-developer" className="icon-button" type="button" aria-label="打开开发者设置" title="连接与开发者设置" onClick={openDeveloper}><StudioIcon name="settings" /></button>
      </div>
      {openError ? <div className="header-error" role="alert">{openError}<button type="button" aria-label="关闭错误提示" onClick={()=>setOpenError('')}><StudioIcon name="close" size={16} /></button></div> : null}
    </header>
  );
}
