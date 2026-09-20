import { useState } from 'react';
import './AuthoringPromotionView.css';

type Node = {
  nodeId:string; name:string; depth:number; status:string; reason:string | null;
  usage:string; assetId:string | null; entityId:string | null;
  admission:{ status:string; reasons:string[] } | null;
  verification:{ physics?:{ registered:boolean }; navigation?:{ success:boolean }; interaction?:{ status:string; reason?:string } } | null;
};
type State = { nodes?:Node[]; busy?:boolean; message?:string };
type Controller = { refresh:()=>Promise<unknown>; promote:(action:string, nodeId:string | null, options?:Record<string, unknown>)=>Promise<unknown> };
const labels:Record<string,string> = { draft:'视觉原稿', prepared:'资产已准备', promoted:'已正式晋升', editing:'已进入编辑态', outdated:'世界实例待更新', missing:'关联实体未在当前世界', changed:'原稿已改变' };

export function AuthoringPromotionView({ state, controller }:{ state:State; controller:Controller }) {
  const [selected, setSelected] = useState('');
  const [usage, setUsage] = useState('static');
  const [allowProvisional, setAllowProvisional] = useState(false);
  const nodes = state.nodes || [];
  const node = nodes.find(item => item.nodeId === selected);
  const disabled = Boolean(state.busy || !node || node.reason);
  const run = (action:string) => void controller.promote(action, selected, { usage, allowProvisional });
  return <details className="authoring-promotion">
    <summary>将创作对象加入世界</summary>
    <button type="button" disabled={state.busy} onClick={()=>void controller.refresh()}>刷新创作对象</button>
    <label>创作对象
      <select aria-label="待晋升创作对象" value={selected} disabled={state.busy} onChange={event=>{
        const id = event.target.value;
        setSelected(id);
        setUsage(nodes.find(item=>item.nodeId===id)?.usage || 'static');
        setAllowProvisional(false);
      }}>
        <option value="">选择对象或分组</option>
        {nodes.map(item=><option key={item.nodeId} value={item.nodeId}>{'　'.repeat(Math.min(item.depth, 8))}{item.name} · {labels[item.status] || item.status}</option>)}
      </select>
    </label>
    <label>用途
      <select aria-label="晋升用途" value={usage} disabled={state.busy} onChange={event=>setUsage(event.target.value)}>
        <option value="static">静态物件 / 障碍</option>
        <option value="movable">可移动 / 可拾取物件</option>
        <option value="interactive">已有交互能力的物件</option>
      </select>
    </label>
    <label><input type="checkbox" checked={allowProvisional} disabled={state.busy} onChange={event=>setAllowProvisional(event.target.checked)} />允许未就绪资产进入编辑态</label>
    <button type="button" disabled={disabled} onClick={()=>void controller.promote('prepareAuthoringAsset', selected, { usage })}>准备正式资产</button>
    <button type="button" disabled={disabled || Boolean(node?.entityId)} onClick={()=>run('promoteAuthoringNode')}>晋升为世界实体</button>
    <button type="button" disabled={disabled || !node?.entityId} onClick={()=>run('updateAuthoringEntity')}>将原稿更新到世界</button>
    <button type="button" disabled={state.busy || !nodes.some(item=>item.entityId)} onClick={()=>void controller.promote('restoreAuthoringEntities', null, { allowProvisional })}>恢复存档关联实体</button>
    <button type="button" disabled={state.busy || !node?.entityId} onClick={()=>void controller.promote('detachAuthoringEntity', selected)}>解除关联，保留世界实体</button>
    <button type="button" disabled={state.busy || !node?.entityId} onClick={()=>void controller.promote('verifyAuthoringEntity', selected)}>检查物理与导航</button>
    <button type="button" disabled={state.busy || !node?.entityId || usage === 'static'} onClick={()=>void controller.promote('verifyAuthoringEntity', selected, { exerciseInteraction:true })}>执行 Agent 交互验证</button>
    {node ? <div className="toolbar-menu-status">
      <div>{labels[node.status] || node.status}{node.reason ? ` · ${node.reason}` : ''}</div>
      {node.admission ? <div>资产：{node.admission.status === 'ready' ? '就绪' : '未就绪'}{node.admission.reasons.length ? ` · ${node.admission.reasons.join(', ')}` : ''}</div> : null}
      {node.entityId ? <div>世界实体：{node.entityId}</div> : null}
      {node.verification ? <div>物理：{node.verification.physics?.registered ? '已注册' : '未验证'}；导航：{node.verification.navigation?.success ? '已重建 / 同步' : '未通过'}；交互行为：{({ verified:'验证通过', failed:'验证失败', unsupported:'暂不支持自动验证', 'not-applicable':'无需交互', 'not-exercised':'尚未执行验证' })[node.verification.interaction?.status || 'not-exercised'] || '尚未验证'}{node.verification.interaction?.reason ? ` · ${node.verification.interaction.reason}` : ''}</div> : null}
    </div> : null}
    <div role="status" aria-live="polite" className="toolbar-menu-status">{state.message}</div>
  </details>;
}
