import { useEffect, useMemo, useRef, useState } from 'react';
import { industrialCabinetDraft, mechanicalDraftSchema } from '../../../../modules/asset/model/MechanicalAssetDraft.js';
import { MechanicalPreview } from './MechanicalPreview';
import { ThermalMaterialEditor } from './ThermalMaterialEditor';
import { simulationProfileSchema } from '../../../../foundation/simulation/SimulationProfile.js';
import type { z } from 'zod/v4';
import './MechanicalAssetWorkbench.css';

type MechanicalNode = {
  id:string;
  parent:string|null;
  shape:'group'|'box'|'sphere'|'cylinder';
  position:[number,number,number];
  size:[number,number,number];
  color:string;
  collision:boolean;
};
type Joint = {
  id:string;
  node:string;
  type:'revolute'|'prismatic';
  axis:[number,number,number];
  limits:[number,number];
  open:number;
  mass:number;
  friction:number;
  stiffness:number;
  damping:number;
};
type SimulationProfile = z.infer<typeof simulationProfileSchema>;
type Draft = {
  schema:'agentscape.mechanical-draft';
  schemaVersion:1;
  name:string;
  type:string;
  components:MechanicalNode[];
  motions:Joint[];
  body?:'fixed'|'dynamic';
  simulation?:SimulationProfile;
};
type Result={assetId:string;admission:{status:string;reasons?:string[]}};
type Props={
  creator:{
    build:(draft:Draft)=>Promise<Result>;
    place:(assetId:string)=>Promise<{status:string;id?:string|null;reason?:string}>;
  };
  navigate?:(page:'world'|'build')=>void;
};
export type MechanicalCreator = Props['creator'];
const STORAGE='agentscape.mechanical-workbench-draft.v1';
const copy=<T,>(value:T):T=>structuredClone(value);
function load():Draft {
  try {
    const saved=localStorage.getItem(STORAGE);
    if(saved){
      const parsed=mechanicalDraftSchema.safeParse(JSON.parse(saved));
      if(parsed.success)return parsed.data as Draft;
    }
  }catch { /* Preview remains usable when browser storage is blocked. */ }
  return industrialCabinetDraft() as Draft;
}
const unique=(prefix:string,items:MechanicalNode[])=>{
  let index=1;
  const ids=new Set(items.map(item=>item.id));
  while(ids.has(prefix+index))index++;
  return prefix+index;
};
const vec=(value:[number,number,number],index:number,number:number):[number,number,number]=>value.map((v,i)=>i===index?number:v) as [number,number,number];
const numeric=(value:string)=>value.trim()===''?0:Number(value);
const variants={group:'关节轴心',box:'长方体',sphere:'球体',cylinder:'圆柱体'};
const motionLabels={revolute:'旋转铰链',prismatic:'直线滑轨'};

function VectorEditor({label,value,onChange,step=.05}:{label:string;value:[number,number,number];onChange:(vector:[number,number,number])=>void;step?:number}) {
  return <div className="mechanical-vector">
    <span>{label}</span>
    <div>{(['X','Y','Z'] as const).map((axis,i)=><label key={axis}>{axis}<input aria-label={label+' '+axis} type="number" step={step} value={Number.isFinite(value[i])?value[i]:''} onChange={event=>onChange(vec(value,i,numeric(event.target.value)))} /></label>)}</div>
  </div>;
}

function syncThermalNodes(draft:Draft) {
  if(draft.simulation?.schemaVersion!==2)return;
  const profile=draft.simulation;
  const root=profile.nodes.find(node=>node.id==='root');
  if(!root)return;
  const allowed=new Set(['$root',...draft.motions.map(motion=>motion.id)]);
  profile.nodes=profile.nodes.filter(node=>allowed.has(node.partName));
  for(const motion of draft.motions)if(!profile.nodes.some(node=>node.partName===motion.id)){
    profile.nodes.push({id:motion.id,partName:motion.id,material:copy(root.material),
      thermal:{...copy(root.thermal),mass:{mode:'explicit',massKg:motion.mass}}});
  }
  const ids=new Set(profile.nodes.map(node=>node.id));
  profile.links=profile.links.filter(link=>ids.has(link.from)&&ids.has(link.to));
  for(const motion of draft.motions)if(!profile.links.some(link=>
    (link.from==='root'&&link.to===motion.id)||(link.to==='root'&&link.from===motion.id)))
    profile.links.push({from:'root',to:motion.id,conductanceWPerK:5});
}

