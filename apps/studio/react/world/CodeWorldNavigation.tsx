import {useEffect,useState} from 'react';
import {useActionOperation} from '../inspect/useActionOperation';
import {guardAsync} from '../shared/guardAsync';

type Point=[number,number,number];
type Route={reachable:boolean;reason?:string|null;path:Point[];cost:number|null;buildVersion?:number};
const fmt=(value:number)=>Number(value.toFixed(2));
function RoutePreview({route}:{route:Route}){
  if(!route.reachable)return <p className="affordance-reason" role="status">不可通行 · {route.reason||'NO_PATH'}</p>;
  const path=route.path;
  if(!path.length)return <p role="status">未返回有效路径</p>;
  const minX=Math.min(...path.map(p=>p[0])),maxX=Math.max(...path.map(p=>p[0]));
  const minZ=Math.min(...path.map(p=>p[2])),maxZ=Math.max(...path.map(p=>p[2]));
  const factor=Math.min(236/Math.max(maxX-minX,.1),100/Math.max(maxZ-minZ,.1));
  const toPoint=(p:Point)=>[132+(p[0]-(minX+maxX)/2)*factor,64+(p[2]-(minZ+maxZ)/2)*factor];
  const start=toPoint(path[0]),end=toPoint(path.at(-1)!);
  return <div className="code-world-route-preview" role="status">
    <strong>路线可达 · {route.cost===null?'—':fmt(route.cost)} 米</strong>
    <svg viewBox="0 0 264 128" role="img" aria-label="导航路线俯视预览">
      <path d="M12 32 H252 M12 64 H252 M12 96 H252 M66 12 V116 M132 12 V116 M198 12 V116" stroke="currentColor" opacity=".1" fill="none"/>
      <polyline points={path.map(p=>toPoint(p).join(',')).join(' ')} stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" fill="none"/>
      <circle cx={start[0]} cy={start[1]} r="4" fill="#7297ae"/><circle cx={end[0]} cy={end[1]} r="5" fill="#87ad85"/>
    </svg>
    <small>{path.length} 个路径点 · 高度 {fmt(path[0][1])} → {fmt(path.at(-1)![1])} m</small>
    <small>查询时刻的俯视路径，不是实时碰撞保证。执行时重新寻路。</small>
  </div>;
}
export function CodeWorldNavigation({session,actor,commands,disabled,refresh}:{session:any;actor:string|null;commands:any;disabled:boolean;refresh:()=>void}){
  const [destination,setDestination]=useState(['0','0','0']);
  const [route,setRoute]=useState<Route|null>(null);
  const [previewing,setPreviewing]=useState(false);
  const [error,setError]=useState('');
  const {running,feedback,error:operationError}=useActionOperation(commands,actor,actor||'');
  useEffect(()=>{setRoute(null);setError('');},[session,actor]);
  const point=():Point=>{
    const values=destination.map(Number);
    if(destination.some(v=>!v.trim())||!values.every(Number.isFinite))throw new Error('请输入有效的目标坐标');
    return values as Point;
  };
  const preview=async()=>{
    if(!actor||previewing||running||disabled)return;
    setError('');setRoute(null);setPreviewing(true);
    try{setRoute(await session.scene.previewNavigation({actor,position:point()}));}
    catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setPreviewing(false);}
  };
  const navigate=()=>{
    try{
      if(!actor||running||disabled)return;
      const position=point();setError('');setRoute(null);
      guardAsync('导航',()=>commands.executeNavigation({actor,position}).finally(refresh));
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  };
  const locked=disabled||running||previewing||!actor;
  return <section className="code-world-navigation" aria-label="Agent 导航">
    <h4>Agent 导航</h4>
    <div className="code-world-nav-vector">
      {['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<input aria-label={'导航目标 '+axis} type="number" step=".1" value={destination[i]} disabled={locked}
        onChange={event=>{setDestination(old=>old.map((v,n)=>n===i?event.target.value:v));setRoute(null);setError('');}}/></label>)}
    </div>
    <div className="code-project-action-buttons">
      <button type="button" disabled={locked} onClick={()=>void preview()}>{previewing?'查询中…':'预览路线'}</button>
      <button type="button" disabled={locked} onClick={navigate}>{running?'导航中…':'开始导航'}</button>
      {running?<button type="button" onClick={()=>{try{commands.cancelAffordance(actor);}catch(cause){setError(String(cause));}}}>取消导航</button>:null}
    </div>
    {route?<RoutePreview route={route}/>:null}
    {feedback?<p className="affordance-feedback" role="status">{feedback}</p>:null}
    {error||operationError?<p className="affordance-reason" role="alert">{error||operationError}</p>:null}
  </section>;
}
