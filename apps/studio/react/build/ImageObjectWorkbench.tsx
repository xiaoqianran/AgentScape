import { useEffect, useRef, useState } from 'react';
import { LocalImageEditor, type LocalImageEditorHandle } from './LocalImageEditor';
import { findForegroundRegions, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, openImageDraftStore, restoredDraft, runImageObjectQueue, validateImageFile } from '../../build/ImageObjectDrafts.js';

type Rect = {x:number; y:number; width:number; height:number};
type Source = {id:string; name:string; blob:Blob; width:number; height:number};
type Draft = Source & {
  sourceId:string; crop:Rect; selected:boolean; approved:boolean; status:string;
  error?:string; imageResult?:any; result?:any; jobId?:string; assetId:string; provider?:string | null;
};
type Workspace = {sources:Source[]; drafts:Draft[]};
type Props = {
  controller:any; paired:boolean; disabled:boolean; visible:boolean;
  onConnect:()=>void; onOutput:(result:any)=>void; onBusy:(busy:boolean)=>void;
};
const empty = ():Workspace => ({sources:[], drafts:[]});
const message = (error:unknown) => error instanceof Error ? error.message : String(error);
const labels:Record<string,string> = {draft:'待确认', ready:'已确认', uploading:'保存输入中', generating:'生成 / 编译中', failed:'失败', interrupted:'已中断', done:'已入库'};

function useBlobUrl(blob?:Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const value = URL.createObjectURL(blob); setUrl(value);
    return () => URL.revokeObjectURL(value);
  }, [blob]);
  return url;
}
function Thumbnail({source}:{source:Source}) {
  const url = useBlobUrl(source.blob);
  return <img src={url || undefined} alt={source.name} />;
}
const pngBlob = (canvas:HTMLCanvasElement) => new Promise<Blob>((resolve,reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 导出失败')), 'image/png'));

async function readSource(file:File):Promise<Source> {
  validateImageFile(file);
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS) throw new Error('图片超过 1600 万像素，请先缩小');
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap,0,0);
    const blob = await pngBlob(canvas);
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('转换后的 PNG 超过 20 MiB');
    return {id:crypto.randomUUID(), name:file.name || '粘贴图片', blob, width:bitmap.width, height:bitmap.height};
  } finally { bitmap.close(); }
}
function newDraft(source:Source, blob = source.blob, crop:Rect = {x:0,y:0,width:source.width,height:source.height}, name = source.name.replace(/\.[^.]+$/, '')):Draft {
  const id = crypto.randomUUID();
  return {id, sourceId:source.id, name, blob, crop, width:crop.width, height:crop.height, selected:true, approved:false, status:'draft', assetId:`generated_${id}`};
}

