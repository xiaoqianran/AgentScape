import {useEffect,useState} from 'react';
import type {SharedWorldRepository} from '../../code-project/SharedWorldRepository.js';
import './SharedWorldHistory.css';

type Entry={
  id:string;kind:'code-project'|'authoring-draft';name:string;version:number
};
type Version={
  id:string;version:number;updatedAt:string;name:string;digest:string;totalBytes:number;
  restoredFromVersion?:number
};
type Page={
  latestVersion:number;versions:Version[];nextOffset:number|null;total:number
};
type Preview=Version & {kind:Entry['kind'];content:any};
const readableDate=(value:string)=>{
  const parsed=new Date(value);
  return Number.isNaN(parsed.getTime())?'时间未知':parsed.toLocaleString('zh-CN');
};
function summarize(value:Preview) {
  const content=value.content;
  if(value.kind==='code-project'){
    const resources=Object.keys(content.resources||{}).length;
    const files=Object.keys(content.files||{}).length+1;
    const changes=Object.keys(content.edits?.overrides||{}).length;
    const entities=content.runtime?.entities?.length || 0;
    return {
      details:`源码 ${content.source?.length||0} 字符 · ${files} 个代码文件 · ${resources} 份资源 · ${changes} 项原生属性覆盖 · ${entities} 项运行实体`,
      sample:content.source?.length>4800
        ? String(content.source).slice(0,2400)+'\n…（省略中间内容）…\n'+String(content.source).slice(-2400)
        : String(content.source||''),
      truncated:content.source?.length>4800
    };
  }
  const root=content.document?.root;
  const stack=root?[root]:[],visited=new Set();
  let nodeCount=0;
  while(stack.length&&nodeCount<10000){
    const node=stack.pop();
    if(!node||typeof node!=='object'||visited.has(node))continue;
    visited.add(node);nodeCount++;
    for(const child of node.children||[])stack.push(child);
  }
  const raw=JSON.stringify(content.document?.root||{},null,2);
  return {
    details:`创作节点 ${nodeCount} 个 · 资源几何 ${Object.keys(content.document?.geometries||{}).length} 项 · 纹理 ${Object.keys(content.document?.textures||{}).length} 项`,
    sample:raw.slice(0,4800),truncated:raw.length>4800
  };
}

/** Browses remote immutable snapshots without replacing local drafts or running JS.
 * Rollback always creates a new HEAD under the server's optimistic version gate.
 */
