import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AffordanceActionPanel } from '../inspect/AffordanceActionPanel';
import { CodeWorldNavigation } from './CodeWorldNavigation';
import { StudioIcon } from '../shared/StudioIcon';
import './CodeProjectWorkbench.css';
import { formFieldsForAction, initialActionFieldValues, actionArgumentsFromFields } from './ProjectActionArguments.js';
import { ProjectBatchReview } from './ProjectBatchReview.js';
import { subscribeSceneRefresh } from '../../scene/SceneRefreshScheduler.js';

export const emptyCodeState = Object.freeze({ visible:false, active:false });
export const emptyCodeSubscribe = () => () => {};
export const emptyCodeSnapshot = () => emptyCodeState;

async function resourceBase64(file:File) {
  if (file.size > 8 * 1024 * 1024) throw new Error('单个资源文件最大 8 MiB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}

export function CodeProjectEditor({ controller }: { controller:any }) {
  const state:any = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const project:any = state.project;
  const entry = project?.entry || 'main.js';
  const files:Record<string,string> = project ? {[entry]:project.source,...(project.files || {})} : {};
  const paths = Object.keys(files).sort((a,b)=>a===entry?-1:b===entry?1:a.localeCompare(b));
  const [activeFile,setActiveFile] = useState('main.js');
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [newFile, setNewFile] = useState('');
  const [newPath, setNewPath] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [resourceDelete, setResourceDelete] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [publishToken,setPublishToken]=useState('');
  const [working, setWorking] = useState(false);
  const projectInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const resourceInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dirty) return;
    const path = Object.hasOwn(files,activeFile) ? activeFile : entry;
    if (path !== activeFile) setActiveFile(path);
    setSource(files[path] || '');
    setName(project?.name || '');
    setRevision(state.revision);
  }, [state.project,state.revision,activeFile,dirty]);

  const run = async (operation:()=>Promise<any>,success:string) => {
    setWorking(true);setError('');setMessage('');
    try { await operation();setMessage(success); }
    catch(cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  };
  const apply = async () => {
    if (!dirty) return state.revision;
    const saved = activeFile === entry
      ? await controller.write({source,name,expectedRevision:revision})
      : await controller.editFile({action:'write',path:activeFile,content:source,name,expectedRevision:revision});
    setDirty(false);
    return saved.revision;
  };
  const editFile = async (action:string, opts:Record<string,unknown>={}) => {
    await apply();
    return controller.editFile({action,path:activeFile,expectedRevision:controller.snapshot().revision,...opts});
  };
  const switchFile = (path:string) => void run(async()=>{
    await apply();setActiveFile(path);setNewPath('');setDeleteArmed(false);
  },'');
  const busy = state.busy || working;
  const conflict=dirty && revision!==state.revision;
  const canRun=Boolean(project) && !busy && !conflict && (!state.approvalRequired || (!dirty && state.approval?.revision===state.revision));
  const canSave=Boolean(project) && !busy && !dirty && state.active && state.revision===state.runningRevision;
  const runWorld=()=>void run(async()=>{const expectedRevision=await apply();await controller.run({expectedRevision});},'代码世界运行中');
  const statusLabel=busy?'正在处理':conflict?'版本冲突':dirty?'未保存编辑':!state.active?'尚未运行':state.runningRevision!==state.revision?'等待重新运行':state.playback?.paused?'已暂停':'运行中';
  const statusTone=conflict?'error':dirty||busy||(state.active&&state.runningRevision!==state.revision)?'pending':state.active?'ready':'idle';
  const errorText=error||state.error;
  return <div className="code-project-editor" aria-label="完整代码项目">
    <header className="code-project-commandbar">
      <div className="code-project-heading"><div><h2>代码世界</h2><p>{project?.name || '创建或打开 Three.js 项目'}</p></div><span className="code-project-state" data-tone={statusTone}>{statusLabel}</span></div>
      {project ? <>
        <div className="code-project-primary-actions">
          <button className="code-project-run" disabled={!canRun} onClick={runWorld}><StudioIcon name="arrow" size={15}/>运行代码世界</button>
          <button disabled={busy || !dirty || conflict} onClick={()=>void run(apply,'源码草稿已保存')}>保存源码草稿</button>
          <button disabled={!canSave} onClick={()=>void run(()=>controller.save(),'世界状态已保存到本机')}>保存世界状态</button>
        </div>
        {state.approvalRequired ? <button disabled={busy || conflict || (!dirty && state.approval?.revision===state.revision)} onClick={()=>void run(async()=>{await apply();await controller.approveCurrentRevision();},'已批准当前源码版本，请点击运行')}>审阅后批准本版本</button> : null}
        {!state.active ? <small className="code-project-trust-note">仅运行可信来源的代码 · 在当前浏览器执行</small> : null}
        <div className="code-project-revisions"><span>草稿 r{state.revision}</span><span>{state.active?'运行 r'+state.runningRevision:'尚未运行'}</span><span>{dirty?'未保存':'源码已保存'}</span></div>
        {conflict ? <p role="alert">AI 已更新项目。请复制保留本地编辑，再载入最新版本。</p> : null}
        {dirty ? <button className="code-project-discard" disabled={busy} onClick={()=>setDirty(false)}>放弃编辑并载入最新源码</button> : null}
      </> : null}
      <output role="status">{message}</output>
      {errorText ? <p role="alert" className="code-project-error">{errorText}</p> : null}
    </header>
    <div className="code-project-body">
    <details className="code-project-section" open={!state.active}>
    <summary><StudioIcon name="folder" size={15}/>项目管理</summary>
    <div className="code-project-section-content">
    <div className="code-project-buttons">
      <button disabled={busy || state.active || dirty} onClick={()=>void run(()=>controller.write({create:true}), '已创建草稿')}>新建代码世界</button>
      <button disabled={busy || state.active || dirty} onClick={()=>projectInput.current?.click()}>导入代码项目</button>
    </div>
    <label>本机项目<select aria-label="本机代码项目" value={selected} onChange={e=>setSelected(e.target.value)}>
      <option value="">选择已保存项目</option>
      {state.projects.map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <button disabled={busy || state.active || dirty || !selected} onClick={()=>void run(()=>controller.load(selected), '项目已打开，点击运行')}>打开代码项目</button>
    </div></details>
    {!project ? <div className="code-project-empty"><StudioIcon name="cube" size={28}/><strong>开始创作</strong><p>新建项目后即可修改模板并运行，或打开已保存的世界继续编辑。</p><small>代码在本机浏览器执行，运行前请确认来源可信。</small></div> : null}
    {project ? <>
      <label>项目名称<input aria-label="代码项目名称" value={name} disabled={busy}
        onChange={e=>{setName(e.target.value);setDirty(true);}} /></label>
      <ProjectBatchReview controller={controller} preview={state.batchPreview || null} undo={state.undoBatch || null}
        revision={state.revision} busy={busy} dirty={dirty} onRun={run} />
      <div className="code-project-files" aria-label="项目文件列表">
        <strong>工程文件 <small>{paths.length} 个</small></strong>
        {paths.map(path=><button key={path} type="button" className={activeFile===path?'selected':''}
          aria-current={activeFile===path?'page':undefined} disabled={busy} onClick={()=>switchFile(path)}>
          <span>{path}</span>{path===entry?<small>入口</small>:null}
        </button>)}
      </div>
      <details className="code-project-section code-project-file-management"><summary><StudioIcon name="plus" size={15}/>管理工程文件</summary><div className="code-project-section-content">
      <div className="code-project-file-tools">
        <label>新增文件路径<input aria-label="新增文件路径" placeholder="src/helper.js 或 shaders/effect.glsl"
          value={newFile} disabled={busy} onChange={e=>setNewFile(e.target.value)} /></label>
        <div className="code-project-buttons">
          <button disabled={busy || !newFile.trim()} onClick={()=>void run(async()=>{
            await apply();const path=newFile.trim();
            await controller.editFile({action:'create',path,content:'',expectedRevision:controller.snapshot().revision});
            setActiveFile(path);setNewFile('');
          },'已创建新文件')}>新增文件</button>
          <button disabled={busy} onClick={()=>codeInput.current?.click()}>导入代码文件</button>
        </div>
      </div>
      <div className="code-project-file-tools">
        <label>文件新路径<input aria-label="重命名文件路径" placeholder="例如 src/renamed.js" value={newPath}
          disabled={busy} onChange={e=>setNewPath(e.target.value)} /></label>
        <div className="code-project-buttons">
          <button disabled={busy || !newPath.trim()} onClick={()=>void run(async()=>{
            const path=newPath.trim();await editFile('rename',{newPath:path});
            setActiveFile(path);setNewPath('');setDeleteArmed(false);
          },'文件已重命名')}>重命名文件</button>
          <button disabled={busy || activeFile===entry} onClick={()=> {
            if (!deleteArmed) {setDeleteArmed(true);return;}
            void run(async()=>{await editFile('delete');setActiveFile(entry);setDeleteArmed(false);},'文件已删除');
          }}>{deleteArmed?'确认删除文件':'删除文件'}</button>
        </div>
      </div>
      </div></details>
      <label className="code-source-label"><span className="code-source-title">{activeFile===entry?'世界源码':'文件内容 · '+activeFile}<small>{source.split('\n').length} 行</small></span>
        <textarea aria-label={activeFile===entry?'世界源码':'文件内容 '+activeFile} spellCheck={false}
          value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setDirty(true);}}
          onKeyDown={event=>{if(!(event.ctrlKey||event.metaKey))return;if(event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();if(!busy&&dirty&&!conflict)void run(apply,'源码草稿已保存');}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(canRun)runWorld();}}} />
        <small className="code-source-shortcuts">Ctrl / ⌘ + S 保存 · Ctrl / ⌘ + Enter 运行</small>
      </label>
      <details className="code-project-section"><summary><StudioIcon name="image" size={15}/>资源文件 <small>{Object.keys(project.resources || {}).length} 个</small></summary><div className="code-project-section-content">
      <div className="code-project-resources">
        <strong>资源文件 <small>{Object.keys(project.resources || {}).length} 个</small></strong>
        {Object.entries(project.resources || {}).map(([path,value]:[string,any])=><div key={path}>
          <span>{path} <small>{value.mime}</small></span>
          <button disabled={busy} onClick={()=>{
            if (resourceDelete !== path) {setResourceDelete(path);return;}
            void run(async()=>{await apply();await controller.editResource({action:'delete',path,expectedRevision:controller.snapshot().revision});setResourceDelete('');},'资源已删除');
          }}>{resourceDelete===path?'确认删除':'删除'}</button>
        </div>)}
        <button disabled={busy} onClick={()=>resourceInput.current?.click()}>导入图片或资源</button>
      </div>
      </div></details>
      <details className="code-project-section"><summary><StudioIcon name="settings" size={15}/>时间控制与导出</summary><div className="code-project-section-content">
      <div className="code-project-buttons">
        <button disabled={!canSave}
          onClick={()=>void run(async()=>{
            const saved=await controller.save();
            const url=URL.createObjectURL(new Blob([JSON.stringify(saved.value)],{type:'application/json'}));
            const link=document.createElement('a');link.href=url;link.download=saved.value.id+'.json';link.click();
            setTimeout(()=>URL.revokeObjectURL(url),1000);
          },'完整代码项目已导出')}>导出代码项目</button>
      </div>
      {state.active&&state.playback ? <div className="code-project-file-tools" aria-label="项目时间控制">
        <strong>{state.playback.paused?'世界已暂停':'世界时间运行中'}</strong>
        <div className="code-project-buttons">
          <button type="button" disabled={busy||state.revision!==state.runningRevision}
            onClick={()=>void run(()=>controller.timeline({expectedRevision:state.revision,expectedRuntimeId:state.runtimeId,
              command:state.playback.paused?'resume':'pause'}),state.playback.paused?'世界时间已恢复':'世界时间已暂停')}>
            {state.playback.paused?'恢复世界时间':'暂停世界时间'}
          </button>
          <button type="button" disabled={busy||!state.playback.paused||state.revision!==state.runningRevision}
            onClick={()=>void run(()=>controller.timeline({expectedRevision:state.revision,expectedRuntimeId:state.runtimeId,command:'step',steps:1}),'已推进一个固定时间步')}>单步推进</button>
        </div>
        {state.playback.paused?<small>项目时间 {Number(state.playback.elapsedSeconds).toFixed(3)} 秒 · 仿真 tick {state.playback.simulation.tick}。恢复时间后再执行动态动作。</small>:null}
      </div>:null}
      </div></details>
      <details className="code-project-section"><summary>共享世界发布</summary><div className="code-project-section-content">
      <div className="code-project-file-tools" aria-label="共享世界发布">
        <label>共享发布授权令牌<input type="password" aria-label="共享发布授权令牌"
          placeholder="由服务端管理员配置，不会写入世界源码"
          value={publishToken} onChange={event=>setPublishToken(event.target.value)} autoComplete="off" /></label>
        <button type="button" disabled={busy || !publishToken.trim() || dirty ||
            !state.active || state.revision!==state.runningRevision}
          onClick={()=>void run(()=>controller.publishShared({token:publishToken}),
            '代码、资源和可视化编辑已发布至共享 WorldRepository')}>
          发布 / 更新共享世界
        </button>
        {project?.id ? <a href={'/studio/?page=worlds&collection=shared&history='+encodeURIComponent(project.id)}
          target="_blank" rel="noopener noreferrer">在新标签页查看共享版本历史</a> : null}
        <small>发布明确向所有能访问此 Studio 服务器的浏览器提供源码与场景数据。
          更新必须持有之前的共享版本号；版本冲突时不会覆盖其他浏览器的修改。
          不会把发布令牌保存到项目或本地存储。共享来源的 JavaScript 需要手动运行。</small>
      </div>
      </div></details>
      <details className="code-project-section"><summary>执行安全与开发说明</summary><div className="code-project-section-content">
      <p className="code-project-note">安全提示：完整 JavaScript 在当前浏览器上下文执行，不是安全沙箱。默认可直接运行，包括 AI 提交的代码；请只连接可信的模型和项目。{state.approvalRequired ? (state.approval?.revision===state.revision ? ' 审批策略已启用 · 已批准 SHA-256 '+state.approval.digest : ' 审批策略已启用 · 当前版本尚未批准') : ' 未启用审批策略。'}</p>
      <p className="code-project-note">JS 可以使用相对 import；Shader/WGSL/TXT 作为文本导入，JSON 作为对象导入。图片使用 resource('文件名')。npm 依赖仍需预打包。</p>
      </div></details>
    </> : null}
    </div>
    <footer className="code-project-footer"><button disabled={busy || dirty} onClick={()=>void run(()=>controller.close(),'已返回内置世界')}>保存并返回内置世界</button></footer>
    <input hidden ref={projectInput} type="file" accept=".json,application/json" onChange={event=>{
      const input=event.target.files?.[0];event.target.value='';
      if(input) void run(async()=>controller.write({create:true,project:JSON.parse(await input.text())}),'代码项目已导入，点击运行');
    }} />
    <input hidden ref={codeInput} type="file" multiple accept=".js,.mjs,.glsl,.vert,.frag,.wgsl,.json,.txt" onChange={event=>{
      const inputs=[...(event.target.files || [])];event.target.value='';
      if(inputs.length) void run(async()=>{
        await apply();
        const operations=await Promise.all(inputs.map(async input=>({
          kind:'file',action:'create',path:input.webkitRelativePath || input.name,content:await input.text()
        })));
        await controller.commitBatch({operations,expectedRevision:controller.snapshot().revision});
        setActiveFile(inputs[inputs.length-1].webkitRelativePath || inputs[inputs.length-1].name);
      },'代码文件已导入');
    }} />
    <input hidden ref={resourceInput} type="file" multiple disabled={busy} onChange={event=>{
      const inputs=[...(event.target.files || [])];event.target.value='';
      if(inputs.length) void run(async()=>{
        await apply();
        const operations=await Promise.all(inputs.map(async input=>({
          kind:'resource',action:'add',path:input.name,mime:input.type || 'application/octet-stream',
          base64:await resourceBase64(input)
        })));
        await controller.commitBatch({operations,expectedRevision:controller.snapshot().revision});
      },'资源文件已导入');
    }} />
  </div>;
}

