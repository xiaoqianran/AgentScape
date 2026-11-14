import { StudioIcon } from '../shared/StudioIcon';
import { MechanicalAssetWorkbench, type MechanicalCreator } from './MechanicalAssetWorkbench';
import { ThermalExperimentLab, type ThermalExperimentInput } from './ThermalExperimentLab';
import { assetDisplayName, assetPreview, assetActions } from '../shared/ResourcePresentation';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { ASSET_DRAG_MIME } from '../../editor/AssetPlacementController.js';
import './ResourceLibrary.css';

type ResourceItem = {
  id:string;
  label?:string;
  type?:string;
  description?:string;
  source?:string;
  mime?:string;
  provider?:string;
  tags?:string[];
  actions?:string[];
  format?:string;
  integrity?:string;
  bytes?:number;
  current?:boolean;
  number?:string;
  jobId?:string;
};

type Props = {
  resources:{
    snapshot:()=>Record<string,ResourceItem[]>;
    localArtifact:(id:string)=>{data?:Uint8Array|ArrayBuffer|null}|null;
    onChange:(listener:()=>void)=>(()=>void)|undefined;
  };
  creator?:MechanicalCreator;
  experiment?:(input:ThermalExperimentInput)=>Promise<{value:any}>;
  placement:{
    beginDrag:(assetId:string)=>boolean;
    cancelDrag:()=>void;
    placeAtCenter:(assetId:string)=>Promise<unknown>;
  };
  openEnvironment?:(id:string)=>Promise<unknown>;
  openGeneratedWorld?:(id:string)=>Promise<unknown>;
  log?:(text:string,kind?:string)=>void;
  navigate?:(page:'world'|'build')=>void;
};

const metaLine = (...parts:any[]) => parts.filter(Boolean).join(' · ');

function matches(item:ResourceItem,query:string) {
  if (!query) return true;
  return [assetDisplayName(item.id,item.label),assetActions(item.actions),item.id,item.label,item.type,item.description,item.source,item.mime,item.provider,...(item.tags || [])]
    .filter(Boolean)
    .some((value)=>String(value).toLowerCase().includes(query));
}

function ImagePreview({ resources, image }: { resources:Props['resources']; image:ResourceItem }) {
  const [url,setUrl] = useState<string|null>(null);
  useEffect(()=>{
    const local = resources.localArtifact(image.id);
    if (!local?.data) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([local.data as BlobPart],{ type:image.mime }));
    setUrl(next);
    return ()=>URL.revokeObjectURL(next);
  },[image.id,image.mime,resources]);
  return <div className="resource-image-preview">{url ? <img src={url} alt={image.label || image.id} /> : <span>{image.format?.toUpperCase() || 'IMAGE'}</span>}</div>;
}

