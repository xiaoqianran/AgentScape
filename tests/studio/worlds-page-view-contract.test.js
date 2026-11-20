import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DraftWorldRow, WorldsPage } from '../../apps/studio/react/worlds/WorldsPage.tsx';

describe('WorldsPage contract',()=>{
  it('shows real collection counts and previews without rendering three competing collections at once',()=>{
    const authoringSnapshot=Object.freeze({
      worlds:[{id:'draft_01',name:'Garden Draft'}],
      status:{id:'draft_01',name:'Garden Draft',dirty:true}
    });
    const html=renderToStaticMarkup(createElement(WorldsPage,{
      environments:[
        {id:'monument-hall',number:'WORLD 01',title:'Monument Hall',description:'Runtime hall',facts:['RAPIER']},
        {id:'ruined-courtyard',number:'WORLD 02',title:'Ruined Courtyard',description:'Runtime courtyard',facts:['RECAST']}
      ],
      presentation:{id:'monument-hall',generated:false},
      resources:{
        snapshot:()=>({worlds:[
          {id:'monument-hall',label:'Monument Hall',source:'builtin',current:true},
          {id:'manifest_01',label:'Generated Garden',source:'generated',integrity:'verified',provider:'modal'}
        ]}),
        onChange:()=>()=>{}
      },
      authoring:{
        subscribe:()=>()=>{},
        snapshot:()=>authoringSnapshot,
        open:vi.fn(async()=>({status:'opened'})),
        createNew:vi.fn(async()=>({status:'created'}))
      },
      openBuiltinWorld:vi.fn(async()=>({status:'opened'})),
      openGeneratedWorld:vi.fn(async()=>({status:'opened'}))
    }));

    expect(html).toContain('data-product-page="worlds"');
    expect(html).toContain('示例场景<span>2</span>');
    expect(html).toContain('我的草稿<span>1</span>');
    expect(html).toContain('已生成<span>1</span>');
    expect(html).toContain('aria-label="搜索世界"');
    expect(html).toContain('/previews/worlds/monument-hall.webp');
    expect(html).toContain('纪念大厅的场景预览');
    expect(html).toContain('当前世界');
    expect(html).not.toContain('Generated Garden');
    expect(html).not.toContain('Garden Draft');
    expect(html).not.toContain('UNSAVED');
  });

  it('keeps draft management and current-state actions visible in the list',()=>{
    const html=renderToStaticMarkup(createElement(DraftWorldRow,{
      world:{id:'draft_01',name:'Garden Draft',updatedAt:'2026-09-18T00:00:00.000Z'},
      currentId:'draft_01',
      dirty:true,
      busyKey:null,
      canManage:true,
      onOpen:vi.fn(),
      onRename:vi.fn(async()=>true),
      onRemove:vi.fn()
    }));

    expect(html).toContain('data-world-id="draft_01"');
    expect(html).toContain('当前草稿');
    expect(html).toContain('有未保存修改');
    expect(html).toContain('最近保存');
    expect(html).toContain('重命名Garden Draft');
    expect(html).toContain('删除Garden Draft');
    expect(html).toContain('class="world-list-danger" type="button" disabled=""');
  });
});
