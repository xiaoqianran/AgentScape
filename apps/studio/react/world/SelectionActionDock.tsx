import { useEffect, useRef, useState } from 'react';
import { useStudioStore } from '../state/studioStore';
import { useActionOperation } from '../inspect/useActionOperation';
import { LABELS } from '../inspect/ActionPresentation';
import type { EditorCommandsLike, InspectorProjectionLike, InspectorAffordanceAction, InspectorAffordances } from '../inspect/InspectorTypes';
import './SelectionActionDock.css';
const QUICK=new Set(['pickup','open','close','turn_on','turn_off','pull_out','return']);
type Props={projection:InspectorProjectionLike;commands:EditorCommandsLike;log:(text:string,kind?:string)=>void;openInspect:()=>void};
function Actions({id,actor,affordances,commands,openInspect}:{id:string;actor:string|null;affordances:InspectorAffordances|null;commands:EditorCommandsLike;openInspect:()=>void}) {
  const {running,feedback,error}=useActionOperation(commands,actor,id);
  const actions=(affordances?.actions || []).filter(action=>action.execution==='interaction' || action.execution==='world-action');
  const primary=actions.find(action=>QUICK.has(action.action) && (action.available || action.canApproach));
  const [open,setOpen]=useState(false);
  const root=useRef<HTMLDivElement>(null);const trigger=useRef<HTMLButtonElement>(null);const menu=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!open)return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const close=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false);};
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setOpen(false);trigger.current?.focus();}};
    document.addEventListener('pointerdown',close,true);document.addEventListener('keydown',key,true);
    return ()=>{document.removeEventListener('pointerdown',close,true);document.removeEventListener('keydown',key,true);};
  },[open]);
  const execute=(action:InspectorAffordanceAction)=>{
    if(!actor || running || !commands.executeAffordance)return;
    void commands.executeAffordance({actor,target:id,action:action.action,...(action.partName?{partName:action.partName}:{})}).catch(()=>{});
  };
  return <div className="quick-actions" ref={root} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false);}}>
    {primary ? <button type="button" disabled={running || !actor} onClick={()=>execute(primary)}>{running?'执行中…':LABELS[primary.action] || primary.action}</button> : null}
    <button type="button" ref={trigger} aria-label="更多动作" aria-expanded={open} onClick={()=>setOpen(!open)}>···</button>
    {open ? <div ref={menu} className="selection-action-menu" aria-label="可用动作">
      {actions.filter(action=>QUICK.has(action.action)).map(action=><button key={action.action+':'+(action.partName || '')} type="button" disabled={running || !actor || (!action.available && !action.canApproach)} onClick={()=>execute(action)}>{LABELS[action.action] || action.action}{action.partName?' · '+action.partName:''}</button>)}
      <button type="button" onClick={()=>{setOpen(false);openInspect();}}>更多动作与参数</button>
    </div> : null}
    {error ? <span role="alert">{error}</span> : feedback ? <span role="status">{feedback}</span> : null}
  </div>;
}
function LegacyAction({id,label,commands}:{id:string;label:string;commands:EditorCommandsLike}) {
  const {running,error,feedback}=useActionOperation(commands,null,id);
  return <div className="quick-actions"><button type="button" disabled={running} onClick={()=>void commands.executeLegacy?.(id).catch(()=>{})}>{running?'执行中…':label}</button>{error?<span role="alert">{error}</span>:feedback?<span role="status">{feedback}</span>:null}</div>;
}
export function SelectionActionDock({ projection, commands, log, openInspect }:Props) {
  const selection=useStudioStore(state=>state.editor.selection);
  const openView=useStudioStore(state=>state.openView);
  useStudioStore(state=>state.editor.revision);
  if (!selection) return null;
  const model=projection.projectActions ? projection.projectActions(selection) : projection.project(selection);
  if(model.kind==='missing') return null;
  const actor='actor' in model ? model.actor ?? null : null;
  return <section className="selection-action-dock" aria-label="选中对象操作">
    <strong title={selection.id}>{model.title || selection.id}</strong>
    {'affordances' in model && model.affordances ? <Actions key={selection.source+selection.id+actor} id={selection.id} actor={actor} affordances={model.affordances} commands={commands} openInspect={openInspect} /> : null}
    {'type' in model && model.type==='agent' && commands.selectActor ? <button type="button" onClick={()=>{try{commands.selectActor?.(selection.id);}catch(error){log(String(error),'error');}}}>设为执行 Agent</button> : null}
    {'legacyAction' in model && model.legacyAction ? <LegacyAction id={selection.id} label={model.legacyAction} commands={commands} /> : null}
    <button type="button" onClick={()=>openView('world-task')}>让 Agent 操作</button>
    <button type="button" onClick={openInspect}>属性</button>
  </section>;
}