function ProjectAction({ controller, entity, action, refresh, disabled }:any) {
  const fields = formFieldsForAction(action.parameters);
  const [values, setValues] = useState<Record<string,string>>(() => initialActionFieldValues(fields || []));
  const [rawArgs, setRawArgs] = useState('{}');
  const [advanced, setAdvanced] = useState(false);
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string|null>(null);
  const activeScene=useRef<any>(null);
  const invoke = async () => {
    setBusy(true); setResult(''); setStatus('正在执行');
    try {
      const args = fields && !advanced ? actionArgumentsFromFields(fields,values) : JSON.parse(rawArgs);
      const api = controller.session.scene;
      activeScene.current=api;
      const job = api.interact({action:'invoke',target:entity.id,name:action.name,source:action.source,partName:action.partName,args});
      setJobId(job.id);
      const terminal = await api.waitJob(job.id);
      setResult(JSON.stringify(terminal.result,null,2));
      setStatus(terminal.status==='succeeded'
        ? terminal.result?.verification?.status==='verified' ? '已验证' : '已执行（未验证）'
        : terminal.status==='cancelled' ? '已取消' : '执行失败');
      if(controller.session?.scene===api)refresh();
    } catch(error) {
      setStatus('执行失败'); setResult(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); setJobId(null); }
  };
  const useJson = !fields || advanced;
  return <details className="code-project-action">
    <summary>{action.name} · {action.verification==='project-defined'?'项目验证':'未配置验证'}</summary>
    {action.description ? <p>{action.description}</p> : null}
    {!useJson ? <div className="code-project-action-fields">
      {fields.length===0 ? <small>无需填写参数</small> : fields.map(field=><label key={field.name}>
        <span>动作参数 {field.name}{field.required ? ' *' : ''}</span>
        {field.values || field.type==='boolean'
          ? <select aria-label={'动作参数 '+field.name} value={values[field.name] ?? ''}
              onChange={event=>setValues(current=>({...current,[field.name]:event.target.value}))}>
              <option value="">请选择</option>
              {(field.values || [true,false]).map((value:any)=><option key={String(value)} value={String(value)}>{String(value)}</option>)}
            </select>
          : <input aria-label={'动作参数 '+field.name} type={field.type==='number'||field.type==='integer'?'number':'text'}
              step={field.type==='integer'?'1':'any'} min={field.minimum} max={field.maximum}
              value={values[field.name] ?? ''}
              onChange={event=>setValues(current=>({...current,[field.name]:event.target.value}))} />}
        {field.description ? <small>{field.description}</small> : null}
      </label>)}
    </div> : <label>动作参数 JSON
      <textarea aria-label={entity.id+'.'+action.name+' 参数'} value={rawArgs} onChange={event=>setRawArgs(event.target.value)} />
    </label>}
    <div className="code-project-action-buttons">
      {fields ? <button type="button" disabled={busy} onClick={()=>{
        if (!advanced) {
          try { setRawArgs(JSON.stringify(actionArgumentsFromFields(fields,values),null,2)); } catch { setRawArgs('{}'); }
        }
        setAdvanced(!advanced);
      }}>{advanced?'返回参数表单':'高级 JSON'}</button> : <small>复杂参数请使用 JSON</small>}
      <button type="button" disabled={busy || disabled || !action.available} onClick={()=>void invoke()}>执行 {action.name}</button>
      {jobId ? <button type="button" onClick={()=>{
        try { activeScene.current?.cancelJob(jobId); setStatus('正在取消'); }
        catch(error) { setResult(error instanceof Error ? error.message : String(error)); }
      }}>取消执行</button> : null}
    </div>
    {status ? <output role="status">{status}</output> : null}
    {result ? <details className="code-project-action-result"><summary>执行详情</summary><pre>{result}</pre></details> : null}
  </details>;
}

