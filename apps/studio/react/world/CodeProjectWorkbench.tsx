import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import './CodeProjectWorkbench.css';
import { formFieldsForAction, initialActionFieldValues, actionArgumentsFromFields } from './ProjectActionArguments.js';

export const emptyCodeState = Object.freeze({ visible:false, active:false });
export const emptyCodeSubscribe = () => () => {};
export const emptyCodeSnapshot = () => emptyCodeState;

export function CodeProjectEditor({ controller }: { controller:any }) {
  const state:any = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState('');
  const [working, setWorking] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!dirty) { setSource(state.project?.source || ''); setName(state.project?.name || ''); setRevision(state.revision); }
  }, [state.project, state.revision, dirty]);
  const run = async (operation:()=>Promise<any>, success:string) => {
    setWorking(true); setError(''); setMessage('');
    try { await operation(); setMessage(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorking(false); }
  };
  const apply = async () => {
    if (dirty) { await controller.write({ source, name, expectedRevision:revision }); setDirty(false); }
  };
  const busy = state.busy || working;
  return <div className="code-project-editor" aria-label="完整代码项目">
    <h2>代码世界</h2>
    <p>编写完整 Three.js 世界，也可以在任务面板让 AI 创建和修改。</p>
    <div className="code-project-buttons">
      <button disabled={busy || state.active || dirty} onClick={()=>void run(()=>controller.write({create:true}), '已创建草稿')}>新建代码世界</button>
      <button disabled={busy || state.active || dirty} onClick={()=>file.current?.click()}>导入代码项目</button>
    </div>
    <label>本机项目<select aria-label="本机代码项目" value={selected} onChange={e=>setSelected(e.target.value)}>
      <option value="">选择已保存项目</option>
      {state.projects.map((item:any)=><option key={item.id} value={item.id}>{item.name}</option>)}
    </select></label>
    <button disabled={busy || state.active || dirty || !selected} onClick={()=>void run(()=>controller.load(selected), '项目已打开，点击运行')}>打开代码项目</button>
    {state.project ? <>
      <label>项目名称<input aria-label="代码项目名称" value={name} disabled={busy} onChange={e=>{setName(e.target.value);setDirty(true);}} /></label>
      <label className="code-source-label">世界源码<textarea aria-label="世界源码" spellCheck={false} value={source} disabled={busy} onChange={e=>{setSource(e.target.value);setDirty(true);}} /></label>
      <div className="code-project-buttons">
        <button disabled={busy || !dirty} onClick={()=>void run(apply, '源码草稿已保存')}>保存源码草稿</button>
        <button disabled={busy} onClick={()=>void run(async()=>{await apply();await controller.run({expectedRevision:controller.snapshot().revision});}, '代码世界运行中')}>运行代码世界</button>
        <button disabled={busy || dirty || !state.active || state.revision!==state.runningRevision} onClick={()=>void run(()=>controller.save(), '世界状态已保存到本机')}>保存世界状态</button>
        <button disabled={busy || dirty || !state.active || state.revision!==state.runningRevision} onClick={()=>void run(async()=>{
          const saved = await controller.save();
          const url = URL.createObjectURL(new Blob([JSON.stringify(saved.value)], {type:'application/json'}));
          const link = document.createElement('a'); link.href=url;link.download=saved.value.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }, '完整代码项目已导出')}>导出代码项目</button>
      </div>
      <small>草稿 r{state.revision} · {state.active ? '运行 r'+state.runningRevision : '尚未运行'}{dirty ? ' · 编辑器有未保存修改' : ''}</small>
      {dirty && revision!==state.revision ? <p role="alert">AI 已更新源码。请复制保留当前编辑，再载入最新版本。</p> : null}
      {dirty ? <button onClick={()=>setDirty(false)}>放弃编辑并载入最新源码</button> : null}
    </> : null}
    <p className="code-project-note">代码在当前工作台中执行，可使用 Shader、动画和自定义动作。导入项目时请确认来源可信。</p>
    <button disabled={busy || dirty} onClick={()=>void run(()=>controller.close(), '已返回内置世界')}>保存并返回内置世界</button>
    <output role="status">{message}</output>
    {error || state.error ? <p role="alert">{error || state.error}</p> : null}
    <input hidden ref={file} type="file" accept=".json,application/json" onChange={event=>{
      const input=event.target.files?.[0];event.target.value='';
      if(input) void run(async()=>controller.write({create:true,project:JSON.parse(await input.text())}), '代码项目已导入，点击运行');
    }} />
  </div>;
}

function ProjectAction({ controller, entity, action, refresh }:any) {
  const fields = formFieldsForAction(action.parameters);
  const [values, setValues] = useState<Record<string,string>>(() => initialActionFieldValues(fields || []));
  const [rawArgs, setRawArgs] = useState('{}');
  const [advanced, setAdvanced] = useState(false);
  const [result, setResult] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string|null>(null);
  const invoke = async () => {
    setBusy(true); setResult(''); setStatus('正在执行');
    try {
      const args = fields && !advanced ? actionArgumentsFromFields(fields,values) : JSON.parse(rawArgs);
      const api = controller.scene;
      const job = api.interact({action:'custom',target:entity.id,name:action.name,args});
      setJobId(job.id);
      const terminal = await api.waitJob(job.id);
      setResult(JSON.stringify(terminal.result,null,2));
      setStatus(terminal.status==='succeeded'
        ? terminal.result?.verification?.status==='verified' ? '已验证' : '已执行（未验证）'
        : terminal.status==='cancelled' ? '已取消' : '执行失败');
      refresh();
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
      <button type="button" disabled={busy || !action.available} onClick={()=>void invoke()}>执行 {action.name}</button>
      {jobId ? <button type="button" onClick={()=>{
        try { controller.scene.cancelJob(jobId); setStatus('正在取消'); }
        catch(error) { setResult(error instanceof Error ? error.message : String(error)); }
      }}>取消执行</button> : null}
    </div>
    {status ? <output role="status">{status}</output> : null}
    {result ? <details className="code-project-action-result"><summary>执行详情</summary><pre>{result}</pre></details> : null}
  </details>;
}

export function CodeProjectActions({ controller }: {controller:any}) {
  const [entities,setEntities] = useState<any[]>([]);
  const [error,setError] = useState('');
  const refresh = () => {
    try { setEntities(controller.session?.world.projectCapabilities.list().entities || []);setError(''); }
    catch(cause) { setError(String(cause)); }
  };
  useEffect(()=>{refresh();const timer=setInterval(refresh,1000);return ()=>clearInterval(timer);},[controller,controller.session]);
  return <div className="code-project-actions"><h3>世界对象与动态动作</h3>
    {!entities.length ? <p>运行项目后，注册的对象和动作会显示在这里。</p> : null}
    {entities.map(entity=><section key={entity.id}><h4>{entity.label} <small>{entity.id}</small></h4>
      <pre>{JSON.stringify(entity.state,null,2)}</pre>
      {entity.actions.map((action:any)=><ProjectAction key={action.name+':'+JSON.stringify(action.parameters)} {...{controller,entity,action,refresh}} />)}
    </section>)}{error ? <p role="alert">{error}</p> : null}
  </div>;
}
