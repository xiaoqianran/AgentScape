import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StudioIcon } from '../shared/StudioIcon';
import { worldPresentation } from './WorldPresentation';
import './WorldsPage.css';

type WorldDefinition = { id:string; title:string; number?:string; headline?:string; description?:string; facts?:string[]; worldFirst?:boolean };
type WorldResource = { id:string; label?:string; source?:string; current?:boolean; integrity?:string; provider?:string; jobId?:string };
type Props = {
  environments:WorldDefinition[];
  presentation:any;
  resources?:{ snapshot:()=>Record<string,WorldResource[]>; onChange:(listener:()=>void)=>(()=>void)|undefined }|null;
  authoring?:{ subscribe:(listener:()=>void)=>()=>void; snapshot:()=>any; refresh?:()=>Promise<unknown>; open:(id:string)=>Promise<unknown>; createNew:()=>Promise<unknown> }|null;
  openBuiltinWorld:(id:string)=>Promise<unknown>;
  openGeneratedWorld?:(id:string)=>Promise<unknown>;
  enterAuthoringEditor?:(id:string|null)=>void;
  enterCurrentWorld?:()=>void;
  openBuild?:()=>void;
};
const EMPTY_AUTHORING = Object.freeze({ worlds:[], status:null });
const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_AUTHORING;
type Collection = 'builtin'|'drafts'|'generated';

function WorldPreview({ src, alt, iconSize, eager=false }: { src:string|null; alt:string; iconSize:number; eager?:boolean }) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return src && !failed
    ? <img src={src} alt={alt} loading={eager?'eager':'lazy'} onError={()=>setFailed(true)} />
    : <StudioIcon name="worlds" size={iconSize} />;
}

