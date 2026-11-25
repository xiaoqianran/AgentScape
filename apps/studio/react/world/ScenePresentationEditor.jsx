import {useState,useSyncExternalStore} from 'react';
import {useStudioStore} from '../state/studioStore';
import './ScenePresentationEditor.css';

const empty={camera:null,lights:[],environment:null};
const lightNames={directional:'方向光',point:'点光源',spot:'聚光灯'};
const presets=[['inherit','继承世界'],['none','关闭 HDRI'],['interior','室内'],['courtyard','庭院'],['street','街道']];
const number=(value,fallback)=>Number.isFinite(value)?value:fallback;
function NumberField({label,value,onChange,min,max,step=.1}){
  return <label className="presentation-field">{label}<input aria-label={label} type="number" step={step} min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
function VectorField({label,value,onChange}){
  return <div className="presentation-vector"><span>{label}</span>{['X','Y','Z'].map((axis,i)=><input key={axis} aria-label={label+' '+axis} type="number" step=".1" value={value[i]} onChange={e=>onChange(value.map((n,j)=>i===j?Number(e.target.value):n))}/>)}</div>;
}
function LightEditor({light,index,update,remove}){
  return <div className="presentation-light">
    <div className="presentation-light-title"><strong>{index+1}. {lightNames[light.type]}</strong><button type="button" aria-label={'删除灯光 '+(index+1)} onClick={remove}>删除</button></div>
    <label className="presentation-field">名称<input aria-label={'灯光名称 '+(index+1)} value={light.name??''} maxLength={100} onChange={e=>update({name:e.target.value||undefined})}/></label>
    <label className="presentation-field">颜色<input aria-label={'灯光颜色 '+(index+1)} type="color" value={light.color??'#ffffff'} onChange={e=>update({color:e.target.value})}/></label>
    <NumberField label={'灯光强度 '+(index+1)} value={light.intensity} min={0} max={100000} onChange={intensity=>update({intensity})}/>
    <VectorField label={'灯光位置 '+(index+1)} value={light.position} onChange={position=>update({position})}/>
    {light.target?<VectorField label={'灯光目标 '+(index+1)} value={light.target} onChange={target=>update({target})}/>:null}
    {light.type!=='directional'?<NumberField label={'距离 '+(index+1)} value={light.distance??0} min={0} onChange={distance=>update({distance})}/>:null}
    {light.type==='spot'?<><NumberField label={'锥角（度） '+(index+1)} value={Math.round((light.angle??Math.PI/4)*180/Math.PI)} min={1} max={90} step={1} onChange={angle=>update({angle:angle*Math.PI/180})}/><NumberField label={'柔边 '+(index+1)} value={light.penumbra??0} min={0} max={1} onChange={penumbra=>update({penumbra})}/></>:null}
    <label className="presentation-field">投射阴影<input type="checkbox" checked={light.castShadow??false} onChange={e=>update({castShadow:e.target.checked})}/></label>
  </div>;
}
function Draft({controls,source,sourceKey,creativeView,editing,selection,lightingStatus}){
  const [draft,setDraft]=useState(()=>structuredClone(source||empty));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [error,setError]=useState(false);
  const [lightType,setLightType]=useState('directional');
  const camera=draft.camera;
  const changeCamera=patch=>setDraft(value=>({...value,camera:{...value.camera,...patch}}));
  const changeLight=(index,patch)=>setDraft(value=>({...value,lights:value.lights.map((light,i)=>i===index?{...light,...patch}:light)}));
  const addLight=()=>setDraft(value=>({...value,lights:[...value.lights,{type:lightType,position:[4,6,4],intensity:lightType==='directional'?2:40,color:'#ffffff',...(lightType==='point'?{}:{target:[0,0,0]}),castShadow:false}]}));
  const dirty=JSON.stringify(draft)!==JSON.stringify(source||empty);
  const run=async operation=>{
    if(busy)return;setBusy(true);setMessage('');setError(false);
    try{const result=await operation();if(typeof result==='string')setMessage(result);}
    catch(e){setError(true);setMessage(e.message||String(e));}
    finally{setBusy(false);}
  };
  return <div className="presentation-content">
    <section>
      <h4>视角</h4>
      <div className="presentation-buttons">
        <button type="button" aria-pressed={!creativeView} onClick={()=>controls.setCreativeView(false)}>自由视角</button>
        <button type="button" aria-pressed={creativeView} disabled={!source?.camera} onClick={()=>controls.setCreativeView(true)}>创作相机</button>
      </div>
      <small>创作视角不改变导航相机；预览随视口适配，静帧按保存的相机比例输出。</small>
    </section>
    <fieldset disabled={!editing||busy}>
      <section>
        <h4>相机</h4>
        <div className="presentation-buttons"><button type="button" onClick={()=>run(async()=>setDraft(value=>({...value,camera:controls.cameraFromView()})))}>从自由视角创建 / 更新</button>{camera?<button type="button" onClick={()=>setDraft(value=>({...value,camera:null}))}>删除相机</button>:null}</div>
        {camera?<><label className="presentation-field">相机名称<input aria-label="相机名称" value={camera.name??'Camera'} onChange={e=>changeCamera({name:e.target.value})}/></label>
          <VectorField label="相机位置" value={camera.position} onChange={position=>changeCamera({position})}/>
          <VectorField label="相机目标" value={camera.target} onChange={target=>changeCamera({target})}/>
          <NumberField label="视场角" value={number(camera.fov,45)} min={10} max={110} step={1} onChange={fov=>changeCamera({fov})}/>
          <label className="presentation-field">画幅比例<select aria-label="画幅比例" value={camera.aspect??16/9} onChange={e=>changeCamera({aspect:Number(e.target.value)})}>
            {Array.from(new Set([16/9,4/3,1,9/16,camera.aspect??16/9])).map((v,i)=><option key={v} value={v}>{['16:9','4:3','1:1','9:16'][i]??v.toFixed(2)}</option>)}
          </select></label>
          <NumberField label="近裁剪面" value={number(camera.near,.1)} min={.001} step={.01} onChange={near=>changeCamera({near})}/>
          <NumberField label="远裁剪面" value={number(camera.far,1000)} min={.01} step={1} onChange={far=>changeCamera({far})}/>
        </>:<small>尚未创建创作相机。</small>}
      </section>
      <section>
        <h4>创作灯光 · {draft.lights.length}/16</h4>
        <div className="presentation-buttons"><select aria-label="新增灯光类型" value={lightType} onChange={e=>setLightType(e.target.value)}>{Object.entries(lightNames).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select><button type="button" disabled={draft.lights.length>=16} onClick={addLight}>添加灯光</button></div>
        {draft.lights.map((light,index)=><LightEditor key={index} light={light} index={index} update={patch=>changeLight(index,patch)} remove={()=>setDraft(value=>({...value,lights:value.lights.filter((_,i)=>i!==index)}))}/>)}
        <small>灯光叠加于当前世界的基础照明。</small>
      </section>
      <section>
        <h4>HDRI 环境光</h4><small data-hdri-status={lightingStatus}>{({none:"未启用 HDRI",loading:"HDRI 加载中…",ready:"HDRI 已加载",failed:"HDRI 加载失败，使用基础光照"})[lightingStatus]}</small>
        <label className="presentation-field">环境预设<select aria-label="HDRI 环境预设" value={draft.environment?.preset??'inherit'} onChange={e=>{const preset=e.target.value;setDraft(value=>({...value,environment:preset==='inherit'?null:{preset,intensity:value.environment?.intensity??1,background:value.environment?.background??false}}));}}>{presets.map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>
        {draft.environment&&draft.environment.preset!=='none'?<><NumberField label="环境光强度" min={0} max={5} value={draft.environment.intensity??1} onChange={intensity=>setDraft(value=>({...value,environment:{...value.environment,intensity}}))}/><label className="presentation-field">显示 HDRI 背景<input type="checkbox" checked={draft.environment.background??false} onChange={e=>setDraft(value=>({...value,environment:{...value.environment,background:e.target.checked}}))}/></label></>:null}
      </section>
    </fieldset>
    {!editing?<small>进入编辑模式后可修改场景表现。</small>:null}
    <div className="presentation-buttons"><button type="button" disabled={!dirty||busy} onClick={()=>setDraft(structuredClone(source||empty))}>重置草稿</button><button type="button" disabled={!dirty||busy||!editing} onClick={()=>run(()=>controls.setPresentation(draft,sourceKey))}>应用场景表现</button></div>
    <section><h4>输出</h4><div className="presentation-buttons">
      <button type="button" disabled={busy} onClick={()=>run(()=>controls.captureStill(1920))}>PNG 1920</button>
      <button type="button" disabled={busy} onClick={()=>run(()=>controls.captureStill(3840))}>PNG 3840</button>
      <button type="button" disabled={busy} onClick={()=>run(()=>controls.exportGLB())}>导出场景 GLB</button>
      {selection?.source==='runtime'?<button type="button" disabled={busy} onClick={()=>run(()=>controls.exportGLB([selection.id]))}>导出选中 GLB</button>:null}
    </div><small>使用已应用设置。PNG 为原生光栅静帧；GLB 为静态托管对象、相机及灯光，不包含物理、HDRI 或环境建筑。</small></section>
    {busy?<p role="status">处理中…</p>:null}
    {message?<p role={error?'alert':'status'}>{message}</p>:null}
  </div>;
}
export function ScenePresentationEditor({controls,state}){
  const editing=useStudioStore(s=>s.editor.interactionMode==='edit');
  const selection=useStudioStore(s=>s.editor.selection);
  const [opened,setOpened]=useState(false);
  const source=state.presentation;
  const sourceKey=JSON.stringify(source??null);
  return <details className="toolbar-more presentation-menu" open={opened} onToggle={e=>setOpened(e.currentTarget.open)}>
    <summary>场景表现 <span aria-hidden="true">⌄</span></summary>
    {opened?<div className="toolbar-menu presentation-menu-panel"><Draft key={sourceKey} controls={controls} source={source} sourceKey={sourceKey} creativeView={state.creativeView} lightingStatus={state.lightingStatus} editing={editing} selection={selection}/></div>:null}
  </details>;
}

export function CreativeViewOverlay({controls}){
  const state=useSyncExternalStore(controls.subscribe,controls.snapshot,controls.snapshot);
  return state.creativeView?<div className="creative-view-shield" aria-label="创作相机预览"><button type="button" onClick={()=>controls.setCreativeView(false)}>退出创作相机</button></div>:null;
}
