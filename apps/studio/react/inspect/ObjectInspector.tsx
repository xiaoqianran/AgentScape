import { useEffect, useState } from 'react';
import { useStudioStore } from '../state/studioStore';
import { RuntimeEntityInspector } from './RuntimeEntityInspector';
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

  if (model.source === 'authoring' && model.kind !== 'missing') {
    return <AuthoringNodeInspector model={model as AuthoringInspectorModel} commands={commands} log={log} />;
  }

  return (
    <div data-inspector-source={model.source || 'none'}>
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">INSPECT</div>
        <h1 id="inspect-heading">{model.kind === 'missing' ? model.id : '请选择对象'}</h1>
        <p id="inspect-subheading">
          {model.kind === 'missing'
            ? '当前选择已不再存在。'
            : '选择 Runtime Entity 或 Authoring Node，查看对应域的属性与操作。'}
        </p>
      </header>
      <div id="empty-selection" className="empty-state">
        <strong>{model.kind === 'missing' ? '对象不可用' : '尚未选择对象'}</strong>
        <span>Inspector 不再猜测对象来源；不同 domain 使用独立的属性与命令路径。</span>
      </div>
    </div>
  );
}