export function WorldsPage({ environments, presentation, resources=null, authoring=null, openBuiltinWorld, openGeneratedWorld, enterAuthoringEditor=()=>{}, enterCurrentWorld, openBuild }:Props) {
  const [resourceRevision,setResourceRevision] = useState(0);
  const [collection,setCollection] = useState<Collection>('builtin');
  const [query,setQuery] = useState('');
  const [busyKey,setBusyKey] = useState<string|null>(null);
  const [error,setError] = useState('');
  const busy = useRef(false);
  useEffect(()=>resources?.onChange?.(()=>setResourceRevision(value=>value+1)),[resources]);
  const resourceSnapshot = useMemo(()=>resources?.snapshot?.() || { worlds:[] },[resources,resourceRevision]);
  const generatedWorlds = (resourceSnapshot.worlds || []).filter(item=>item.source==='generated');
  const authoringState:any = useSyncExternalStore(authoring?.subscribe || emptySubscribe,authoring?.snapshot || emptySnapshot,authoring?.snapshot || emptySnapshot);
  const drafts:any[] = authoringState.worlds || [];
  const current = worldPresentation(presentation || { id:'', title:'当前世界' });
  const needle=query.trim().toLocaleLowerCase();
  const matches=(...values:unknown[])=>!needle || values.some(value=>String(value || '').toLocaleLowerCase().includes(needle));
  const visibleBuiltins=environments.filter(world=>matches(worldPresentation(world).title,worldPresentation(world).description,world.id));
  const visibleDrafts=drafts.filter(world=>matches(world.name,world.id));
  const visibleGenerated=generatedWorlds.filter(world=>matches(world.label,world.id));
  const counts={builtin:environments.length,drafts:drafts.length,generated:generatedWorlds.length};
  const visibleCount=collection==='builtin'?visibleBuiltins.length:collection==='drafts'?visibleDrafts.length:visibleGenerated.length;

  const run=async(key:string,operation:()=>Promise<unknown>)=>{
    if(busy.current) return;
    busy.current=true;setBusyKey(key);setError('');
    try { return await operation(); }
    catch(cause) { setError(cause instanceof Error ? cause.message : '打开失败，请重试。'); return null; }
    finally { busy.current=false;setBusyKey(null); }
  };
  const create=async()=>{
    if(!authoring) return;
    const result=await run('new',()=>authoring.createNew());
    if(result) enterAuthoringEditor(null);
    else if(authoring.snapshot()?.fileError) setError(authoring.snapshot().fileError);
  };
  const openDraft=async(id:string)=>{
    if(!authoring) return;
    const result=await run('draft:'+id,()=>authoring.open(id));
    if(result) enterAuthoringEditor(id);
    else if(authoring.snapshot()?.fileError) setError(authoring.snapshot().fileError);
  };

  return <section className="worlds-page" data-product-page="worlds" aria-label="世界工作台">
    <header className="worlds-heading">
      <div><div className="eyebrow">YOUR WORKSPACE</div><h1>世界工作台</h1><p>选择一个场景，编辑空间，再让智能体行动。</p></div>
      <button type="button" className="worlds-primary-action" disabled={!authoring || !!busyKey} onClick={()=>void create()}><StudioIcon name="plus" />{busyKey==='new'?'正在创建…':'新建草稿'}</button>
    </header>
    <section className="worlds-current" aria-label="当前工作区">
      <div className="worlds-current-copy"><span className="worlds-current-label"><i />继续当前世界</span><h2>{current.title}</h2><p>{current.description || '回到画布，继续编辑你的场景。'}</p>
        <button className="worlds-current-action" type="button" disabled={!!busyKey} onClick={()=>enterCurrentWorld ? enterCurrentWorld() : void run('current',()=>openBuiltinWorld(presentation.id))}>进入编辑器<StudioIcon name="arrow" /></button>
        <small>场景编辑 · 物理交互 · 智能体任务</small>
      </div>
      <div className="worlds-current-preview"><WorldPreview src={current.preview} alt={current.title+'的场景预览'} iconSize={80} eager /><span>场景预览</span></div>
    </section>
    <div className="worlds-browser-heading"><div><h2>选择你的起点</h2><p>从现成场景开始，或继续自己的创作。</p></div></div>
    <div className="worlds-controls">
      <div className="worlds-filters" role="group" aria-label="世界分类">
        {([['builtin','示例场景'],['drafts','我的草稿'],['generated','已生成']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={collection===key} onClick={()=>{setCollection(key);setQuery('');setError('');}}>{label}<span>{counts[key]}</span></button>)}
      </div>
      <label className="worlds-search"><StudioIcon name="search" size={16} /><input type="search" aria-label="搜索世界" placeholder="搜索名称或场景…" value={query} onChange={e=>setQuery(e.target.value)} /></label>
    </div>
    {error ? <div className="worlds-error" role="alert"><span>操作未完成：{error}</span><button type="button" aria-label="关闭错误提示" onClick={()=>setError('')}><StudioIcon name="close" /></button></div> : null}
    <div className="worlds-results" aria-busy={!!busyKey}>
      {collection==='builtin' ? <div className="worlds-grid">{visibleBuiltins.map(world=>{
        const view=worldPresentation(world);const isCurrent=!presentation?.generated && presentation?.id===world.id;
        return <article key={world.id} className={'world-card'+(isCurrent?' is-current':'')} data-world-card={world.id}>
          <button className="world-card-preview" type="button" aria-label={'打开'+view.title} disabled={!!busyKey} onClick={()=>void run(world.id,()=>openBuiltinWorld(world.id))}><WorldPreview src={view.preview} alt="" iconSize={48} /><span>{view.category}</span>{isCurrent?<em>当前世界</em>:null}</button>
          <div className="world-card-body"><h3>{view.title}</h3><p>{view.description}</p></div>
          <button className="world-card-open" type="button" disabled={!!busyKey} onClick={()=>void run(world.id,()=>openBuiltinWorld(world.id))}><span>{busyKey===world.id?'正在打开…':isCurrent?'回到当前世界':'打开场景'}</span><StudioIcon name="arrow" size={17} /></button>
        </article>;
      })}</div> : <div className="worlds-list">{(collection==='drafts'?visibleDrafts:visibleGenerated).map((world:any)=>{
        const draft=collection==='drafts';const key=(draft?'draft:':'generated:')+world.id;
        return <article className="world-list-row" key={world.id}><div className="world-list-icon"><StudioIcon name={draft?'folder':'worlds'} size={24} /></div><div className="world-list-copy"><strong>{world.name || world.label || world.id}</strong><small>{draft?'本机草稿':world.provider || '生成的世界'}{draft && authoringState.status?.id===world.id && authoringState.status?.dirty?' · 有未保存修改':''}</small><code title={world.id}>{world.id}</code></div><button type="button" disabled={!!busyKey || (!draft && !openGeneratedWorld)} onClick={()=>draft ? void openDraft(world.id) : openGeneratedWorld && void run(key,()=>openGeneratedWorld(world.id))}>{busyKey===key?'正在打开…':'打开'}<StudioIcon name="arrow" size={16} /></button></article>;
      })}</div>}
      {!visibleCount ? <div className="worlds-empty"><StudioIcon name={query?'search':collection==='drafts'?'folder':'worlds'} size={32} /><h3>{query?'没有找到匹配的世界':collection==='drafts'?'给新想法一个空白场景':'还没有生成的世界'}</h3><p>{query?'换一个关键词，或清除搜索。':collection==='drafts'?'新建草稿后，可以从资源库添加物体并保存到本机。':'前往生成工作台，描述你想要的环境。生成结果会保存在这里。'}</p>{query ? <button type="button" onClick={()=>setQuery('')}>清除搜索</button> : collection==='drafts' ? <button type="button" disabled={!authoring || !!busyKey} onClick={()=>void create()}>新建草稿</button> : openBuild ? <button type="button" onClick={openBuild}>前往生成工作台<StudioIcon name="arrow" size={16} /></button> : null}</div> : null}
    </div>
    <footer className="worlds-footer"><span>{visibleCount} 个{collection==='builtin'?'示例场景':collection==='drafts'?'草稿':'生成世界'}</span><span>草稿与资源保存在当前浏览器</span></footer>
  </section>;
}
