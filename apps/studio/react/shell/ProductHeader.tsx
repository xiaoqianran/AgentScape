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
              onChange={(event)=>{ if (!event.target.value.startsWith('runtime:')) void openWorld(event.target.value); }}
            >
              {environments.map((item)=><option key={item.id} value={item.id}>{item.number} · {item.title}</option>)}
              {generated ? <option value={worldSelectValue}>GENERATED · {presentation.title}</option> : null}
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
        <button id="open-developer" className="icon-button" type="button" aria-label="打开开发者设置" title="开发者设置" onClick={openDeveloper}>⋯</button>
      </div>
    </header>
  );
}
