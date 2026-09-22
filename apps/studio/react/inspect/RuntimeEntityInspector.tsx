import { useEffect, useState } from 'react';
import type { EditorCommandsLike, InspectorRelation, RuntimeInspectorModel } from './InspectorTypes';

const ACTION_LABELS: Record<string,string> = {
  open:'打开',
  close:'关闭',
  pickup:'拿起',
  drop:'放下'
};

const RELATION_LABELS: Record<string,string> = {
  ON:'位于其上',
  NEAR:'附近',
  INSIDE:'位于内部'
};

export function RuntimeEntityInspector({
  model,
  relations,
  commands,
  log
}: {
  model:RuntimeInspectorModel;
  relations:InspectorRelation[];
  commands:EditorCommandsLike;
  log:(text:string,kind?:string)=>void;
}) {
  const [scaleInput,setScaleInput]=useState(String(model.transform.scale));
  const [busy,setBusy]=useState<string|null>(null);

  useEffect(()=>{
    setScaleInput(String(model.transform.scale));
  },[model.id,model.transform.scale]);

  const runAction=async(action:string)=>{
    if (busy) return;
    setBusy('action:' + action);
    try {
      await commands.runtimeAction(action === 'drop' ? 'drop' : action,model.id);
    } catch(error) {
      log('错误：' + (error instanceof Error ? error.message : String(error)),'error');
    } finally {
      setBusy(null);
    }
  };

  const applyScale=async()=>{
    if (busy) return;
    const value=Number(scaleInput);
    if (!Number.isFinite(value) || value < 0.05 || value > 20) {
      log('缩放范围必须是 0.05–20。','error');
      return;
    }
    setBusy('scale');
    try {
      await commands.scaleRuntime(model.id,value);
    } catch(error) {
      log('缩放失败：' + (error instanceof Error ? error.message : String(error)),'error');
    } finally {
      setBusy(null);
    }
  };

  const actions=model.actions.filter(action=>Object.hasOwn(ACTION_LABELS,action));

  return (
    <div data-inspector-source="runtime">
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">RUNTIME ENTITY</div>
        <h1 id="inspect-heading">{model.title}</h1>
        <p id="inspect-subheading">{model.subtitle}</p>
      </header>

      <div id="selection" className="selection">
        <div className="object-title">
          <div>
            <h2 id="object-id">{model.id}</h2>
            <span id="object-type">{model.type}</span>
          </div>
        </div>

        <section className="inspect-section">
          <h3>变换</h3>
          <dl className="properties">
            <div><dt>位置</dt><dd id="position">{model.transform.position.join(', ')}</dd></div>
            <div><dt>旋转</dt><dd id="rotation">{model.transform.rotation.join(', ')}°</dd></div>
            <div><dt>缩放</dt><dd id="scale">{model.transform.scale}×</dd></div>
          </dl>
          <div className="transform-scale-editor">
            <label htmlFor="object-scale">统一缩放</label>
            <div className="inline-input">
              <input
                id="object-scale"
                type="number"
                min="0.05"
                max="20"
                step="0.05"
                value={scaleInput}
                disabled={Boolean(busy)}
                onChange={(event)=>setScaleInput(event.target.value)}
                onKeyDown={(event)=>{ if(event.key==='Enter') void applyScale(); }}
              />
              <button type="button" disabled={Boolean(busy)} onClick={()=>void applyScale()}>
                {busy === 'scale' ? '应用中…' : '应用'}
              </button>
            </div>
            <small>正式 Runtime Entity；修改通过 EditorCommandQueue → AgentTools。</small>
          </div>
        </section>

        <section className="inspect-section">
          <h3>关系</h3>
          <div id="relation-info" className="relation-info">
            {relations.length ? relations.map((relation,index)=>(
              <div key={relation.predicate + ':' + relation.object + ':' + index}>
                <strong>{RELATION_LABELS[relation.predicate] ?? relation.predicate}</strong>
                <span>{relation.object}</span>
              </div>
            )) : <span className="muted-copy">暂无语义关系。</span>}
          </div>
          <div id="spatial-info" className="spatial-info">
            尺寸 {model.spatial.size.join(' × ')} · 附近 {model.spatial.nearbyCount} 个对象
          </div>
        </section>

        <section className="inspect-section">
          <h3>操作</h3>
          <div id="actions" className="action-list">
            {actions.length ? actions.map(action=>(
              <button key={action} type="button" disabled={Boolean(busy)} onClick={()=>void runAction(action)}>
                {busy === 'action:' + action ? '执行中…' : ACTION_LABELS[action]}
              </button>
            )) : <span className="muted-copy">暂无可直接执行的操作。</span>}
          </div>
        </section>

        <details className="disclosure">
          <summary>资产详情</summary>
          <dl className="properties detail-properties">
            <div><dt>资产</dt><dd id="asset-id">{model.asset}</dd></div>
            <div><dt>实例</dt><dd id="instance-id">{model.id}</dd></div>
            <div><dt>来源</dt><dd>WorldRuntime / ObjectStore</dd></div>
          </dl>
        </details>
      </div>
    </div>
  );
}
