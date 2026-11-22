import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StudioIcon } from '../shared/StudioIcon';
import { worldPresentation } from './WorldPresentation';
import { PUBLISHED_CODE_WORLDS } from '../../code-project/PublishedCodeWorlds.js';
import { codeWorldUrl } from '../../navigation/StudioRoutes.js';
import './WorldsPage.css';

type WorldDefinition = { id:string; title:string; number?:string; headline?:string; description?:string; facts?:string[]; worldFirst?:boolean };
type WorldResource = { id:string; label?:string; source?:string; current?:boolean; integrity?:string; provider?:string; jobId?:string };
type DraftWorld = { id:string; name?:string; updatedAt?:string };
type AuthoringControls = {
  subscribe:(listener:()=>void)=>()=>void;
  snapshot:()=>any;
  refresh?:()=>Promise<unknown>;
  open:(id:string)=>Promise<unknown>;
  createNew:()=>Promise<unknown>;
  rename?:(id:string,name:string)=>Promise<unknown>;
  remove?:(id:string)=>Promise<unknown>;
};
type Props = {
  environments:WorldDefinition[];
  presentation:any;
  resources?:{ snapshot:()=>Record<string,WorldResource[]>; onChange:(listener:()=>void)=>(()=>void)|undefined }|null;
  authoring?:AuthoringControls|null;
  codeProjects?:{subscribe:(listener:()=>void)=>()=>void;snapshot:()=>any;refresh?:()=>Promise<unknown>}|null;
  openBuiltinWorld:(id:string)=>Promise<unknown>;
  openGeneratedWorld?:(id:string)=>Promise<unknown>;
  enterAuthoringEditor?:(id:string|null)=>void;
  enterCurrentWorld?:()=>void;
  openBuild?:()=>void;
  onCollectionChange?:(collection:Collection)=>void;
};
const EMPTY_AUTHORING = Object.freeze({ worlds:[], status:null, loading:false, fileError:'' });
const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_AUTHORING;
type Collection = 'builtin'|'drafts'|'generated'|'code';

function formatUpdatedAt(value:unknown) {
  if (!value) return '尚未保存';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    month:'short',
    day:'numeric',
    hour:'2-digit',
    minute:'2-digit'
  }).format(date);
}

function WorldPreview({ src, alt, iconSize, eager=false }: { src:string|null; alt:string; iconSize:number; eager?:boolean }) {
  const [failed,setFailed]=useState(false);
  useEffect(()=>setFailed(false),[src]);
  return src && !failed
    ? <img src={src} alt={alt} loading={eager?'eager':'lazy'} onError={()=>setFailed(true)} />
    : <StudioIcon name="worlds" size={iconSize} />;
}

