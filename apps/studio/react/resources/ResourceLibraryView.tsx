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
  placement:{
    beginDrag:(assetId:string)=>boolean;
    cancelDrag:()=>void;
    placeAtCenter:(assetId:string)=>Promise<unknown>;
  };
  openEnvironment?:(id:string)=>Promise<unknown>;
  openGeneratedWorld?:(id:string)=>Promise<unknown>;
  log?:(text:string,kind?:string)=>void;
};

const metaLine = (...parts:any[]) => parts.filter(Boolean).join(' · ');

function matches(item:ResourceItem,query:string) {
  if (!query) return true;
  return [item.id,item.label,item.type,item.description,item.source,item.mime,item.provider,...(item.tags || [])]
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
  openEnvironment,
  openGeneratedWorld,
  log = () => {}
}:Props) {
  const [kind,setKind] = useState<'assets'|'images'|'worlds'>('assets');
  const [query,setQuery] = useState('');
  const [revision,setRevision] = useState(0);
  const [busyId,setBusyId] = useState<string|null>(null);

  useEffect(()=>resources.onChange(()=>setRevision((value)=>value+1)),[resources]);
  const snapshot = useMemo(()=>resources.snapshot(),[resources,revision]);
  const visible = (snapshot[kind] || []).filter((item)=>matches(item,query.trim().toLowerCase()));
  const placeholder = kind === 'assets' ? '搜索 Asset…' : kind === 'images' ? '搜索 Image Artifact…' : '搜索 World…';

  const run = async (id:string,operation:()=>Promise<unknown>,errorPrefix:string) => {
    setBusyId(id);
    try { await operation(); }
    catch (error) { log(`${errorPrefix}：${error instanceof Error ? error.message : String(error)}`,'error'); }
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
        <h1>Library</h1>
        <p>持久化资源库。Recent Outputs 只保留最近构建结果，这里展示可复用的 Asset、Image 与 World。</p>
      </header>
      <div className="resource-controls">
        <div className="resource-kind-tabs" role="tablist" aria-label="资源类型">
          {(['assets','images','worlds'] as const).map((value)=>(
            <button key={value} type="button" data-resource-kind={value} className={kind === value ? 'active' : ''} aria-selected={kind === value} onClick={()=>{setKind(value);setQuery('');}}>
              {value === 'assets' ? 'Assets' : value === 'images' ? 'Images' : 'Worlds'}
            </button>
          ))}
        </div>
        <input id="resource-search" className="resource-search" type="search" placeholder={placeholder} aria-label="搜索资源" value={query} onChange={(event)=>setQuery(event.target.value)} />
      </div>
      <div id="resource-list" className="resource-list">
        {!visible.length ? (
          <div className="resource-empty">
            <strong>暂无 {kind}</strong>
            <span>{kind === 'assets' ? '生成或编译 GLB 后会出现在这里。' : '导入对应 Artifact 后会出现在这里。'}</span>
          </div>
        ) : visible.map((item)=>{
          if (kind === 'assets') {
            return <article key={item.id} className="resource-card resource-asset-card" draggable data-asset-id={item.id} onDragStart={(event)=>startDrag(event,item.id)} onDragEnd={()=>placement.cancelDrag()}>
              <div className="resource-card-top">
                <div className="resource-card-title"><strong>{item.label || item.id}</strong><code>{item.id}</code></div>
                <span className="resource-pill">{item.source}</span>
              </div>
              <div className="resource-card-meta">{metaLine(item.type,(item.actions || []).slice(0,4).join(' / '))}</div>
              <div className="resource-card-actions">
                <button className="resource-action" type="button" disabled={busyId === item.id} onClick={()=>void run(item.id,()=>placement.placeAtCenter(item.id),'放置资产失败')}>放到视口中心</button>
                <span className="resource-drag-hint">拖到场景中放置</span>
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
            {canOpenBuiltin ? <div className="resource-card-actions"><button className="resource-action" type="button" disabled={busyId === item.id} onClick={()=>void run(item.id,()=>openEnvironment!(item.id),'打开世界失败')}>打开世界</button></div> : null}
            {canOpenGenerated ? <div className="resource-card-actions"><button className="resource-action" type="button" disabled={busyId === item.id} onClick={()=>void run(item.id,()=>openGeneratedWorld!(item.id),'打开生成世界失败')}>替换当前环境</button></div> : null}
            {item.source === 'generated' && !openGeneratedWorld ? <div className="resource-card-note">World Artifact 已保存，但当前工作区不支持替换环境。</div> : null}
          </article>;
        })}
      </div>
    </section>
  );
}