export function ResourceLibraryView({
  resources,
  placement,
  creator,
  experiment,
  openEnvironment,
  openGeneratedWorld,
  navigate,
  log = () => {}
}:Props) {
  const [kind,setKind] = useState<'assets'|'images'|'worlds'|'create'|'lab'>('assets');
  const [query,setQuery] = useState('');
  const [revision,setRevision] = useState(0);
  const [busyId,setBusyId] = useState<string|null>(null);
  const [feedback,setFeedback] = useState<{error:boolean;text:string}|null>(null);

  useEffect(()=>resources.onChange(()=>setRevision((value)=>value+1)),[resources]);
  const snapshot = useMemo(()=>resources.snapshot(),[resources,revision]);
  const visible = (kind==='create'||kind==='lab' ? [] : snapshot[kind] || []).filter((item)=>matches(item,query.trim().toLowerCase()));
  const placeholder = kind === 'assets' ? '搜索名称、类型或能力…' : kind === 'images' ? '搜索图片…' : '搜索世界…';

  const run = async (id:string,operation:()=>Promise<unknown>,errorPrefix:string) => {
    if(busyId) return;
    setBusyId(id);setFeedback(null);
    try {
      const result:any=await operation();
      if (result?.status?.startsWith('placement-') && (result.status!=='placement-committed' || !result.id)) {
        const detail=result.status==='placement-blocked'?'当前位置有障碍，请回到编辑器选择其他落点。':'未能添加物体，请检查资源或在编辑器中选择落点。';
        setFeedback({error:true,text:detail});return;
      }
      if(result?.status==='placement-committed' && result.id) navigate?.('world');
      setFeedback({error:false,text:result?.result?.status==='asset-provisional'?'已添加到场景；该资源仍待验证。':'操作完成，可以返回编辑器查看。'});
    }
    catch (error) { const message=errorPrefix+'：'+(error instanceof Error ? error.message : String(error));setFeedback({error:true,text:message});log(message,'error'); }
    finally { setBusyId(null); }
  };

  const startDrag = (event:DragEvent,assetId:string) => {
    if (!placement.beginDrag(assetId)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData(ASSET_DRAG_MIME,assetId);
    event.dataTransfer.setData('text/plain',assetId);
    event.dataTransfer.effectAllowed='copy';
  };

  return (
    <section className="resource-console" aria-label="资源库">
      <header className="screen-heading product-heading product-heading--utility">
        <div className="eyebrow">LIBRARY</div>
        <h1>资源库</h1>
        <p>找到可复用的物体、图片和世界。选择资源，添加到当前场景。</p>
      </header>
      <div className="resource-controls">
        <div className="resource-kind-tabs" role="group" aria-label="资源类型">
          {(['assets','images','worlds',...(creator?['create'] as const:[]),...(experiment?['lab'] as const:[])] as const).map((value)=>(
            <button key={value} type="button" data-resource-kind={value} className={kind === value ? 'active' : ''} aria-pressed={kind === value} onClick={()=>{setKind(value);setQuery('');}}>
              {value === 'assets' ? '3D 物体' : value === 'images' ? '图片' : value==='worlds' ? '世界' : value==='create'?'创建机械资产':'热学实验台'}{value!=='create'&&value!=='lab'?<span>{snapshot[value]?.length || 0}</span>:null}
            </button>
          ))}
        </div>
        {kind!=='create'&&kind!=='lab'?<input id="resource-search" className="resource-search" type="search" placeholder={placeholder} aria-label="搜索资源" value={query} onChange={(event)=>setQuery(event.target.value)} />:null}
      </div>
      {feedback ? <div className="resource-feedback" role={feedback.error?'alert':'status'} data-error={feedback.error}><span>{feedback.text}</span>{!feedback.error && navigate?<button type="button" onClick={()=>navigate?.('world')}>查看场景 <StudioIcon name="arrow" size={15} /></button>:null}</div> : null}
      {kind==='create' && creator ? <MechanicalAssetWorkbench creator={creator} navigate={navigate} />
      : kind==='lab' && experiment ? <ThermalExperimentLab experiment={experiment} />
      : <div id="resource-list" className="resource-list" data-kind={kind} aria-busy={!!busyId}>
        {!visible.length ? (
          <div className="resource-empty">
            <StudioIcon name={query?'search':kind==='images'?'image':'cube'} size={32} />
            <strong>{query?'没有找到匹配的资源':'这里还没有资源'}</strong>
            <span>{query?'尝试其他关键词，或清除搜索。':'生成后的物体和图片可以在这里重复使用。'}</span>
            <button type="button" disabled={!query && !navigate} onClick={()=>query?setQuery(''):navigate?.('build')}>{query?'清除搜索':'前往生成工作台'}</button>
          </div>
        ) : visible.map((item)=>{
          if (kind === 'assets') {
            return <article key={item.id} className="resource-card resource-asset-card" draggable data-asset-id={item.id} onDragStart={(event)=>startDrag(event,item.id)} onDragEnd={()=>placement.cancelDrag()}>
              <div className="resource-asset-preview">{assetPreview(item.id)?<img src={assetPreview(item.id)!} alt={assetDisplayName(item.id,item.label)} loading="lazy" />:<StudioIcon name="cube" size={42} />}</div>
              <div className="resource-card-top">
                <div className="resource-card-title"><strong>{assetDisplayName(item.id,item.label)}</strong><code>{item.id}</code></div>
                <span className="resource-pill">{item.source==='builtin'?'内置':item.source==='compiled'?'已编译':item.source}</span>
              </div>
              <div className="resource-card-meta">{assetActions((item.actions || []).slice(0,4)) || '场景物体'}</div>
              <div className="resource-card-actions">
                <button className="resource-action" type="button" disabled={!!busyId} onClick={()=>void run(item.id,()=>placement.placeAtCenter(item.id),'放置资产失败')}>{busyId===item.id?'正在放置…':'添加到当前世界'}<StudioIcon name="plus" size={16} /></button>
                <span className="resource-drag-hint">在编辑器中可拖拽放置</span>
              </div>
            </article>;
          }
          if (kind === 'images') {
            return <article key={item.id} className="resource-card resource-image-card">
              <ImagePreview resources={resources} image={item} />
              <div className="resource-card-copy">
                <div className="resource-card-title"><strong>{item.label || item.id}</strong><code>{item.id}</code></div>
                <div className="resource-card-meta">{metaLine(item.mime,item.provider,item.integrity,`${Math.ceil((item.bytes || 0)/1024)} KiB`)}</div>
              </div>
            </article>;
          }
          const canOpenBuiltin = item.source === 'builtin' && !item.current && openEnvironment;
          const canOpenGenerated = item.source === 'generated' && openGeneratedWorld;
          return <article key={item.id} className="resource-card resource-world-card">
            <div className="resource-card-top">
              <div className="resource-card-title"><strong>{item.label || item.id}</strong><code>{item.id}</code></div>
              <span className="resource-pill">{item.current ? 'CURRENT' : item.source}</span>
            </div>
            <div className="resource-card-meta">{item.source === 'generated' ? metaLine(item.provider,item.integrity,item.jobId) : metaLine(item.number,item.description)}</div>
            {canOpenBuiltin ? <div className="resource-card-actions"><button className="resource-action" type="button" disabled={!!busyId} onClick={()=>void run(item.id,()=>openEnvironment!(item.id),'打开世界失败')}>打开世界</button></div> : null}
            {canOpenGenerated ? <div className="resource-card-actions"><button className="resource-action" type="button" disabled={!!busyId} onClick={()=>void run(item.id,()=>openGeneratedWorld!(item.id),'打开生成世界失败')}>替换当前环境</button></div> : null}
            {item.source === 'generated' && !openGeneratedWorld ? <div className="resource-card-note">World Artifact 已保存，但当前工作区不支持替换环境。</div> : null}
          </article>;
        })}
      </div>}
    </section>
  );
}
