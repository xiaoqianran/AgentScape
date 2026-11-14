import {useEffect,useMemo,useState} from 'react';
import './ThermalExperimentLab.css';

export type ThermalExperimentInput={
  operation:'list'|'inspect'|'series'|'setPower'|'run';
  targetId?:string;nodeId?:string;limit?:number;powerW?:number;durationSec?:number;
};
type Summary={id:string;model:string;nodeCount:number;temperatureK:number};
type Sample={timeSec:number;nodes:Record<string,{temperatureK:number;internalEnergyJ:number;heatPowerW:number}>};
type Series={targetId:string;model:string;nodes:{id:string;partName:string;material:{name:string}}[];samples:Sample[]};
type Experiment=(input:ThermalExperimentInput)=>Promise<{value:any}>;
type Channel={key:string;label:string;points:{timeSec:number;value:number}[]};
const palette=['#18a999','#e76f51','#6697d6','#be86df','#e1b44c','#bb7b69','#648c76','#d86a99'];

export function HistoryPlot({title,unit,channels}:{title:string;unit:string;channels:Channel[]}){
  const data=channels.flatMap(c=>c.points);
  if(!data.length)return <div className="thermal-chart-empty">{title}：还没有采样结果</div>;
  const minX=Math.min(...data.map(p=>p.timeSec)),maxX=Math.max(...data.map(p=>p.timeSec));
  const minY=Math.min(...data.map(p=>p.value)),maxY=Math.max(...data.map(p=>p.value));
  const spanY=Math.max(maxY-minY,Math.abs(maxY)*.02,1e-6);
  const y0=minY-spanY*.1,y1=maxY+spanY*.1;
  const x=(value:number)=>53+((value-minX)/Math.max(maxX-minX,1e-9))*622;
  const y=(value:number)=>210-(value-y0)/(y1-y0)*181;
  const format=(n:number)=>Math.abs(n)>1e5?n.toExponential(2):Number(n.toFixed(2)).toLocaleString();
  return <section className="thermal-chart-card" aria-label={title}>
    <div className="thermal-chart-heading"><h3>{title}</h3><span>{unit}</span></div>
    <svg viewBox="0 0 710 244" role="img" aria-label={title+' 随仿真时间变化'}>
      {[0,.5,1].map((t,i)=>{
        const val=y0+(y1-y0)*t;
        return <g key={i}>
          <line x1="53" y1={y(val)} x2="675" y2={y(val)} stroke="var(--studio-border)" strokeWidth="1"/>
          <text x="47" y={y(val)+4} fontSize="10" fill="var(--studio-text-3)" textAnchor="end">{format(val)}</text>
        </g>;
      })}
      <line x1="53" y1="210" x2="675" y2="210" stroke="var(--studio-text-3)"/>
      <text x="53" y="229" fill="var(--studio-text-3)" fontSize="10">{format(minX)} s</text>
      <text x="675" y="229" textAnchor="end" fill="var(--studio-text-3)" fontSize="10">{format(maxX)} s</text>
      {channels.map((line,i)=><polyline key={line.key} fill="none" stroke={palette[i%palette.length]} strokeWidth="2.4"
        strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"
        points={line.points.map(p=>x(p.timeSec).toFixed(2)+','+y(p.value).toFixed(2)).join(' ')}/>)}
    </svg>
    <div className="thermal-chart-legend">
      {channels.map((channel,i)=><span key={channel.key}><i style={{backgroundColor:palette[i%palette.length]}}/>
        {channel.label}</span>)}
    </div>
  </section>;
}

