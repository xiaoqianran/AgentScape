import { useEffect, useState } from 'react';
import type { EditorCommandsLike, InspectorAffordanceAction, InspectorAffordances } from './InspectorTypes';

const LABELS:Record<string,string>={
  pickup:'拿取',place:'放置',open:'打开',close:'关闭',push:'推动',drag:'拖动',
  rotate:'旋转刚体',slide:'滑动关节',rotateJoint:'旋转关节',
  turn_on:'开启',turn_off:'关闭',pull_out:'抽出',return:'放回',write:'修改文字'
};
const REASONS:Record<string,string>={
  ACTOR_NOT_FOUND:'未找到指定 Agent',ACTOR_NOT_AGENT:'选中角色不是 Agent',
  ACTOR_REQUIRED_FOR_REACH_CHECK:'尚未选择 Agent',OUT_OF_REACH:'当前距离过远',
  OCCLUDED:'目标被遮挡',NOT_HOLDING_OBJECT:'Agent 尚未持有物体',
  HANDS_FULL:'Agent 正在持有其他物体',TARGET_NOT_DYNAMIC:'物体不是动态刚体',
  EXECUTOR_UNAVAILABLE:'当前未实现此动作',ACTION_IN_PROGRESS:'已有动作正在执行',
  RUNTIME_VERIFICATION_REQUIRED:'资产尚未通过物理准入',
  TARGET_PHYSICS_UNAVAILABLE:'目标没有可用的物理碰撞体',
  SIMULATION_PAUSED:'模拟暂停'
};
const DIRECTION:Record<string,[number,number,number]>={
  'x+':[1,0,0],'x-':[-1,0,0],'z+':[0,0,1],'z-':[0,0,-1]
};
const key=(action:InspectorAffordanceAction)=>action.action+':'+(action.partName || '');
const numeric=(value:string,label:string)=>{
  const number=Number(value);
  if(!value.trim() || !Number.isFinite(number))throw new Error(label+'必须是有限数字');
  return number;
};

