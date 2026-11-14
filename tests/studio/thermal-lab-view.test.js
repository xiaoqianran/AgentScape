import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {HistoryPlot,ThermalExperimentLab} from '../../apps/studio/react/resources/ThermalExperimentLab';

it('draws real temperature/energy samples as independent lines with physical units',()=>{
  const markup=renderToStaticMarkup(createElement(HistoryPlot,{
    title:'温度变化',unit:'K',channels:[
      {key:'a:root',label:'machine_a / root',points:[
        {timeSec:0,value:350},{timeSec:1,value:340}
      ]},
      {key:'a:door',label:'machine_a / door',points:[
        {timeSec:0,value:300},{timeSec:1,value:310}
      ]}
    ]
  }));
  expect(markup).toContain('温度变化');
  expect(markup).toContain('machine_a / door');
  expect(markup).toContain('role="img"');
  expect(markup.match(/<polyline /g)).toHaveLength(2);
  expect(markup).toContain('1 s');
  expect(markup).toContain('K');
});

it('exposes an experimental workbench with explicit simulation-model limitations',()=>{
  const markup=renderToStaticMarkup(createElement(ThermalExperimentLab,{
    experiment:async()=>({value:[]})
  }));
  expect(markup).toContain('Asset Forge 热学实验台');
  expect(markup).toContain('当前世界还没有热学资产');
});