export function ImageObjectWorkbench({controller, paired, disabled, visible, onConnect, onOutput, onBusy}:Props) {
  const [workspace,setWorkspace] = useState<Workspace>(empty);
  const latest = useRef<Workspace>(empty());
  const store = useRef<any>(null);
  const writes = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const [loaded,setLoaded] = useState(false);
  const [busy,setBusy] = useState(false);
  const locked = useRef(false);
  const stop = useRef(false);
  const [stopping,setStopping] = useState(false);
  const [notice,setNotice] = useState('');
  const [active,setActive] = useState<{kind:'source'|'draft'; id:string}|null>(null);
  const [name,setName] = useState('');
  const [editorVersion,setEditorVersion] = useState(0);
  const [provider,setProvider] = useState('auto');
  const [confirmed,setConfirmed] = useState(false);
  const editor = useRef<LocalImageEditorHandle>(null);
  const intake = useRef<HTMLElement>(null);
  const activeSource = active?.kind === 'source' ? workspace.sources.find((s)=>s.id===active.id) : workspace.drafts.find((s)=>s.id===active?.id);
  const url = useBlobUrl(activeSource?.blob);
  const unavailable = disabled || busy || !loaded;
  const providers = controller.providerOptions({mode:'asset',inputType:'image'});
  const runnable = workspace.drafts.filter((d)=>d.selected && d.approved && d.status!=='done');

  useEffect(() => {
    alive.current = true;
    void (async()=>{
      try {
        const db = await openImageDraftStore();
        if (!alive.current) { db.close(); return; }
        store.current = db;
        const saved = await db.read() as Workspace | undefined;
        if (!alive.current) return;
        const next = saved ? {...saved, drafts:saved.drafts.map(restoredDraft)} : empty();
        latest.current = next; setWorkspace(next); setLoaded(true);
        for (const draft of next.drafts) if (draft.result) onOutput(draft.result);
      } catch(error) { if (alive.current) setNotice(`无法打开本地草稿库：${message(error)}。请允许浏览器存储后重试。`); }
    })();
    return () => { alive.current=false; stop.current=true; void writes.current.finally(()=>store.current?.close()); };
  }, []);

  const commit = (change:(current:Workspace)=>Workspace):Promise<void> => {
    const task = writes.current.then(async()=>{
      const next = change(latest.current);
      if (next.sources.length>40 || next.drafts.length>120) throw new Error('最多保存 40 张原图和 120 个物体，请先移除不需要的项目');
      const bytes = [...next.sources,...next.drafts].reduce((sum,item)=>sum+item.blob.size,0);
      if (bytes > 256*1024*1024) throw new Error('草稿总量超过 256 MiB，请先移除不需要的项目');
      await store.current.write(next);
      latest.current = next;
      if (alive.current) setWorkspace(next);
    });
    writes.current = task.catch(()=>{});
    return task;
  };
  const update = (id:string, patch:Partial<Draft>) => commit((w)=>({...w,drafts:w.drafts.map((d)=>d.id===id?{...d,...patch}:d)}));
  const safe = (action:()=>Promise<unknown>) => { void action().catch((error)=>setNotice(message(error))); };
  const lock = (value:boolean) => { locked.current=value; setBusy(value); onBusy(value); };
  const choose = (item:Source, kind:'source'|'draft') => {
    setActive({kind,id:item.id}); setName(item.name.replace(/\.[^.]+$/, '')); setEditorVersion((n)=>n+1);
  };

  const ingest = async (files:File[]) => {
    if (locked.current || disabled || !loaded || !files.length) return;
    lock(true); setNotice('');
    const errors:string[]=[];
    try {
      for (const file of files) {
        try {
          const source = await readSource(file);
          await commit((w)=>({...w,sources:[...w.sources,source]}));
          choose(source,'source');
        } catch(error) { errors.push(`${file.name || '图片'}：${message(error)}`); }
      }
      setNotice(errors.length ? errors.join('；') : '原图已保存在本机。可以整图添加，也可以框选物体后保存。');
    } finally { lock(false); }
  };
  useEffect(() => {
    const paste = (event:ClipboardEvent) => {
      if (!visible || unavailable || !intake.current?.getClientRects().length) return;
      const files = Array.from(event.clipboardData?.items || []).filter((item)=>item.kind==='file'&&item.type.startsWith('image/')).map((item)=>item.getAsFile()).filter((file):file is File=>!!file);
      if (files.length) { event.preventDefault(); void ingest(files); }
    };
    document.addEventListener('paste',paste);
    return ()=>document.removeEventListener('paste',paste);
  });

  const saveObject = async () => {
    if (!activeSource || !editor.current || locked.current || !name.trim()) return;
    lock(true);
    try {
      const result = await editor.current.exportPng();
      const blob = new Blob([result.bytes as BlobPart],{type:'image/png'});
      if (active?.kind==='draft') {
        const previous = activeSource as Draft;
        if (previous.jobId || previous.result) throw new Error('已提交的物体不能覆盖，请从原图创建新物体');
        await update(previous.id,{blob,name:name.trim(),width:result.width,height:result.height,crop:{...result.crop,x:previous.crop.x+result.crop.x,y:previous.crop.y+result.crop.y},approved:false,status:'draft',imageResult:undefined,error:undefined});
      } else {
        const draft = newDraft(activeSource,blob,result.crop,name.trim());
        await commit((w)=>({...w,drafts:[...w.drafts,draft]}));
      }
      setActive(null);
      setNotice('物体已保存。确认预览后勾选生成；也可再次打开原图提取其他物体。');
    } finally { lock(false); }
  };

  const propose = async () => {
    if (!activeSource || active?.kind!=='source' || locked.current) return;
    lock(true); setNotice('正在本地分离前景区域…');
    const bitmap = await createImageBitmap(activeSource.blob).catch((error)=>{lock(false);throw error;});
    try {
      const scale = Math.min(1,512/Math.max(bitmap.width,bitmap.height));
      const sample = document.createElement('canvas'); sample.width=Math.max(1,Math.round(bitmap.width*scale)); sample.height=Math.max(1,Math.round(bitmap.height*scale));
      const ctx=sample.getContext('2d')!; ctx.drawImage(bitmap,0,0,sample.width,sample.height);
      const regions = findForegroundRegions(ctx.getImageData(0,0,sample.width,sample.height).data,sample.width,sample.height,{minArea:Math.max(24,Math.floor(sample.width*sample.height*.001))});
      if (!regions.length) throw new Error('没有找到可分离区域，请手工框选物体');
      const drafts:Draft[]=[];
      for (const [index,region] of regions.entries()) {
        const mask=ctx.createImageData(sample.width,sample.height);
        for (const pixel of region.pixels) mask.data[pixel*4+3]=255;
        ctx.putImageData(mask,0,0);
        const crop={x:Math.floor(region.x*bitmap.width/sample.width),y:Math.floor(region.y*bitmap.height/sample.height),width:0,height:0};
        crop.width=Math.ceil((region.x+region.width)*bitmap.width/sample.width)-crop.x;
        crop.height=Math.ceil((region.y+region.height)*bitmap.height/sample.height)-crop.y;
        const canvas=document.createElement('canvas'); canvas.width=crop.width; canvas.height=crop.height;
        const out=canvas.getContext('2d')!;
        out.drawImage(bitmap,-crop.x,-crop.y); out.globalCompositeOperation='destination-in';
        out.drawImage(sample,0,0,sample.width,sample.height,-crop.x,-crop.y,bitmap.width,bitmap.height);
        drafts.push(newDraft(activeSource,await pngBlob(canvas),crop,`${activeSource.name.replace(/\.[^.]+$/,'')} · 物体 ${index+1}`));
      }
      await commit((w)=>({...w,drafts:[...w.drafts,...drafts]}));
      setNotice(`已提出 ${drafts.length} 个区域。请检查、命名并确认；相互接触的物体可能合并，复杂背景请手工处理。`);
    } finally { bitmap.close(); lock(false); }
  };

  const generate = async () => {
    if (locked.current || disabled || !paired || !confirmed || !runnable.length || !providers.length) return;
    lock(true); stop.current=false; setStopping(false); setConfirmed(false); setNotice('按顺序生成，单项失败后继续处理下一项。');
    try {
      await runImageObjectQueue({drafts:runnable,update,shouldStop:()=>stop.current,process:async(draft:Draft)=>{
        const providerId = Object.hasOwn(draft,'provider') ? draft.provider : provider==='auto'?null:provider;
        await update(draft.id,{status:draft.jobId?'generating':'uploading',error:undefined,provider:providerId});
        let input=draft.imageResult;
        if (!draft.jobId && !input) {
          input=await controller.approveLocalImage({bytes:new Uint8Array(await draft.blob.arrayBuffer()),prompt:draft.name});
          await update(draft.id,{imageResult:input,status:'generating'}); onOutput(input);
        }
        const result=await controller.generateAssetFromImage({imageResult:input,assetId:draft.assetId,provider:providerId,resumeJobId:draft.jobId||null,idempotencyKey:`image-object-${draft.assetId}`,onProgress:async(job:any)=>{
          if (job.jobId && latest.current.drafts.find((d)=>d.id===draft.id)?.jobId!==job.jobId) await update(draft.id,{jobId:job.jobId,status:'generating'});
        }});
        await update(draft.id,{status:'done',result,error:undefined}); onOutput(result);
      }});
      setNotice(stop.current?'队列已停止，尚未开始的物体仍可继续。':'本轮处理结束。成功资产已入库，失败项可查询任务或重新生成。');
    } finally { lock(false); setStopping(false); }
  };

  return <section ref={intake} className="image-object-workbench" hidden={!visible} aria-label="图片资产工作台">
    <div className="image-intake-drop" onDragOver={(event)=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={(event)=>{event.preventDefault();event.stopPropagation();void ingest(Array.from(event.dataTransfer.files));}}>
      <strong>把图片变成场景里的物体</strong>
      <p>拖入图片，或在此页面粘贴截图。支持一次选择多张 PNG / JPEG / WebP。</p>
      <label className="build-local-image-file">选择图片<input id="build-local-image-file" type="file" multiple accept="image/png,image/jpeg,image/webp" disabled={unavailable} onChange={(event)=>{const files=Array.from(event.target.files||[]);event.currentTarget.value='';void ingest(files);}} /></label>
      <small>原图和草稿保存在此浏览器；开始生成时才上传所选物体。</small>
    </div>
    <div className="image-object-heading"><strong>原图 · {workspace.sources.length}</strong><button type="button" disabled={unavailable || !workspace.sources.length} onClick={()=>safe(()=>commit((w)=>({...w,drafts:[...w.drafts,...w.sources.filter((s)=>!w.drafts.some((d)=>d.sourceId===s.id)).map((s)=>newDraft(s))]})))}>每张原图添加一个物体</button></div>
    <div className="image-source-list">{workspace.sources.map((source)=><div className="image-source-card" key={source.id} data-active={active?.id===source.id}>
      <button type="button" disabled={unavailable} onClick={()=>choose(source,'source')}><Thumbnail source={source}/><span>{source.name}</span></button>
      <button type="button" disabled={unavailable || workspace.drafts.some((d)=>d.sourceId===source.id)} title="先移除此原图的物体草稿，再移除原图" onClick={()=>safe(async()=>{await commit((w)=>({...w,sources:w.sources.filter((s)=>s.id!==source.id)}));if(active?.id===source.id)setActive(null);})}>移除原图</button>
    </div>)}</div>
    {activeSource && url ? <div className="image-object-edit">
      <label>物体名称<input aria-label="物体名称" value={name} disabled={unavailable} onChange={(event)=>setName(event.target.value)} placeholder="例如：红色杯子"/></label>
      <LocalImageEditor key={`${activeSource.id}:${editorVersion}:${url}`} ref={editor} sourceUrl={url} sourceWidth={activeSource.width} sourceHeight={activeSource.height} disabled={unavailable}/>
      <div className="build-local-image-actions">
        <button id="build-save-object" type="button" disabled={unavailable || !name.trim()} onClick={()=>safe(saveObject)}>{active?.kind==='draft'?'保存修改，重新确认':'保存为物体草稿'}</button>
        {active?.kind==='source'?<button type="button" disabled={unavailable} onClick={()=>safe(propose)}>自动候选（纯色 / 透明背景）</button>:null}
        <button type="button" disabled={unavailable} onClick={()=>setActive(null)}>关闭编辑</button>
      </div>
      <small>本地候选只分离前景区域，不识别类别；复杂照片请框选并用画笔修边。</small>
    </div>:null}
    <div className="image-object-heading"><strong>物体 · {workspace.drafts.length}</strong><span>先检查图片和名称，再确认生成输入</span></div>
    <div className="image-object-list">{workspace.drafts.map((draft)=><article key={draft.id} className="image-object-card" data-status={draft.status}>
      <Thumbnail source={draft}/>
      <div className="image-object-details">
        <label><input type="checkbox" aria-label={`选择 ${draft.name}`} disabled={unavailable||draft.status==='done'} checked={draft.selected} onChange={(event)=>safe(()=>update(draft.id,{selected:event.target.checked}))}/>{draft.name}</label>
        <small>{draft.width} × {draft.height} · {labels[draft.status]||draft.status}</small>
        <small>来自：{workspace.sources.find((s)=>s.id===draft.sourceId)?.name}</small>
        {draft.error?<p role="alert">{draft.error}</p>:null}
        {draft.result?.status==='asset-provisional'?<small>可放置；交互能力仍需在场景中验证。</small>:null}
        <div className="build-local-image-actions">
          {!draft.jobId && !draft.result?<>
            <button type="button" disabled={unavailable} onClick={()=>choose(draft,'draft')}>编辑</button>
            <button type="button" disabled={unavailable||draft.approved} onClick={()=>safe(()=>update(draft.id,{approved:true,status:'ready'}))}>{draft.approved?'已确认':'确认此物体'}</button>
          </>:null}
          {draft.status==='done'?<button type="button" disabled={unavailable} onClick={()=>safe(async()=>{await controller.placeAsset(draft.result.assetId);setNotice(`${draft.name} 已加入当前世界，可在资产栏执行 Agent 验证。`);})}>加入当前世界</button>:null}
          {draft.jobId && ['failed','interrupted'].includes(draft.status)?<button type="button" disabled={unavailable} onClick={()=>safe(async()=>{const job=await controller.getImageAssetJob(draft.jobId);if(!['generation-failed','generation-cancelled','generation-expired'].includes(job.status))throw new Error('原任务尚未确认失败，勾选后开始生成将继续查询，不会重复提交');await update(draft.id,{jobId:undefined,imageResult:undefined,assetId:`generated_${crypto.randomUUID()}`,status:'ready',error:undefined});})}>确认失败后重建</button>:null}
          <button type="button" disabled={unavailable} onClick={()=>safe(async()=>{await commit((w)=>({...w,drafts:w.drafts.filter((d)=>d.id!==draft.id)}));if(active?.id===draft.id)setActive(null);})}>移除草稿</button>
        </div>
      </div>
    </article>)}</div>
    <div className="image-object-queue">
      <label>3D 生成器<select aria-label="批量 3D 生成器" value={provider} disabled={unavailable} onChange={(event)=>setProvider(event.target.value)}><option value="auto">自动选择</option>{providers.map((p:any)=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      {!paired?<button type="button" disabled={unavailable} onClick={onConnect}>连接生成器</button>:null}
      {paired&&!providers.length?<small>尚无可用的图生 3D 能力；可以继续准备草稿。</small>:null}
      <label><input type="checkbox" checked={confirmed} disabled={unavailable} onChange={(event)=>setConfirmed(event.target.checked)}/>允许本批所选物体使用外部 3D 生成资源</label>
      <div className="build-local-image-actions"><button id="build-generate-objects" type="button" disabled={unavailable||!paired||!confirmed||!runnable.length||!providers.length} onClick={()=>safe(generate)}>生成 / 继续所选 {runnable.length} 个物体</button>
      {busy?<button type="button" disabled={stopping} onClick={()=>{stop.current=true;setStopping(true);setNotice('将在当前任务完成后停止，不再提交下一项。');}}>{stopping?'等待当前项结束…':'当前项完成后停止'}</button>:null}</div>
      <small>草稿刷新后保留。中断任务继续时查询原任务；移除草稿不会删除已生成资产或取消云端任务。</small>
    </div>
    {notice?<p className="image-object-notice" role="status">{notice}</p>:null}
  </section>;
}