export function AffordanceActionPanel({targetId,actor,affordances,commands,log,disabled=false}:{
  targetId:string;
  actor:string|null;
  affordances:InspectorAffordances|null;
  commands:EditorCommandsLike;
  log:(message:string,kind?:string)=>void;
  disabled?:boolean;
}) {
  const [chosen,setChosen]=useState('');
  const [direction,setDirection]=useState('x+');
  const [distance,setDistance]=useState('0.3');
  const [angle,setAngle]=useState('0.3');
  const [jointTarget,setJointTarget]=useState('0.3');
  const [surfaceId,setSurfaceId]=useState('');
  const [text,setText]=useState('');
  const [running,setRunning]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [error,setError]=useState('');
  const actions=(affordances?.actions || []).filter(item=>item.execution==='interaction' || item.execution==='world-action');
  const selected=actions.find(item=>key(item)===chosen) || actions.find(item=>item.available===true) || actions[0];
  const selectedKey=selected ? key(selected) : '';

  useEffect(()=>{setChosen('');setFeedback('');setError('');},[targetId]);

  const select=(value:string)=>{
    setChosen(value);setFeedback('');setError('');
    const next=actions.find(item=>key(item)===value);
    const limits=next?.parameters?.target?.limits;
    if(Array.isArray(limits) && limits.length===2 && limits.every(Number.isFinite))setJointTarget(String((limits[0]+limits[1])/2));
    const surfaces=next?.parameters?.surfaceId?.enum;
    setSurfaceId(surfaces?.[0] || '');
  };

  const execute=async()=>{
    if(!selected || !actor || selected.available!==true || !commands.executeAffordance || running || disabled)return;
    setRunning(true);setFeedback('');setError('');
    try {
      const interaction:{actor:string;target:string;action:string;args?:Record<string,unknown>;partName?:string;surfaceId?:string}={
        actor,target:targetId,action:selected.action
      };
      if(selected.action==='push' || selected.action==='drag') {
        const value=numeric(distance,'距离');
        if(value<=0 || value>5)throw new Error('操作距离必须在 0–5 米之间');
        interaction.args={direction:DIRECTION[direction],distance:value};
      } else if(selected.action==='rotate') {
        const value=numeric(angle,'角度');
        if(value===0 || Math.abs(value)>Math.PI)throw new Error('旋转角度不能为零，且不得超过 π');
        interaction.args={axis:[0,1,0],angle:value};
      } else if(selected.action==='slide' || selected.action==='rotateJoint') {
        const value=numeric(jointTarget,'关节目标');
        const limits=selected.parameters.target?.limits;
        if(limits?.length===2 && (value<limits[0] || value>limits[1]))throw new Error('关节目标超出限位');
        interaction.args={part:selected.partName,target:value};
      } else if(selected.action==='write') {
        const maxLength=selected.parameters.text?.maxLength ?? 100;
        if(text.length>maxLength)throw new Error('文字超过允许长度');
        interaction.args={text};
      } else if(selected.action==='place') {
        const surfaces=selected.parameters.surfaceId?.enum || [];
        if(surfaceId || surfaces.length)interaction.surfaceId=surfaceId || surfaces[0];
      } else if(selected.partName) interaction.partName=selected.partName;
      const result=await commands.executeAffordance(interaction);
      const physical=result.value?.physicsVerified===true;
      const message=physical ? '物理状态已验证' : '状态已验证（非抓取力或物理力学证明）';
      setFeedback(message);
      log(`${LABELS[selected.action] || selected.action} ${targetId}：${message}`,'result');
    } catch(cause) {
      const message=cause instanceof Error ? cause.message : String(cause);
      setError(message);log('交互失败：'+message,'error');
    } finally {setRunning(false);}
  };

  return <div id="actions" className="affordance-panel" data-affordance-source={affordances?.source || 'unknown'}>
    {actions.length ? <>
      <p className="affordance-note">执行者：{actor || '未找到 Agent'} · 数据来自实时 Scene Affordance；编辑器拖动不等于物理交互。</p>
      <label htmlFor="affordance-choice">交互动作</label>
      <select id="affordance-choice" value={selectedKey} disabled={running || disabled} onChange={event=>select(event.target.value)}>
        {actions.map(item=><option key={key(item)} value={key(item)}>
          {LABELS[item.action] || item.action}{item.partName ? ' · '+item.partName : ''}{item.available===true ? '' : ' · 不可用'}
        </option>)}
      </select>
      {selected?.available!==true ? <p className="affordance-reason" role="note">
        {selected?.available===null ? '未检查可达性' : REASONS[selected?.reason || ''] || selected?.reason || '当前不可执行'}
      </p> : null}
      {(selected?.action==='push' || selected?.action==='drag') ? <div className="affordance-inputs">
        <label htmlFor="affordance-direction">方向</label>
        <select id="affordance-direction" value={direction} disabled={running || disabled} onChange={event=>setDirection(event.target.value)}>
          <option value="x+">X 正方向</option><option value="x-">X 负方向</option>
          <option value="z+">Z 正方向</option><option value="z-">Z 负方向</option>
        </select>
        <label htmlFor="affordance-distance">距离（米）</label>
        <input id="affordance-distance" type="number" min="0.01" max="5" step="0.05" value={distance} disabled={running || disabled} onChange={event=>setDistance(event.target.value)} />
      </div> : null}
      {selected?.action==='rotate' ? <div className="affordance-inputs">
        <label htmlFor="affordance-angle">绕垂直轴旋转（弧度）</label>
        <input id="affordance-angle" type="number" min={-Math.PI} max={Math.PI} step="0.05" value={angle} disabled={running || disabled} onChange={event=>setAngle(event.target.value)} />
      </div> : null}
      {(selected?.action==='slide' || selected?.action==='rotateJoint') ? <div className="affordance-inputs">
        <label htmlFor="affordance-joint">关节目标（{selected.action==='slide' ? '米' : '弧度'}）</label>
        <input id="affordance-joint" type="number" min={selected.parameters.target?.limits?.[0]} max={selected.parameters.target?.limits?.[1]}
          step="0.05" value={jointTarget} disabled={running || disabled} onChange={event=>setJointTarget(event.target.value)} />
      </div> : null}
      {selected?.action==='place' && selected.parameters.surfaceId?.enum?.length ? <div className="affordance-inputs">
        <label htmlFor="affordance-surface">支撑面</label>
        <select id="affordance-surface" value={surfaceId || selected.parameters.surfaceId.enum[0]} disabled={running || disabled} onChange={event=>setSurfaceId(event.target.value)}>
          {selected.parameters.surfaceId.enum.map(id=><option key={id} value={id}>{id}</option>)}
        </select>
      </div> : null}
      {selected?.action==='write' ? <div className="affordance-inputs">
        <label htmlFor="affordance-text">文字</label>
        <input id="affordance-text" value={text} maxLength={selected.parameters.text?.maxLength || 100} disabled={running || disabled} onChange={event=>setText(event.target.value)} />
      </div> : null}
      <button id="execute-affordance" type="button" disabled={running || disabled || !actor || selected?.available!==true || !commands.executeAffordance} onClick={()=>void execute()}>
        {running ? '执行与验证中…' : '执行 '+(LABELS[selected?.action || ''] || selected?.action)}
      </button>
    </> : <p className="muted-copy">当前对象没有已注册的具身交互或环境操作。可继续使用独立的编辑器变换功能。</p>}
    {error ? <p className="affordance-reason" role="alert">{error}</p> : null}
    {feedback ? <p className="affordance-feedback" role="status">{feedback}</p> : null}
  </div>;
}