export function SharedWorldHistory({
  world,repository,publishToken,onUpdated
}:{
  world:Entry;
  repository:SharedWorldRepository;
  publishToken:string;
  onUpdated?:()=>Promise<void>|void;
}){
  const [versions,setVersions]=useState<Version[]>([]);
  const [head,setHead]=useState(0);
  const [total,setTotal]=useState(0);
  const [nextOffset,setNextOffset]=useState<number|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');

  const refresh=async(offset=0)=>{
    setBusy(true);setError('');
    try{
      const data:Page=await repository.history(world.id,{offset,limit:12});
      if(!Number.isSafeInteger(data.latestVersion)||data.latestVersion<1)throw new Error('WORLD_REPOSITORY_INVALID_RESPONSE');
      if(offset>0&&data.latestVersion!==head)throw new Error('WORLD_REPOSITORY_VERSION_CONFLICT');
      setVersions(previous=>offset===0?data.versions:[...previous,...data.versions]);
      setHead(data.latestVersion);setTotal(data.total);setNextOffset(data.nextOffset);
      if(offset===0)setPreview(null);
    }catch(cause){
      setError(cause instanceof Error?cause.message:String(cause));
    }finally{setBusy(false);}
  };
  useEffect(()=>{
    let live=true;
    setVersions([]);setPreview(null);setError('');setHead(0);setNextOffset(null);
    void repository.history(world.id,{limit:12}).then((response:Page)=>{
      if(!live)return;
      setVersions(response.versions);setHead(response.latestVersion);
      setTotal(response.total);setNextOffset(response.nextOffset);
    }).catch(cause=>{if(live)setError(cause instanceof Error?cause.message:String(cause));});
    return ()=>{live=false;};
  },[repository,world.id]);

  const inspect=async(version:Version)=>{
    setBusy(true);setError('');setMessage('');
    try{
      const entry:Preview=await repository.version(world.id,version.version);
      if(entry.id!==world.id||entry.version!==version.version||entry.digest!==version.digest||
        entry.kind!==world.kind)throw new Error('WORLD_REPOSITORY_HISTORY_INVALID');
      setPreview(entry);
    }catch(cause){
      setError(cause instanceof Error?cause.message:String(cause));
    }finally{setBusy(false);}
  };
  const restore=async(version:Version)=>{
    if(!publishToken.trim()){setError('恢复需要填写上方的共享世界发布授权令牌');return;}
    const accepted=globalThis.confirm?.(
      `确认将共享世界「${world.name}」从 v${version.version} 恢复？将创建 v${head+1}。\n\n`+
      `当前 v${head} 会保留在历史中。完整源码、资源和编辑状态会随版本恢复。\n`+
      '此操作只更新共享服务器，不覆盖本机草稿；历史 JavaScript 不会自动执行。'
    );
    if(!accepted)return;
    setBusy(true);setError('');setMessage('');
    try{
      const result:Version=await repository.rollback({
        id:world.id,targetVersion:version.version,baseVersion:head,token:publishToken
      });
      setMessage(`已创建共享版本 v${result.version}，内容恢复自 v${version.version}。本机草稿保持不变。`);
      setVersions([]);setPreview(null);setHead(0);
      const data:Page=await repository.history(world.id,{limit:12});
      setVersions(data.versions);setHead(data.latestVersion);setTotal(data.total);
      setNextOffset(data.nextOffset);
      await onUpdated?.();
    }catch(cause){
      setError(cause instanceof Error?cause.message:String(cause));
    }finally{setBusy(false);}
  };

  const summary=preview?summarize(preview):null;
  return <section className="shared-world-history" data-world-history={world.id}
    aria-label={`历史版本：${world.name}`}>
    <header className="shared-history-header">
      <div><strong>世界历史版本</strong>
        <small>{head? `线上最新 v${head} · 共 ${total} 个版本`:'正在读取历史…'}</small>
      </div>
      <button type="button" disabled={busy} onClick={()=>void refresh()}>刷新历史</button>
    </header>
    {error ? <p role="alert" className="shared-history-error">历史操作失败：{error}
      {error==='WORLD_REPOSITORY_VERSION_CONFLICT'?' · 共享世界已被其他浏览器更新，请刷新历史后重新确认。':''}
    </p> : null}
    {message?<p role="status" className="shared-history-message">{message}</p>:null}
    <ol className="shared-history-list" aria-label="世界历史版本">
      {versions.map(version=><li key={version.version} data-history-version={version.version}>
        <div className="shared-history-info">
          <strong>v{version.version}{version.version===head?' · 当前版本':''}</strong>
          <small>{version.restoredFromVersion!=null?
            `恢复自 v${version.restoredFromVersion}`:'发布'}
            {' · '}{readableDate(version.updatedAt)}</small>
          <small>SHA-256: {version.digest.slice(0,16)}… · {version.totalBytes.toLocaleString()} 字节</small>
        </div>
        <div className="shared-history-actions">
          <button type="button" disabled={busy} onClick={()=>void inspect(version)}>
            {'查看 v'+version.version+' 内容'}
          </button>
          {version.version!==head?<button type="button" disabled={busy}
            title="把指定版本恢复为新的共享版本，不覆盖本机草稿"
            onClick={()=>void restore(version)}>回滚到 v{version.version}</button>:null}
        </div>
      </li>)}
    </ol>
    {nextOffset!==null?<button type="button" className="shared-history-more" disabled={busy}
      onClick={()=>void refresh(nextOffset)}>加载更早版本</button>:null}
    {preview&&summary?<section className="shared-history-preview" data-history-preview={preview.version}
      aria-label={`v${preview.version} 只读预览`}>
      <div className="shared-history-header">
        <strong>v{preview.version} · {preview.name}</strong>
        <button type="button" onClick={()=>setPreview(null)}>关闭预览</button>
      </div>
      <p>{summary.details}</p>
      <small>完整内容已从共享存储读取并验证哈希。大型文件只展示开头与末尾各 2,400 字符；不会执行代码，也不会覆盖本机草稿。</small>
      <pre>{summary.sample}{summary.truncated?'\n……（已截断）':''}</pre>
    </section>:null}
    <small className="shared-history-footnote">
      回滚不会删除任何历史版本；恢复操作需要上方发布令牌和当前最新版本号。
      若有其他浏览器先行发布，请刷新后再操作。共享历史源码可被有权访问此 Studio 的浏览器读取，切勿提交密钥或其他敏感信息。
    </small>
  </section>;
}
