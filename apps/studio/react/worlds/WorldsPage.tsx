import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import './WorldsPage.css';

type WorldDefinition = {
  id:string;
  title:string;
  number?:string;
  headline?:string;
  description?:string;
  facts?:string[];
  worldFirst?:boolean;
};

type WorldResource = {
  id:string;
  label?:string;
  source?:string;
  current?:boolean;
  integrity?:string;
  provider?:string;
  jobId?:string;
};

type Props = {
  environments:WorldDefinition[];
  presentation:any;
  resources?:{
    snapshot:()=>Record<string,WorldResource[]>;
    onChange:(listener:()=>void)=>(()=>void)|undefined;
  }|null;
  authoring?:{
    subscribe:(listener:()=>void)=>()=>void;
    snapshot:()=>any;
    refresh?:()=>Promise<unknown>;
    open:(id:string)=>Promise<unknown>;
    createNew:()=>Promise<unknown>;
  }|null;
  openBuiltinWorld:(id:string)=>Promise<unknown>;
  openGeneratedWorld?:(id:string)=>Promise<unknown>;
  enterAuthoringEditor?:(id:string|null)=>void;
};

const EMPTY_AUTHORING = Object.freeze({ worlds:[], status:null });
const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_AUTHORING;

export function WorldsPage({
  environments,
  presentation,
  resources = null,
  authoring = null,
  openBuiltinWorld,
  openGeneratedWorld,
  enterAuthoringEditor = () => {}
}:Props) {
  const [resourceRevision,setResourceRevision] = useState(0);
  const [busyKey,setBusyKey] = useState<string|null>(null);
  useEffect(()=>resources?.onChange?.(()=>setResourceRevision((value)=>value+1)),[resources]);
  const resourceSnapshot = useMemo(()=>resources?.snapshot?.() || { worlds:[] },[resources,resourceRevision]);
  const generatedWorlds = (resourceSnapshot.worlds || []).filter((item)=>item.source === 'generated');

  const authoringState:any = useSyncExternalStore(
    authoring?.subscribe || emptySubscribe,
    authoring?.snapshot || emptySnapshot,
    authoring?.snapshot || emptySnapshot
  );

  const currentSource = String(presentation?.persistenceSource || '');
  const run = async (key:string,operation:()=>Promise<unknown>) => {
    setBusyKey(key);
    try { return await operation(); }
    finally { setBusyKey(null); }
  };

  const openAuthoring = async (id:string) => {
    if (!authoring) return;
    const result = await run('authoring:'+id,()=>authoring.open(id));
    if (result) enterAuthoringEditor(id);
  };

  const createAuthoring = async () => {
    if (!authoring) return;
    const result = await run('authoring:new',()=>authoring.createNew());
    if (result) enterAuthoringEditor(null);
  };

  return (
    <section className="worlds-page" data-product-page="worlds" aria-label="Worlds">
      <header className="worlds-heading">
        <div>
          <div className="eyebrow">WORLDS</div>
          <h1>Worlds</h1>
          <p>选择一个运行世界，继续生成世界，或进入创作草稿。World Editor 只负责当前打开的具体世界。</p>
        </div>
        {authoring ? <button type="button" className="worlds-primary-action" disabled={busyKey === 'authoring:new'} onClick={()=>void createAuthoring()}>＋ New World</button> : null}
      </header>

      <section className="worlds-section" aria-labelledby="builtin-worlds-title">
        <div className="worlds-section-heading">
          <div>
            <span>BUILT-IN</span>
            <h2 id="builtin-worlds-title">Runtime Worlds</h2>
          </div>
          <small>{environments.length} worlds</small>
        </div>
        <div className="worlds-grid">
          {environments.map((world)=>{
            const current = !presentation?.generated && presentation?.id === world.id;
            return (
              <article key={world.id} className={'world-card' + (current ? ' is-current' : '')} data-world-card={world.id}>
                <div className="world-card-topline">
                  <span>{world.number || 'WORLD'}</span>
                  <em>{current ? 'CURRENT' : world.worldFirst ? 'WORLD FIRST' : 'RUNTIME'}</em>
                </div>
                <div className="world-card-body">
                  <h3>{world.title}</h3>
                  <p>{world.description || world.headline || ''}</p>
                  <div className="world-card-facts">{(world.facts || []).slice(0,3).map((fact)=><span key={fact}>{fact}</span>)}</div>
                </div>
                <button
                  type="button"
                  className="world-card-open"
                  disabled={busyKey === 'builtin:'+world.id}
                  onClick={()=>void run('builtin:'+world.id,()=>openBuiltinWorld(world.id))}
                >{current ? 'Open current world' : 'Open in World Editor'} <span>→</span></button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="worlds-section" aria-labelledby="generated-worlds-title">
        <div className="worlds-section-heading">
          <div>
            <span>GENERATED</span>
            <h2 id="generated-worlds-title">Generated Worlds</h2>
          </div>
          <small>{generatedWorlds.length} artifacts</small>
        </div>
        {generatedWorlds.length ? (
          <div className="worlds-list">
            {generatedWorlds.map((world)=>{
              const current = presentation?.generated && currentSource === 'artifact:'+world.id;
              return (
                <article key={world.id} className={'world-list-row' + (current ? ' is-current' : '')}>
                  <div><strong>{world.label || world.id}</strong><code>{world.id}</code></div>
                  <div className="world-list-meta"><span>{current ? 'CURRENT' : world.integrity || 'declared'}</span><span>{world.provider || 'generated'}</span></div>
                  <button type="button" disabled={!openGeneratedWorld || busyKey === 'generated:'+world.id} onClick={()=>openGeneratedWorld && void run('generated:'+world.id,()=>openGeneratedWorld(world.id))}>Open →</button>
                </article>
              );
            })}
          </div>
        ) : <div className="worlds-empty">生成的 World Manifest Artifact 会出现在这里。</div>}
      </section>

      <section className="worlds-section" aria-labelledby="authoring-worlds-title">
        <div className="worlds-section-heading">
          <div>
            <span>AUTHORING</span>
            <h2 id="authoring-worlds-title">Draft Worlds</h2>
          </div>
          <small>{authoringState.worlds?.length || 0} drafts</small>
        </div>
        {authoringState.worlds?.length ? (
          <div className="worlds-list">
            {authoringState.worlds.map((world:any)=>{
              const current = authoringState.status?.id === world.id;
              return (
                <article key={world.id} className={'world-list-row' + (current ? ' is-current' : '')}>
                  <div><strong>{world.name || world.id}</strong><code>{world.id}</code></div>
                  <div className="world-list-meta"><span>{current ? 'OPEN' : 'DRAFT'}</span>{current && authoringState.status?.dirty ? <span>UNSAVED</span> : null}</div>
                  <button type="button" disabled={!authoring || busyKey === 'authoring:'+world.id} onClick={()=>void openAuthoring(world.id)}>Edit →</button>
                </article>
              );
            })}
          </div>
        ) : <div className="worlds-empty">还没有创作草稿。New World 会创建一个空白 Authoring Document。</div>}
      </section>
    </section>
  );
}