type TargetSummary={id:string;label:string;source:string};
const targetSummaries=(view:any):TargetSummary[]=>{
  const entries=new Map<string,TargetSummary>();
  for(const item of view.project?.entities||[])entries.set(item.id,{id:item.id,label:item.label||item.id,source:item.physics?'原生物理':'项目'});
  for(const item of view.objects||[])entries.set(item.id,{id:item.id,label:item.label||item.id,source:'托管资产'});
  for(const item of view.nativeEditables?.objects||[])if(!entries.has(item.id))entries.set(item.id,{id:item.id,label:item.label||item.id,source:'可编辑对象'});
  return [...entries.values()];
};
const positionText=(position:any)=>Array.isArray(position)?position.map((n:number)=>Number(n.toFixed(3))).join(', '):'—';
function PhysicsSummary({inspection}:{inspection:any}){
  const physics=inspection?.physics;
  if(!physics)return null;
  const state=physics.state||physics;
  const body=physics.currentBody||state.body||'—';
  const position=physics.position||inspection.position;
  return <section className="code-world-physics" aria-label="实时物理状态">
    <div className="code-world-section-title"><h4>实时物理状态</h4><span>{state.registered?'已注册':'未注册'}</span></div>
    <dl>
      <dt>刚体</dt><dd>{body}</dd>
      <dt>质量</dt><dd>{state.mass==null?'—':Number(state.mass.toFixed(3))+' kg'}</dd>
      <dt>碰撞体</dt><dd>{state.colliderCount??0}</dd>
      <dt>世界位置</dt><dd>{positionText(position)}</dd>
      {state.heldById?<><dt>持有者</dt><dd>{state.heldById}</dd></>:null}
    </dl>
    {(physics.joints||[]).map((joint:any)=><div key={joint.partName} className="code-world-joint">
      <strong>{joint.partName} <small>{joint.type==='revolute'?'旋转':'滑动'}</small></strong>
      <div>当前位置 <b>{joint.coordinate==null?'—':Number(joint.coordinate.toFixed(3))}</b> {joint.type==='revolute'?'rad':'m'}</div>
      <small>限位 {joint.limits?.join(' ～ ')} · 马达目标 {joint.motorTarget==null?'—':Number(joint.motorTarget.toFixed(3))}</small>
    </div>)}
    <small>来自真实物理状态；观察本身不构成动作成功证明。</small>
  </section>;
}