export function MechanicalAssetWorkbench({creator,navigate}:Props) {
  const [draft,setDraft]=useState<Draft>(load);
  const [selected,setSelected]=useState<string|null>(draft.components[0]?.id || null);
  const [busy,setBusy]=useState(false);
  const [confirmed,setConfirmed]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  const [notice,setNotice]=useState<{error:boolean;text:string}|null>(null);
  const [json,setJson]=useState('');
  const [thermalNodeId,setThermalNodeId]=useState('root');
  const jsonInput=useRef<HTMLInputElement>(null);

  const validation=useMemo(()=>mechanicalDraftSchema.safeParse(draft),[draft]);
  const error=validation.success?'':validation.error.issues.slice(0,3).map(issue=>issue.message).join('；');
  const component=draft.components.find(item=>item.id===selected) || null;
  const motion=draft.motions.find(item=>item.node===selected) || null;
  const groups=draft.components.filter(item=>item.shape==='group');

  useEffect(()=>{
    if(!validation.success)return;
    try{localStorage.setItem(STORAGE,JSON.stringify(draft));}
    catch{ /* Storage can be disabled. */ }
  },[draft,validation.success]);

  const edit=(updater:(next:Draft)=>void)=>{

    if(busy)return;
    setDraft(previous=>{const next=copy(previous);updater(next);syncThermalNodes(next);return next;});
    setResult(null);
    setNotice(null);
    setConfirmed(false);
  };
  const changeComponent=(updater:(node:MechanicalNode)=>void)=>edit(d=>{
    const item=d.components.find(part=>part.id===selected);
    if(item)updater(item);
  });
  const changeMotion=(updater:(joint:Joint)=>void)=>edit(d=>{
    const item=d.motions.find(part=>part.node===selected);
    if(item)updater(item);
  });

  const addPart=(shape:'box'|'sphere'|'cylinder')=>{
    const id=unique('Part',draft.components);
    edit(d=>d.components.push({
      id,shape,parent:component?.shape==='group'?component.id:null,
      position:component?.shape==='group'?[.25,0,0]:[0,1,0],size:[.4,.4,.4],
      color:'#718c9e',collision:true
    }));
    setSelected(id);
  };
  const addJoint=(type:'revolute'|'prismatic')=>{
    const id=unique('Pivot',draft.components);
    const partId=unique('MovingPart',[...draft.components,{id} as MechanicalNode]);
    const motionId=unique('joint',draft.motions.map(item=>({id:item.id} as MechanicalNode)));
    edit(d=>{
      d.components.push({
        id,shape:'group',parent:null,position:[0,1,.4],size:[1,1,1],color:'#526e82',collision:false
      },{
        id:partId,shape:'box',parent:id,position:[.25,0,0],size:[.48,.7,.05],color:'#667d8c',collision:true
      });
      d.motions.push({
        id:motionId,node:id,type,axis:type==='revolute'?[0,1,0]:[0,0,1],
        limits:type==='revolute'?[0,1.35]:[0,.5],open:type==='revolute'?1.2:.4,
        mass:3,friction:.6,stiffness:80,damping:12
      });
    });
    setSelected(id);
  };
  const rename=(id:string)=>{
    if(!component || id===component.id)return;
    edit(d=>{
      const old=component.id;
      const item=d.components.find(node=>node.id===old);
      if(item)item.id=id;
      for(const node of d.components)if(node.parent===old)node.parent=id;
      for(const joint of d.motions)if(joint.node===old)joint.node=id;
    });
    setSelected(id);
  };
  const remove=()=>{
    if(!component)return;
    const id=component.id;
    edit(d=>{
      d.components=d.components.filter(node=>node.id!==id&&node.parent!==id);
      d.motions=d.motions.filter(joint=>joint.node!==id);
    });
    setSelected(draft.components.find(node=>node.id!==id&&node.parent!==id)?.id||null);
  };
  const reset=()=>{
    if(busy)return;
    const next=industrialCabinetDraft() as Draft;
    setDraft(next);setSelected(next.components[0].id);setResult(null);setNotice(null);setConfirmed(false);
  };
  const loadJSON=(value:string)=>{
    if(busy)return;
    try{
      const parsed=mechanicalDraftSchema.parse(JSON.parse(value)) as Draft;
      setDraft(parsed);setSelected(parsed.components[0].id);setResult(null);setNotice({error:false,text:'机械资产 JSON 已加载，可以继续编辑。'});setConfirmed(false);
    }catch(error){setNotice({error:true,text:'JSON 无法导入：'+(error instanceof Error?error.message:String(error))});}
  };
  const exportJSON=()=>{
    const blob=new Blob([JSON.stringify(draft,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='mechanical-asset.json';link.click();
    URL.revokeObjectURL(url);
  };
  const build=async()=>{
    if(!validation.success || !confirmed || busy)return;
    setBusy(true);setNotice({error:false,text:'正在编译 GLB 并进行隔离关节物理验证…'});
    try{
      const built=await creator.build(validation.data as Draft);
      setResult(built);
      setNotice({error:false,text:'资产已验证并保存到资源库。准入状态：'+built.admission.status});
    }catch(error){
      setNotice({error:true,text:'创建失败：'+(error instanceof Error?error.message:String(error))});
    }finally{setBusy(false);}
  };
  const place=async()=>{
    if(!result||busy)return;
    setBusy(true);setNotice(null);
    try{
      const placed=await creator.place(result.assetId);
      if(placed.status!=='placement-committed'||!placed.id)throw new Error('未能放置：'+(placed.reason||placed.status)+'；可以在资源库拖拽资产寻找其他位置。');
      setNotice({error:false,text:'已加入世界：'+placed.id});
      navigate?.('world');
    }catch(error){setNotice({error:true,text:'放置失败：'+(error instanceof Error?error.message:String(error))});}
    finally{setBusy(false);}
  };

  return <section className="mechanical-workbench" aria-label="机械资产创建工作台">
    <header className="mechanical-workbench-header">
      <div>
        <h2>机械资产创建工作台</h2>
        <p>组合几何部件、定义铰链和滑轨。资产由 GLB 编译器生产，必须经过隔离物理验证才能注册。</p>
      </div>
      <div className="mechanical-header-actions">
        <button type="button" disabled={busy} onClick={reset}>加载工业柜模板</button>
        <button type="button" disabled={busy} onClick={()=>jsonInput.current?.click()}>导入 JSON</button>
        <button type="button" onClick={exportJSON}>导出 JSON</button>
        <input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={event=>{
          const file=event.target.files?.[0];
          if(file)void file.text().then(loadJSON).catch(error=>setNotice({error:true,text:String(error)}));
          event.target.value='';
        }}/>
      </div>
    </header>

    <div className="mechanical-workbench-grid">
      <section className="mechanical-model-panel" aria-label="3D 模型预览">
        <MechanicalPreview components={draft.components} selected={selected}/>
        <div className="mechanical-model-summary">
          <span>{draft.components.length} 个节点</span>
          <span>{draft.motions.length} 个关节</span>
          <span>{draft.components.filter(part=>part.collision&&part.shape!=='group').length} 个碰撞代理</span>
        </div>
      </section>

      <section className="mechanical-edit-panel" aria-label="部件参数">
        <fieldset disabled={busy}>
          <div className="mechanical-field-row">
            <label>资产名称<input aria-label="资产名称" value={draft.name} maxLength={80} onChange={event=>edit(d=>{d.name=event.target.value;})}/></label>
            <label>资产类别<input aria-label="资产类别" value={draft.type} maxLength={50} onChange={event=>edit(d=>{d.type=event.target.value;})}/></label>
          </div>

          <div className="mechanical-panel-heading"><h3>部件结构</h3><span>可选择部件修改属性</span></div>
          <div className="mechanical-component-list" role="listbox" aria-label="机械部件">
            {draft.components.map(node=><button type="button" role="option" aria-selected={selected===node.id} key={node.id}
              className={selected===node.id?'is-selected':''} onClick={()=>setSelected(node.id)}>
              <span>{node.parent?'↳ ':''}{node.id}</span>
              <small>{variants[node.shape]}{draft.motions.some(m=>m.node===node.id)?' · 关节':''}</small>
            </button>)}
          </div>
          <div className="mechanical-add-actions">
            <button type="button" onClick={()=>addPart('box')}>+ 长方体</button>
            <button type="button" onClick={()=>addPart('sphere')}>+ 球体</button>
            <button type="button" onClick={()=>addPart('cylinder')}>+ 圆柱</button>
            <button type="button" onClick={()=>addJoint('revolute')}>+ 铰链</button>
            <button type="button" onClick={()=>addJoint('prismatic')}>+ 滑轨</button>
          </div>

          {component?<div className="mechanical-selected-fields">
            <div className="mechanical-panel-heading"><h3>节点参数</h3><button className="mechanical-delete" type="button" onClick={remove}>删除部件</button></div>
            <label>节点 ID<input aria-label="节点 ID" value={component.id} onChange={event=>rename(event.target.value)} /></label>
            <div className="mechanical-field-row">
              <label>几何类型<select aria-label="几何类型" value={component.shape} disabled={component.shape==='group'} onChange={event=>changeComponent(node=>{node.shape=event.target.value as MechanicalNode['shape'];})}>
                {Object.entries(variants).map(([value,label])=><option key={value} value={value}>{label}</option>)}
              </select></label>
              <label>父节点<select aria-label="父节点" value={component.parent||''} disabled={component.shape==='group'} onChange={event=>changeComponent(node=>{node.parent=event.target.value||null;})}>
                <option value="">固定柜体</option>
                {groups.map(group=><option key={group.id} value={group.id}>{group.id}</option>)}
              </select></label>
            </div>
            <VectorEditor label="局部位置" value={component.position} onChange={position=>changeComponent(node=>{node.position=position;})}/>
            {component.shape!=='group'?<VectorEditor label="几何尺寸" value={component.size} onChange={size=>changeComponent(node=>{node.size=size;})}/>:null}
            <div className="mechanical-field-row">
              <label>表面颜色<input aria-label="表面颜色" type="color" value={component.color} onChange={event=>changeComponent(node=>{node.color=event.target.value;})}/></label>
              {component.shape!=='group'?<label className="mechanical-inline-check"><input type="checkbox" checked={component.collision} onChange={event=>changeComponent(node=>{node.collision=event.target.checked;})}/>参与碰撞代理</label>:null}
            </div>
          </div>:null}

          {motion?<div className="mechanical-motion-fields">
            <h3>物理关节：{motion.id}</h3>
            <label>关节类型<select aria-label="关节类型" value={motion.type} onChange={event=>changeMotion(m=>{m.type=event.target.value as Joint['type'];})}>
              <option value="revolute">旋转铰链</option><option value="prismatic">直线滑轨</option>
            </select></label>
            <p>{motionLabels[motion.type]} · 轴心来自当前 Group 的位置，关闭目标为 0。</p>
            <VectorEditor label="运动轴" value={motion.axis} step={1} onChange={axis=>changeMotion(m=>{m.axis=axis;})}/>
            <div className="mechanical-field-row">
              <label>关节下限<input aria-label="关节下限" type="number" step=".05" value={motion.limits[0]} onChange={event=>changeMotion(m=>{m.limits=[numeric(event.target.value),m.limits[1]];})}/></label>
              <label>关节上限<input aria-label="关节上限" type="number" step=".05" value={motion.limits[1]} onChange={event=>changeMotion(m=>{m.limits=[m.limits[0],numeric(event.target.value)];})}/></label>
              <label>打开目标<input aria-label="打开目标" type="number" step=".05" value={motion.open} onChange={event=>changeMotion(m=>{m.open=numeric(event.target.value);})}/></label>
            </div>
            <div className="mechanical-field-row">
              <label>部件质量 (kg)<input aria-label="部件质量" type="number" min=".01" step=".5" value={motion.mass} onChange={event=>changeMotion(m=>{m.mass=numeric(event.target.value);})}/></label>
              <label>电机刚度<input aria-label="电机刚度" type="number" step="5" value={motion.stiffness} onChange={event=>changeMotion(m=>{m.stiffness=numeric(event.target.value);})}/></label>
              <label>阻尼<input aria-label="阻尼" type="number" step="1" value={motion.damping} onChange={event=>changeMotion(m=>{m.damping=numeric(event.target.value);})}/></label>
            </div>
          </div>:null}
        </fieldset>
      </section>
    </div>

    <section className="mechanical-edit-panel mechanical-science-panel" aria-label="科学材料与热学锻造">
      <fieldset disabled={busy}>
        <div className="mechanical-panel-heading"><h3>科学材料与热学</h3><span>Asset Forge · 可组合热学 v1 / v2</span></div>
        <div className="mechanical-field-row">
          <label>根刚体类型
            <select aria-label="根刚体类型" value={draft.body||'fixed'} disabled={draft.motions.length>0}
              onChange={event=>edit(d=>{d.body=event.target.value as 'fixed'|'dynamic';})}>
              <option value="fixed">固定</option><option value="dynamic">动态</option>
            </select>
          </label>
          <label className="mechanical-inline-check">
            <input type="checkbox" checked={Boolean(draft.simulation)}
              onChange={event=>edit(d=>{d.simulation=event.target.checked ? {
                schema:'agentscape.simulation-profile',schemaVersion:1,model:'lumped-thermal-v1',
                material:{name:'用户自定义材料',densityKgM3:1000,specificHeatJkgK:1000,
                  conductivityWmK:0.5,provenance:'authored'},
                thermal:{mass:{mode:'explicit',massKg:1},initialTemperatureK:293.15,
                  heatPowerW:0,ambientTemperatureK:293.15,
                  ambientConductanceWPerK:0,contactConductanceWPerK:0}
              } : undefined;})}/>
            启用科学计算组件
          </label>
        </div>
        {draft.simulation ? <>
          <div className="mechanical-field-row">
            <button type="button" disabled={draft.simulation.schemaVersion===2}
              onClick={()=>edit(d=>{
                if(!d.simulation||d.simulation.schemaVersion!==1)return;
                const old=d.simulation;
                d.simulation={
                  schema:'agentscape.simulation-profile',schemaVersion:2,model:'thermal-network-v1',
                  nodes:[{id:'root',partName:'$root',
                    material:copy(old.material),thermal:copy(old.thermal)}],
                  links:[]
                };
              })}>
              {draft.simulation.schemaVersion===1?'升级为多部件独立热学网络':'已启用多部件热学网络'}
            </button>
            <span>v{draft.simulation.schemaVersion} · 每个物理部件独立储热</span>
          </div>
          {draft.simulation.schemaVersion===2 ? <>
            <label>编辑热学部件
              <select aria-label="编辑热学部件" value={draft.simulation.nodes.some(n=>n.id===thermalNodeId)?thermalNodeId:'root'}
                onChange={e=>setThermalNodeId(e.target.value)}>
                {draft.simulation.nodes.map(node=><option key={node.id} value={node.id}>
                  {node.id==='root'?'根刚体':node.partName} · {node.material.name}
                </option>)}
              </select>
            </label>
            <div className="mechanical-thermal-links">
              <strong>内部导热连接（W/K）</strong>
              {draft.simulation.links.map(link=><label key={link.from+'|'+link.to}>
                {link.from} ↔ {link.to}
                <input type="number" min=".001" step="1" aria-label={'内部导热 '+link.to}
                  value={link.conductanceWPerK} onChange={e=>edit(d=>{
                    if(d.simulation?.schemaVersion!==2)return;
                    const target=d.simulation.links.find(l=>l.from===link.from&&l.to===link.to);
                    if(target)target.conductanceWPerK=numeric(e.target.value);
                  })}/>
              </label>)}
              <p>每根铰链/滑轨对应独立热学节点；新增、删除关节时同步节点。内部导热连接仅是声明的模型参数，不自动从材料导热系数推算。</p>
            </div>
          </> : null}
          <ThermalMaterialEditor
            value={draft.simulation.schemaVersion===1
              ?draft.simulation
              :draft.simulation.nodes.find(n=>n.id===thermalNodeId)||draft.simulation.nodes[0]}
            label={draft.simulation.schemaVersion===2?thermalNodeId:''}
            onEdit={updater=>edit(d=>{
              if(!d.simulation)return;
              if(d.simulation.schemaVersion===1)updater(d.simulation);
              else {
                const node=d.simulation.nodes.find(n=>n.id===thermalNodeId)||d.simulation.nodes[0];
                if(node)updater(node);
              }
            })}/>
        </> : <p>不启用时继续按现有机械资产流程编译，不增加热学状态。</p>}
      </fieldset>
    </section>

    <section className="mechanical-publish" aria-label="资产验证和入库">
      <div className="mechanical-publish-copy">
        <h3>编译并验证资产</h3>
        <p>使用指定的碰撞代理、关节参数及材料模型进行编译检查。材料数据为声明或估计值，不代表真实物体已通过科学测量。</p>
        {error?<p className="mechanical-validation-error" role="alert">定义检查：{error}</p>:<p className="mechanical-validation-ok">定义结构有效，可以进入编译和物理验证。</p>}
      </div>
      <label className="mechanical-confirm"><input type="checkbox" disabled={busy||!validation.success} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>我已检查碰撞代理、运动范围与质量参数，允许进行物理验证和注册。</label>
      <div className="mechanical-publish-actions">
        <button id="mechanical-build" type="button" disabled={busy||!validation.success||!confirmed} onClick={()=>void build()}>{busy?'正在处理…':'编译、验证并入库'}</button>
        {result?<button type="button" disabled={busy} onClick={()=>void place()}>放入当前世界</button>:null}
      </div>
      {result?<p className="mechanical-result-id"><strong>资产已注册</strong> <code>{result.assetId}</code></p>:null}
      {notice?<p role={notice.error?'alert':'status'} className={notice.error?'mechanical-notice-error':'mechanical-notice-ok'}>{notice.text}</p>:null}
    </section>

    <details className="mechanical-json-editor">
      <summary>高级：通过 JSON 编辑或让 AI 生成部件结构</summary>
      <p>采用 <code>agentscape.mechanical-draft</code> v1，不执行任意 JavaScript；导入的结构会通过同一套模式和物理验证。</p>
      <textarea aria-label="机械资产 JSON" rows={12} spellCheck={false} value={json} onChange={event=>setJson(event.target.value)} placeholder="粘贴机械资产 JSON 定义…" />
      <div><button type="button" onClick={()=>setJson(JSON.stringify(draft,null,2))}>将当前定义填入编辑框</button><button type="button" disabled={busy||!json.trim()} onClick={()=>loadJSON(json)}>应用 JSON</button></div>
    </details>
  </section>;
}