export function DraftWorldRow({
  world,
  currentId,
  dirty,
  busyKey,
  canManage,
  onOpen,
  onRename,
  onRemove
}: {
  world:DraftWorld;
  currentId:string|null;
  dirty:boolean;
  busyKey:string|null;
  canManage:boolean;
  onOpen:(id:string)=>void;
  onRename:(id:string,name:string)=>Promise<boolean>;
  onRemove:(id:string)=>void;
}) {
  const [editing,setEditing] = useState(false);
  const [name,setName] = useState(world.name || world.id);
  const isCurrent = currentId === world.id;
  const openKey = 'draft:' + world.id;
  const renameKey = 'rename:' + world.id;
  const removeKey = 'remove:' + world.id;

  useEffect(()=>{
    if (!editing) setName(world.name || world.id);
  },[editing,world.name,world.id]);

  const submitRename = async (event:any) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    const saved = await onRename(world.id,nextName);
    if (saved) setEditing(false);
  };

  return (
    <article className={'world-list-row'+(isCurrent?' is-current':'')} data-world-id={world.id}>
      <div className="world-list-icon"><StudioIcon name="folder" size={24} /></div>
      <div className="world-list-copy">
        {editing ? (
          <form className="world-list-name-editor" onSubmit={submitRename}>
            <label htmlFor={'rename-'+world.id}>草稿名称</label>
            <input
              id={'rename-'+world.id}
              value={name}
              maxLength={80}
              autoFocus
              onChange={(event)=>setName(event.target.value)}
              onKeyDown={(event)=>{
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setEditing(false);
                }
              }}
            />
            <div className="world-list-name-actions">
              <button type="submit" disabled={!name.trim() || !!busyKey}>
                {busyKey===renameKey?'保存中…':'保存'}
              </button>
              <button type="button" disabled={busyKey===renameKey} onClick={()=>setEditing(false)}>取消</button>
            </div>
          </form>
        ) : <strong>{world.name || world.id}</strong>}
        <small className="world-list-meta">
          <span>{isCurrent?'当前草稿':'本机草稿'}</span>
          {isCurrent && dirty ? <span>有未保存修改</span> : null}
          <span>最近保存：<time dateTime={world.updatedAt}>{formatUpdatedAt(world.updatedAt)}</time></span>
        </small>
        <code title={world.id}>{world.id}</code>
      </div>
      {!editing ? (
        <div className="world-list-actions">
          <button
            className="world-list-open"
            type="button"
            disabled={!!busyKey}
            onClick={()=>onOpen(world.id)}
          >
            {busyKey===openKey?'正在打开…':isCurrent?'继续编辑':'打开'}
            <StudioIcon name="arrow" size={16} />
          </button>
          {canManage ? (
            <>
              <button
                type="button"
                disabled={!!busyKey}
                aria-label={'重命名'+(world.name || world.id)}
                onClick={()=>setEditing(true)}
              >重命名</button>
              <button
                className="world-list-danger"
                type="button"
                disabled={!!busyKey || isCurrent}
                title={isCurrent?'当前草稿不能删除':'删除草稿'}
                aria-label={'删除'+(world.name || world.id)}
                onClick={()=>onRemove(world.id)}
              >
                {busyKey===removeKey?'删除中…':'删除'}
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function WorldsPage({ environments, presentation, resources=null, authoring=null, codeProjects=null, openBuiltinWorld, openGeneratedWorld, enterAuthoringEditor=()=>{}, enterCurrentWorld, openBuild, onCollectionChange }:Props) {
  const [resourceRevision,setResourceRevision] = useState(0);
  const [collection,setCollection] = useState<Collection>(()=>{
    const initial=new URLSearchParams(globalThis.location?.search || '').get('collection');
    return initial==='generated'||initial==='drafts'||initial==='code'?initial:'builtin';
  });
  const [query,setQuery] = useState('');
  const [busyKey,setBusyKey] = useState<string|null>(null);
  const [error,setError] = useState('');
  const busy = useRef(false);
  useEffect(()=>resources?.onChange?.(()=>setResourceRevision(value=>value+1)),[resources]);
  const resourceSnapshot = useMemo(()=>resources?.snapshot?.() || { worlds:[] },[resources,resourceRevision]);
  const generatedWorlds = (resourceSnapshot.worlds || []).filter(item=>item.source==='generated');
  const authoringState:any = useSyncExternalStore(authoring?.subscribe || emptySubscribe,authoring?.snapshot || emptySnapshot,authoring?.snapshot || emptySnapshot);
  const drafts:DraftWorld[] = authoringState.worlds || [];
  const codeState:any=useSyncExternalStore(codeProjects?.subscribe || emptySubscribe,codeProjects?.snapshot || emptySnapshot,codeProjects?.snapshot || emptySnapshot);
  const localCodeWorlds:Array<{id:string;name?:string;updatedAt?:string}>=codeState.projects || [];
  const publishedIds=new Set<string>(PUBLISHED_CODE_WORLDS.map(world=>world.id));
  const localOnlyCodeWorlds=localCodeWorlds.filter(world=>!publishedIds.has(world.id));
  const authoringLoading = Boolean(authoringState.loading);
  const currentDraftId = authoringState.status?.active === false ? null : authoringState.status?.id || null;
  const current = worldPresentation(presentation || { id:'', title:'当前世界' });
  const needle=query.trim().toLocaleLowerCase();
  const matches=(...values:unknown[])=>!needle || values.some(value=>String(value || '').toLocaleLowerCase().includes(needle));
  const visibleBuiltins=environments.filter(world=>matches(worldPresentation(world).title,worldPresentation(world).description,world.id));
  const visibleDrafts=drafts.filter(world=>matches(world.name,world.id));
  const visibleGenerated=generatedWorlds.filter(world=>matches(world.label,world.id));
  const visiblePublishedCodeWorlds=PUBLISHED_CODE_WORLDS.filter(world=>matches(world.name,world.description,world.id));
  const visibleLocalCodeWorlds=localOnlyCodeWorlds.filter(world=>matches(world.name,world.id));
  const counts={builtin:environments.length,drafts:drafts.length,generated:generatedWorlds.length,code:PUBLISHED_CODE_WORLDS.length+localOnlyCodeWorlds.length};
  const visibleCount=collection==='builtin'?visibleBuiltins.length:collection==='drafts'?visibleDrafts.length:collection==='generated'?visibleGenerated.length:visiblePublishedCodeWorlds.length+visibleLocalCodeWorlds.length;
  const showDraftLoading=collection==='drafts' && authoringLoading && drafts.length===0;
  const canManageDrafts=Boolean(authoring?.rename && authoring?.remove);

  const run=async(key:string,operation:()=>Promise<unknown>)=>{
    if(busy.current) return null;
    busy.current=true;
    setBusyKey(key);
    setError('');
    try { return await operation(); }
    catch(cause) {
      setError(cause instanceof Error ? cause.message : '操作失败，请重试。');
      return null;
    }
    finally {
      busy.current=false;
      setBusyKey(null);
    }
  };

  const openCodeWorld=(published:string|null,local:string|null)=>{
    globalThis.location.assign(codeWorldUrl(globalThis.location.href,{published,local}));
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

  const refreshDrafts=async()=>{
    if(!authoring?.refresh) return;
    const result=await run('refresh',()=>authoring.refresh!());
    if(!result && authoring.snapshot()?.fileError) setError(authoring.snapshot().fileError);
  };

  const renameDraft=async(id:string,name:string)=>{
    if(!authoring?.rename) return false;
    const result=await run('rename:'+id,()=>authoring.rename!(id,name));
    if(!result && authoring.snapshot()?.fileError) setError(authoring.snapshot().fileError);
    return Boolean(result);
  };

  const removeDraft=async(id:string)=>{
    if(!authoring?.remove) return;
    const result=await run('remove:'+id,()=>authoring.remove!(id));
    if(!result && authoring.snapshot()?.fileError) setError(authoring.snapshot().fileError);
  };

  return <section className="worlds-page" data-product-page="worlds" aria-label="世界工作台">
    <header className="worlds-heading">
      <div>
        <div className="eyebrow">YOUR WORKSPACE</div>
        <h1>世界工作台</h1>
        <p>选择一个场景，编辑空间，再让智能体行动。</p>
      </div>
      <button type="button" className="worlds-primary-action" disabled={!authoring || !!busyKey} onClick={()=>void create()}>
        <StudioIcon name="plus" />
        {busyKey==='new'?'正在创建…':'新建草稿'}
      </button>
    </header>

    <section className="worlds-current" aria-label="当前世界">
      <div className="worlds-current-copy">
        <span className="worlds-current-label"><i />继续当前世界</span>
        <h2>{current.title}</h2>
        <p>{current.description || '回到画布，继续编辑你的场景。'}</p>
        <button className="worlds-current-action" type="button" disabled={!!busyKey} onClick={()=>enterCurrentWorld ? enterCurrentWorld() : void run('current',()=>openBuiltinWorld(presentation.id))}>
          进入编辑器
          <StudioIcon name="arrow" />
        </button>
        <small>场景编辑 · 物理交互 · 智能体任务</small>
      </div>
      <div className="worlds-current-preview"><WorldPreview src={current.preview} alt={current.title+'的场景预览'} iconSize={80} eager /><span>场景预览</span></div>
    </section>

    <div className="worlds-browser-heading">
      <div>
        <h2>选择你的起点</h2>
        <p>从现成场景开始，或继续自己的创作。</p>
      </div>
      {collection==='drafts' && authoring?.refresh ? (
        <button className="worlds-refresh" type="button" disabled={!!busyKey || authoringLoading} onClick={()=>void refreshDrafts()}>
          {authoringLoading?'正在刷新…':'刷新草稿'}
        </button>
      ) : null}
    </div>

    <div className="worlds-controls">
      <div className="worlds-filters" role="group" aria-label="世界分类">
        {([['builtin','示例场景'],['drafts','我的草稿'],['generated','已生成'],['code','代码世界']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={collection===key} onClick={()=>{setCollection(key);setQuery('');setError('');onCollectionChange?.(key);}}>{label}<span>{counts[key]}</span></button>)}
      </div>
      <label className="worlds-search"><StudioIcon name="search" size={16} /><input type="search" aria-label="搜索世界" placeholder="搜索名称或场景…" value={query} onChange={e=>setQuery(e.target.value)} /></label>
    </div>

    {error ? <div className="worlds-error" role="alert"><span>操作未完成：{error}</span><button type="button" aria-label="关闭错误提示" onClick={()=>setError('')}><StudioIcon name="close" /></button></div> : null}

    <div className="worlds-results" aria-busy={!!busyKey || authoringLoading}>
      {showDraftLoading ? <div className="worlds-loading" role="status"><StudioIcon name="folder" size={24} /><span>正在读取本机草稿…</span></div> : null}
      {!showDraftLoading && collection==='builtin' ? <div className="worlds-grid">{visibleBuiltins.map(world=>{
        const view=worldPresentation(world);
        const isCurrent=!presentation?.generated && presentation?.id===world.id;
        return <article key={world.id} className={'world-card'+(isCurrent?' is-current':'')} data-world-card={world.id}>
          <button className="world-card-preview" type="button" aria-label={'打开'+view.title} disabled={!!busyKey} onClick={()=>void run(world.id,()=>openBuiltinWorld(world.id))}><WorldPreview src={view.preview} alt="" iconSize={48} /><span>{view.category}</span>{isCurrent?<em>当前世界</em>:null}</button>
          <div className="world-card-body"><h3>{view.title}</h3><p>{view.description}</p></div>
          <button className="world-card-open" type="button" disabled={!!busyKey} onClick={()=>void run(world.id,()=>openBuiltinWorld(world.id))}><span>{busyKey===world.id?'正在打开…':isCurrent?'回到当前世界':'打开场景'}</span><StudioIcon name="arrow" size={17} /></button>
        </article>;
      })}</div> : null}

      {!showDraftLoading && collection==='drafts' ? <div className="worlds-list">
        {visibleDrafts.map((world)=><DraftWorldRow
          key={world.id}
          world={world}
          currentId={currentDraftId}
          dirty={Boolean(authoringState.status?.dirty)}
          busyKey={busyKey}
          canManage={canManageDrafts}
          onOpen={(id)=>void openDraft(id)}
          onRename={renameDraft}
          onRemove={(id)=>void removeDraft(id)}
        />)}
      </div> : null}

      {!showDraftLoading && collection==='generated' ? <div className="worlds-list">
        {visibleGenerated.map((world:any)=>{
          const key='generated:'+world.id;
          return <article className="world-list-row" key={world.id}>
            <div className="world-list-icon"><StudioIcon name="worlds" size={24} /></div>
            <div className="world-list-copy"><strong>{world.label || world.id}</strong><small className="world-list-meta"><span>{world.provider || '生成的世界'}</span><span>{world.integrity || '待验证'}</span></small><code title={world.id}>{world.id}</code></div>
            <div className="world-list-actions">
              <button type="button" disabled={!!busyKey || !openGeneratedWorld} onClick={()=>openGeneratedWorld && void run(key,()=>openGeneratedWorld(world.id))}>{busyKey===key?'正在打开…':'打开'}<StudioIcon name="arrow" size={16} /></button>
            </div>
          </article>;
        })}
      </div> : null}

      {collection==='code' ? <div className="worlds-list" aria-label="代码世界列表">
        {visiblePublishedCodeWorlds.map(world=><article className="world-list-row" data-code-world={world.slug} key={world.slug}>
          <div className="world-list-icon"><StudioIcon name="worlds" size={24} /></div>
          <div className="world-list-copy">
            <strong>{world.name}</strong>
            <small className="world-list-meta"><span>已发布的完整 Three.js 代码世界</span><span>首次打开将导入当前浏览器</span></small>
            <small>{world.description}</small>
          </div>
          <div className="world-list-actions">
            <button type="button" disabled={!!busyKey} onClick={()=>openCodeWorld(world.slug,null)}>在 Studio 中打开<StudioIcon name="arrow" size={16}/></button>
          </div>
        </article>)}
        {visibleLocalCodeWorlds.map(world=><article className="world-list-row" data-code-project={world.id} key={world.id}>
          <div className="world-list-icon"><StudioIcon name="folder" size={24}/></div>
          <div className="world-list-copy"><strong>{world.name || world.id}</strong>
            <small className="world-list-meta"><span>当前浏览器的代码世界</span><span>最近保存：{formatUpdatedAt(world.updatedAt)}</span></small>
            <code>{world.id}</code>
          </div>
          <div className="world-list-actions">
            <button type="button" disabled={!!busyKey} onClick={()=>openCodeWorld(null,world.id)}>继续编辑<StudioIcon name="arrow" size={16}/></button>
          </div>
        </article>)}
      </div> : null}

      {!visibleCount && !showDraftLoading ? <div className="worlds-empty"><StudioIcon name={query?'search':collection==='drafts'?'folder':'worlds'} size={32} /><h3>{query?'没有找到匹配的世界':collection==='drafts'?'给新想法一个空白场景':collection==='code'?'还没有代码世界':'还没有生成的世界'}</h3><p>{query?'换一个关键词，或清除搜索。':collection==='drafts'?'新建草稿后，可以从资源库添加物体并保存到本机。':collection==='code'?'可以从代码世界入口创建，或打开已发布的示例。':'前往生成工作台，描述你想要的环境。生成结果会保存在这里。'}</p>{query ? <button type="button" onClick={()=>setQuery('')}>清除搜索</button> : collection==='drafts' ? <button type="button" disabled={!authoring || !!busyKey} onClick={()=>void create()}>新建草稿</button> : openBuild ? <button type="button" onClick={openBuild}>前往生成工作台<StudioIcon name="arrow" size={16} /></button> : null}</div> : null}
    </div>

    <footer className="worlds-footer"><span>{showDraftLoading?'正在读取…':`${visibleCount} 个${collection==='builtin'?'示例场景':collection==='drafts'?'草稿':collection==='code'?'代码世界':'生成世界'}`}</span><span>本机草稿保存在当前浏览器；已发布代码世界可跨浏览器访问</span></footer>
  </section>;
}
