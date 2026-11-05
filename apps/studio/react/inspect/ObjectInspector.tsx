import { useEffect, useState } from 'react';
import { useStudioStore } from '../state/studioStore';
import { RuntimeEntityInspector } from './RuntimeEntityInspector';
import { AffordanceActionPanel } from './AffordanceActionPanel';
import { AuthoringNodeInspector } from './AuthoringNodeInspector';
import type {
  EditorCommandsLike,
  InspectorProjectionLike,
  InspectorRelation,
  RuntimeInspectorModel,
  AuthoringInspectorModel
} from './InspectorTypes';
import './ObjectInspector.css';

type InspectorProps = {
  projection:InspectorProjectionLike;
  commands:EditorCommandsLike;
  log:(text:string,kind?:string)=>void;
};

export function ObjectInspectorView({ projection, commands, log }: InspectorProps) {
  const selection=useStudioStore(state=>state.editor.selection);
  const revision=useStudioStore(state=>state.editor.revision);
  const model=projection.project(selection);
  const [relations,setRelations]=useState<InspectorRelation[]>([]);

  useEffect(()=>{
    if (selection?.source !== 'runtime') {
      setRelations([]);
      return;
    }
    setRelations(projection.relations(selection));
  },[projection,revision,selection?.id,selection?.source]);

  if (model.source === 'runtime' && model.kind === 'entity') {
    return <RuntimeEntityInspector model={model as RuntimeInspectorModel} relations={relations} commands={commands} log={log} />;
  }

  if (model.source === 'environment' && model.kind === 'environment' && 'affordances' in model && model.affordances?.source === 'environment' && model.id) {
    return <div data-inspector-source="environment">
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">环境交互对象</div>
        <h1 id="inspect-heading">{model.affordances.label}</h1>
        <p id="inspect-subheading">{model.id}</p>
      </header>
      <section className="inspect-section"><h3>可用操作</h3>
        <AffordanceActionPanel targetId={model.id} actor={model.actor ?? null} affordances={model.affordances} commands={commands} log={log} />
      </section>
    </div>;
  }

  if (model.source === 'authoring' && model.kind !== 'missing') {
    return <AuthoringNodeInspector model={model as AuthoringInspectorModel} commands={commands} log={log} />;
  }

  return (
    <div data-inspector-source={model.source || 'none'}>
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">属性检查</div>
        <h1 id="inspect-heading">{model.kind === 'missing' ? model.id : '请选择对象'}</h1>
        <p id="inspect-subheading">
          {model.kind === 'missing'
            ? '当前选择已不再存在。'
            : '在左侧对象列表或画布中点击一个物体。'}
        </p>
      </header>
      <div id="empty-selection" className="empty-state">
        <strong>{model.kind === 'missing' ? '对象不可用' : '尚未选择对象'}</strong>
        <span>选中后可调整位置、旋转与尺寸，并查看可用的交互操作。</span>
      </div>
    </div>
  );
}
