import { useEffect, useState } from 'react';
import type { AuthoringInspectorModel, EditorCommandsLike } from './InspectorTypes';

export function AuthoringNodeInspector({
  model,
  commands,
  log
}: {
  model:AuthoringInspectorModel;
  commands:EditorCommandsLike;
  log:(text:string,kind?:string)=>void;
}) {
  const [name,setName]=useState(model.name);
  const [position,setPosition]=useState(()=>model.transform.position.map(String));
  const [uniformScale,setUniformScale]=useState(String(model.transform.scale[0] ?? 1));
  const [busy,setBusy]=useState<string|null>(null);

  useEffect(()=>{
    setName(model.name);
    setPosition(model.transform.position.map(String));
    setUniformScale(String(model.transform.scale[0] ?? 1));
  },[model.id,model.name,model.transform.position.join(','),model.transform.scale.join(',')]);

  const applyName=async()=>{
    if (busy) return;
    setBusy('name');
    try {
      await commands.renameAuthoringNode(model.id,name);
    } catch(error) {
      log('重命名失败：' + (error instanceof Error ? error.message : String(error)),'error');
    } finally {
      setBusy(null);
    }
  };

  const applyTransform=async()=>{
    if (busy) return;
    const nextPosition=position.map(Number);
    const scale=Number(uniformScale);
    if (nextPosition.some(value=>!Number.isFinite(value))) {
      log('Authoring 位置必须是有效数字。','error');
      return;
    }
    if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
      log('Authoring 缩放必须在 0–100 之间。','error');
      return;
    }

    setBusy('transform');
    try {
      await commands.transformAuthoringNode(model.id,{
        position:nextPosition,
        scale:[scale,scale,scale]
      });
    } catch(error) {
      log('Authoring 变换失败：' + (error instanceof Error ? error.message : String(error)),'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-inspector-source="authoring">
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">AUTHORING NODE</div>
        <h1 id="inspect-heading">{model.title}</h1>
        <p id="inspect-subheading">{model.subtitle} · 尚未成为 Runtime Entity</p>
      </header>

      <div id="selection" className="selection">
        <section className="inspect-section">
          <h3>节点</h3>
          <div className="transform-scale-editor">
            <label htmlFor="authoring-name">名称</label>
            <div className="inline-input">
              <input
                id="authoring-name"
                value={name}
                disabled={Boolean(busy)}
                onChange={(event)=>setName(event.target.value)}
                onKeyDown={(event)=>{ if(event.key==='Enter') void applyName(); }}
              />
              <button type="button" disabled={Boolean(busy)} onClick={()=>void applyName()}>
                {busy === 'name' ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
          <dl className="properties detail-properties">
            <div><dt>ID</dt><dd>{model.id}</dd></div>
            <div><dt>类型</dt><dd>{model.kind}</dd></div>
            <div><dt>子节点</dt><dd>{model.childCount}</dd></div>
            <div><dt>可见</dt><dd>{model.visible ? '是' : '否'}</dd></div>
          </dl>
        </section>

        <section className="inspect-section">
          <h3>Authoring Transform</h3>
          <div className="transform-scale-editor">
            <label>位置 XYZ</label>
            <div className="inline-input">
              {position.map((value,index)=>(
                <input
                  key={index}
                  aria-label={'Authoring position ' + ['X','Y','Z'][index]}
                  type="number"
                  step="0.05"
                  value={value}
                  disabled={Boolean(busy)}
                  onChange={(event)=>setPosition(current=>current.map((item,itemIndex)=>itemIndex===index ? event.target.value : item))}
                />
              ))}
            </div>
            <label htmlFor="authoring-scale">统一缩放</label>
            <div className="inline-input">
              <input
                id="authoring-scale"
                type="number"
                min="0.01"
                max="100"
                step="0.05"
                value={uniformScale}
                disabled={Boolean(busy)}
                onChange={(event)=>setUniformScale(event.target.value)}
                onKeyDown={(event)=>{ if(event.key==='Enter') void applyTransform(); }}
              />
              <button type="button" disabled={Boolean(busy)} onClick={()=>void applyTransform()}>
                {busy === 'transform' ? '应用中…' : '应用'}
              </button>
            </div>
            <small>修改通过 EditorCommandQueue → AuthoringDocument.patch，并进入 Authoring revision history。</small>
          </div>
        </section>

        <details className="disclosure">
          <summary>Authoring 详情</summary>
          <dl className="properties detail-properties">
            <div><dt>来源</dt><dd>AuthoringDocument</dd></div>
            <div><dt>模型引用</dt><dd>{model.modelRef ? 'ModelRef' : '无'}</dd></div>
            <div><dt>Quaternion</dt><dd>{model.transform.quaternion.join(', ')}</dd></div>
          </dl>
        </details>
      </div>
    </div>
  );
}
