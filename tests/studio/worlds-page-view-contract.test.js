import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WorldsPage } from '../../apps/studio/react/worlds/WorldsPage.tsx';

describe('WorldsPage contract',()=>{
  it('projects built-in, generated and authoring worlds from existing product boundaries',()=>{
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
    expect(html).toContain('Runtime Worlds');
    expect(html).toContain('Generated Worlds');
    expect(html).toContain('Draft Worlds');
    expect(html).toContain('Monument Hall');
    expect(html).toContain('Generated Garden');
    expect(html).toContain('Garden Draft');
    expect(html).toContain('CURRENT');
    expect(html).toContain('UNSAVED');
  });
});
