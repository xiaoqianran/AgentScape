import fs from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorldsPage } from '../../apps/studio/react/worlds/WorldsPage.tsx';
import { worldPresentation } from '../../apps/studio/react/worlds/WorldPresentation.ts';
import { assetDisplayName, assetPreview, assetActions } from '../../apps/studio/react/shared/ResourcePresentation.ts';
import { StudioIcon } from '../../apps/studio/react/shared/StudioIcon.tsx';
import { PRODUCT_NAVIGATION } from '../../apps/studio/navigation/StudioNavigation.js';
import { ResourceLibraryView } from '../../apps/studio/react/resources/ResourceLibraryView.tsx';

const resources={snapshot:()=>({assets:[],images:[],worlds:[]}),onChange:()=>()=>{},localArtifact:()=>null};

describe('Studio presentation design contracts',()=>{
  it('keeps the original route identities with consistent Chinese navigation',()=>{
    expect(PRODUCT_NAVIGATION.map(item=>item.label)).toEqual(['世界','生成','资源库','智能体','实验室']);
    expect(PRODUCT_NAVIGATION.map(item=>item.page)).toEqual(['worlds','build','assets','agent','observatory']);
  });
  it('references real local previews only for known built-in worlds',()=>{
    for(const id of ['magic-cabin','woodland-workshop','monument-hall','ruined-courtyard','grand-urban-block']){
      const view=worldPresentation({id});
      expect(view.title).not.toBe(id);
      expect(fs.existsSync('public'+view.preview)).toBe(true);
      expect(fs.statSync('public'+view.preview).size).toBeGreaterThan(1000);
    }
    expect(worldPresentation({id:'user-world',title:'我的世界'})).toMatchObject({title:'我的世界',preview:null});
  });
  it('uses real asset previews without manufacturing a preview for generated assets',()=>{
    for(const id of ['agent','cup','chair','table','cabinet'])expect(fs.existsSync('public'+assetPreview(id))).toBe(true);
    expect(assetDisplayName('cup','Cup')).toBe('杯子');
    expect(assetActions(['pickup','place'])).toBe('拿取 · 放置');
    expect(assetPreview('custom-asset')).toBeNull();
    expect(assetDisplayName('custom-asset','自定义物体')).toBe('自定义物体');
  });
  it('disables creation when the authoring boundary is not available',()=>{
    const html=renderToStaticMarkup(createElement(WorldsPage,{
      environments:[],presentation:{id:'custom',title:'自定义世界'},openBuiltinWorld:vi.fn()
    }));
    expect(html).toMatch(/class="worlds-primary-action" disabled=""/);
    expect(html).not.toContain('/previews/worlds/custom');
    expect(html).toContain('0 个示例场景');
  });
  it('offers a real next action in the empty library without inventing resources',()=>{
    const html=renderToStaticMarkup(createElement(ResourceLibraryView,{
      resources,placement:{beginDrag:vi.fn(),cancelDrag:vi.fn(),placeAtCenter:vi.fn()},navigate:vi.fn()
    }));
    expect(html).toContain('这里还没有资源');
    expect(html).toContain('前往生成工作台');
    expect(html).not.toContain('data-asset-id=');
    expect(html).toContain('aria-pressed="true"');
  });
  it('keeps decorative icons out of the accessibility tree',()=>{
    const html=renderToStaticMarkup(createElement(StudioIcon,{name:'cube'}));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('focusable="false"');
  });
});