export function ThermalExperimentLab({experiment}: {experiment:Experiment}){
  const [entities,setEntities]=useState<Summary[]>([]);
  const [selected,setSelected]=useState<string[]>([]);
  const [focus,setFocus]=useState('');
  const [history,setHistory]=useState<Series[]>([]);
  const [nodeId,setNodeId]=useState('root');
  const [nodeFilter,setNodeFilter]=useState('all');
  const [power,setPower]=useState('100');
  const [duration,setDuration]=useState('2');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');

  useEffect(()=>{
    let active=true;
    const read=async()=>{
      try{
        const listed=await experiment({operation:'list'});
        if(!active)return;
        const next=(listed.value||[]) as Summary[];
        setEntities(next);
        setSelected(old=>{
          const existing=old.filter(id=>next.some(item=>item.id===id)).slice(0,4);
          const desired=existing.length?existing:next.length?[next[0].id]:[];
          if(desired.length===old.length&&desired.every((id,i)=>id===old[i]))return old;
          return desired;
        });
      }catch(e){if(active)setError(e instanceof Error?e.message:String(e));}
    };
    void read();
    const timer=setInterval(()=>void read(),1500);
    return ()=>{active=false;clearInterval(timer);};
  },[experiment]);

  useEffect(()=>{
    let active=true;
    const read=async()=>{
      try{
        const values=await Promise.all(selected.map(targetId=>
          experiment({operation:'series',targetId,limit:240}).then(r=>r.value as Series)));
        if(active)setHistory(values);
      }catch(e){if(active)setError(e instanceof Error?e.message:String(e));}
    };
    void read();
    const timer=setInterval(()=>void read(),1500);
    return ()=>{active=false;clearInterval(timer);};
  },[experiment,selected]);

  useEffect(()=>{
    if(!focus||!selected.includes(focus))setFocus(selected[0]||'');
  },[selected,focus]);

  const focusSeries=history.find(item=>item.targetId===focus);
  const availableNodes=focusSeries?.nodes||[];
  const selectedNode=availableNodes.some(n=>n.id===nodeId)?nodeId:(availableNodes[0]?.id||'root');
  const allChannels=useMemo(()=>history.flatMap(item=>item.nodes.map(node=>({
    key:item.targetId+':'+node.id,
    label:item.targetId+' / '+node.id+' ('+node.material.name+')',
    points:item.samples.filter(sample=>sample.nodes[node.id]).map(sample=>({
      timeSec:sample.timeSec,temperatureK:sample.nodes[node.id].temperatureK,
      internalEnergyJ:sample.nodes[node.id].internalEnergyJ
    }))
  }))),[history]);
  const availableChannels=allChannels.filter(channel=>nodeFilter==='all'||channel.key.endsWith(':'+nodeFilter));
  const channels=availableChannels.slice(0,16);
  const nodeOptions=[...new Set(history.flatMap(item=>item.nodes.map(node=>node.id)))];
  const drive=async(input:ThermalExperimentInput)=>{
    if(busy)return;
    setBusy(true);setError('');
    try {
      await experiment(input);
      const values=await Promise.all(selected.map(targetId=>
        experiment({operation:'series',targetId,limit:240}).then(r=>r.value as Series)));
      setHistory(values);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  };
  const durationSec=Number(duration),powerW=Number(power);

  return <section className="thermal-lab" aria-label="Asset Forge 热学实验台">
    <header>
      <h2>热学实验台</h2>
      <p>记录真实 WorldRuntime 的计算结果。可比较最多 4 个物体实例，各实例的不同部件具有独立温度。横轴是各实例开始采样以来的仿真时间。</p>
    </header>
    {error?<div className="thermal-lab-error" role="alert">{error}</div>:null}
    {!entities.length?<div className="thermal-chart-empty">当前世界还没有热学资产。先在「创建机械资产」启用科学材料组件，编译后放入世界。</div>:<>
      <div className="thermal-lab-targets" aria-label="比较资产实例">
        {entities.map(item=><label key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)}
            onChange={event=>setSelected(old=>event.target.checked
              ? old.includes(item.id)||old.length>=4?old:[...old,item.id]
              :old.filter(id=>id!==item.id))}/>
          {item.id}<small>{item.nodeCount} 个热节点</small>
        </label>)}
      </div>
      <div className="thermal-lab-controls">
        <label>实验对象<select value={focus} onChange={e=>setFocus(e.target.value)}>
          {selected.map(id=><option key={id} value={id}>{id}</option>)}
        </select></label>
        <label>加热部件<select value={selectedNode} onChange={e=>setNodeId(e.target.value)}>
          {availableNodes.map(node=><option key={node.id} value={node.id}>{node.id} / {node.partName}</option>)}
        </select></label>
        <label>热功率 (W)<input type="number" aria-label="实验热功率" value={power} onChange={e=>setPower(e.target.value)}/></label>
        <button type="button" disabled={!focus||busy||!Number.isFinite(powerW)||Math.abs(powerW)>1e9}
          onClick={()=>void drive({operation:'setPower',targetId:focus,nodeId:selectedNode,powerW})}>
          设置功率
        </button>
        <label>推进时间 (s)<input type="number" aria-label="实验推进时间" min=".016667" max="10" step=".5"
          value={duration} onChange={e=>setDuration(e.target.value)}/></label>
        <button type="button" disabled={busy||!Number.isFinite(durationSec)||durationSec<=0||durationSec>10}
          onClick={()=>void drive({operation:'run',durationSec})}>{busy?'正在计算…':'推进世界实验'}</button>
      </div>
      <div className="thermal-lab-filters">
        <label>曲线部件筛选 <select aria-label="曲线部件筛选" value={nodeFilter}
          onChange={e=>setNodeFilter(e.target.value)}>
          <option value="all">全部热节点</option>
          {nodeOptions.map(id=><option key={id} value={id}>{id}</option>)}
        </select></label>
        <span>{channels.length} 条曲线{availableChannels.length>channels.length
          ?'（仅展示前 16 条，可按部件筛选）':''}</span>
      </div>
      {selected.length?<div className="thermal-lab-charts">
        <HistoryPlot title="温度变化" unit="K" channels={channels.map(c=>({
          key:c.key,label:c.label,points:c.points.map(p=>({timeSec:p.timeSec,value:p.temperatureK}))
        }))}/>
        <HistoryPlot title="显热能量变化" unit="J" channels={channels.map(c=>({
          key:c.key,label:c.label,points:c.points.map(p=>({timeSec:p.timeSec,value:p.internalEnergyJ}))
        }))}/>
      </div>:<p>选择至少一个实例以查看曲线。</p>}
      <p className="thermal-lab-disclaimer">仅集中参数热学仿真；曲线不是实验测量。内部导热按声明的 W/K 连接计算，跨物体导热只在 Rapier 实际接触时发生。曲线为运行内有界缓存；重开场景会从恢复状态重新采样。</p>
    </>}
  </section>;
}