export function CodeProjectActions({controller,selected,onSelect}:{controller:any;selected:string;onSelect:(id:string)=>void}){
  const state:any=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const session=controller.session;
  const [targets,setTargets]=useState<TargetSummary[]>([]);
  const [inspection,setInspection]=useState<any>(null);
  const [actors,setActors]=useState<{agents:{id:string}[];selected:string|null}>({agents:[],selected:null});
  const [history,setHistory]=useState({canUndo:false,canRedo:false,undo:0,redo:0});
  const [error,setError]=useState('');
  const [historyBusy,setHistoryBusy]=useState(false);
  const [historyFeedback,setHistoryFeedback]=useState('');
  const commands=controller.interactionCommands;
  const target=targets.find(item=>item.id===selected)||null;
  const actor=actors.selected;
  const refresh=()=>{
    if(!session||controller.session!==session)return;
    try{
      const view=session.scene.observe();
      setTargets(targetSummaries(view));setActors(view.actors);setHistory(view.history);setError('');
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
  };
  useEffect(()=>{
    setTargets([]);setInspection(null);setActors({agents:[],selected:null});setHistory({canUndo:false,canRedo:false,undo:0,redo:0});setHistoryFeedback('');
    if(!session)return;
    refresh();
    const stop=subscribeSceneRefresh(session.world.events,[
      'entity.registered','entity.removed','entity.phase-changed','object.spawned','object.removed',
      'native.edit.registered','native.edit.unregistered','project.action.completed','project.machine.changed',
      'scene.actor.selected','history.changed','scene.restored','locomotion.arrived','locomotion.blocked','studio.scene.action.changed'
    ],refresh);
    return stop;
  },[session,commands]);
  useEffect(()=>{
    if(targets.length&&!targets.some(item=>item.id===selected))onSelect(targets[0].id);
  },[targets,selected,onSelect]);
  useEffect(()=>{
    setInspection(null);
    if(!session||!selected)return;
    let active=true;
    const sample=()=>{
      if(!active||controller.session!==session)return;
      try{setInspection(session.scene.inspect(selected,actor?{actor}:{}));}
      catch{setInspection(null);}
    };
    sample();
    // Only the selected entity is sampled, not the complete project graph.
    const timer=setInterval(sample,500);
    return ()=>{active=false;clearInterval(timer);};
  },[session,selected,actor,targets]);
  const queueState=useSyncExternalStore(useMemo(()=>commands?(listener:()=>void)=>commands.subscribe(listener):emptyCodeSubscribe,[commands]),
    useMemo(()=>commands?()=>commands.state:()=>null,[commands]),()=>null);
  const anyBusy=Boolean(state.busy||historyBusy||queueState?.pending);
  const actionsDisabled=Boolean(state.playback?.paused);
  const performHistory=async(operation:'undo'|'redo')=>{
    if(!session||anyBusy)return;
    setHistoryBusy(true);setError('');setHistoryFeedback('');
    try{
      const result=await session.scene.history({operation,expectedRevision:session.scene.observe({limit:1}).revision});
      setHistoryFeedback(result.value?.applied?(operation==='undo'?'已撤销':'已重做'):'无可用历史记录');refresh();
    }catch(cause){setError(cause instanceof Error?cause.message:String(cause));}
    finally{setHistoryBusy(false);}
  };
  const current=inspection?.id===target?.id?inspection:null;
  const capabilities=current?.capabilities||[];
  const physical=capabilities.filter((c:any)=>['interaction','world-action'].includes(c.executor)).map((c:any)=>({
    action:c.name,source:c.source,execution:c.executor,partName:c.partName,available:c.available,canApproach:c.canApproach,reason:c.reason,verification:c.verification,parameters:c.parameters
  }));
  const custom=capabilities.filter((c:any)=>c.executor==='project-action');
  return <div className="code-project-actions" aria-label="代码世界物理检查器">
    <h3>对象与交互</h3>
    {!session||!commands?<p>运行项目后，注册的对象和动作会显示在这里。</p>:<>
      <label className="code-world-target">场景对象
        <select aria-label="交互对象" value={selected} disabled={anyBusy} onChange={event=>onSelect(event.target.value)}>
          <option value="">请选择对象</option>
          {targets.map(item=><option key={item.id} value={item.id}>{item.label} · {item.source}</option>)}
        </select>
      </label>
      {target?<div className="code-world-target-header"><strong>{target.label}</strong><small>{target.id} · {target.source}</small></div>:null}
      {current?<PhysicsSummary inspection={current}/>:null}
      {actionsDisabled?<p className="affordance-reason" role="note">模拟已暂停，恢复世界时间后才能执行物理操作。</p>:null}
      <section aria-label="物理交互" className="code-world-physical-actions">
        <h4>物理交互</h4>
        <AffordanceActionPanel key={selected} targetId={selected||'$none'} actor={actor}
          affordances={current?{source:current.physics?.source==='native-physics'?'native-physics':current.source,label:current.label||selected,
            evidenceKind:current.evidenceKind||'unverified',physicsVerified:false,actions:physical}:null}
          commands={commands} log={()=>{}} disabled={actionsDisabled||(anyBusy&&!commands.isActionPending(selected))}/>
      </section>
      <CodeWorldNavigation session={session} actor={actor} commands={commands} refresh={refresh} disabled={actionsDisabled||(anyBusy&&!commands.isActionPending(actor||''))}/>
      <section className="code-world-history" aria-label="共享历史">
        <h4>共享历史</h4>
        <div className="code-project-action-buttons">
          <button type="button" aria-label="撤销最近操作" disabled={anyBusy||!history.canUndo} onClick={()=>void performHistory('undo')}>撤销 · {history.undo}</button>
          <button type="button" aria-label="重做最近操作" disabled={anyBusy||!history.canRedo} onClick={()=>void performHistory('redo')}>重做 · {history.redo}</button>
        </div>
        {historyFeedback?<output role="status">{historyFeedback}</output>:null}
      </section>
      {custom.length?<section><h4>项目自定义动作</h4>
        {custom.map((action:any)=><ProjectAction key={action.id+':'+JSON.stringify(action.parameters)} controller={controller} entity={target} action={action} refresh={refresh} disabled={anyBusy||actionsDisabled}/>)}
      </section>:null}
      {current?<details open={!current.physics}><summary>实时状态</summary><pre>{JSON.stringify(current.state,null,2)}</pre></details>:target?<p className="muted-copy">当前对象未注册可执行能力。</p>:null}
    </>}
    {error?<p role="alert">{error}</p>:null}
  </div>;
}
