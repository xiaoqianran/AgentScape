import { assetDisplayName } from '../shared/ResourcePresentation';
import { useEffect, useState } from 'react';
import type { EditorCommandsLike, InspectorRelation, RuntimeInspectorModel } from './InspectorTypes';
import { AffordanceActionPanel } from './AffordanceActionPanel';

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
  const [errorMessage,setErrorMessage]=useState('');

  useEffect(()=>{
    setScaleInput(String(model.transform.scale));
  },[model.id,model.transform.scale]);

  const applyScale=async()=>{
    if (busy) return;
    const value=Number(scaleInput);
    if (!Number.isFinite(value) || value < 0.05 || value > 20) {
      setErrorMessage('缩放范围必须是 0.05–20。');log('缩放范围必须是 0.05–20。','error');
      return;
    }
    setBusy('scale');setErrorMessage('');
    try {
      await commands.scaleRuntime(model.id,value);
    } catch(error) {
      const message=error instanceof Error ? error.message : String(error);setErrorMessage(message);log('缩放失败：'+message,'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-inspector-source="runtime">
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">可交互对象</div>
        <h1 id="inspect-heading">{assetDisplayName(model.asset,model.title)}</h1>
        <p id="inspect-subheading">{model.id}</p>
      </header>

      <div id="selection" className="selection">
        {errorMessage ? <div className="inspect-error" role="alert">{errorMessage}</div> : null}

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
            <small>位置与旋转可在画布中拖动调整；缩放会同步物理尺寸。</small>
          </div>
        </section>

        <section className="inspect-section">
          <h3>空间关系</h3>
          <div id="relation-info" className="relation-info">
            {relations.length ? relations.map((relation,index)=>(
              <div key={relation.predicate + ':' + relation.object + ':' + index}>
                <strong>{RELATION_LABELS[relation.predicate] ?? relation.predicate}</strong>
                <span>{relation.object}</span>
              </div>
            )) : <span className="muted-copy">附近暂未检测到空间关系。</span>}
          </div>
          <p className="inspect-evidence-note">关系来自当前几何位置，不代表动作已经验证成功。</p>
          <div id="spatial-info" className="spatial-info">
            尺寸 {model.spatial.size.join(' × ')} · 附近 {model.spatial.nearbyCount} 个对象
          </div>
        </section>

        <section className="inspect-section">
          <h3>可用操作</h3>
          <AffordanceActionPanel targetId={model.id} actor={model.actor ?? null} affordances={model.affordances ?? null} commands={commands} log={log} disabled={Boolean(busy)} />
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
