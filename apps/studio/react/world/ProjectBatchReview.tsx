import type { ReactNode } from 'react';

type Batch = {
  previewId:string; baseRevision:number; operations:number; files:number; resources:number;
  changes:Array<{kind:string;path:string;action:string;diff:string;truncated:boolean}>;
};
type Undo = {revision:number;files:number;resources:number};

const actionLabel:Record<string,string> = {create:'新增',delete:'删除',modify:'修改'};

export function ProjectBatchReview({controller,preview,undo,revision,busy,dirty,onRun}:{
  controller:any; preview:Batch|null; undo:Undo|null; revision:number; busy:boolean; dirty:boolean;
  onRun:(operation:()=>Promise<unknown>,message:string)=>Promise<void>;
}):ReactNode {
  if (!preview && !undo) return null;
  const blocked = busy || dirty;
  return <section className="code-project-batch" aria-label="批量修改审阅">
    {preview ? <>
      <h3>待审阅多文件修改</h3>
      <p>基于草稿 r{preview.baseRevision} · {preview.operations} 步操作 · {preview.files} 个源码文件 · {preview.resources} 个资源</p>
      {preview.changes.map(change=><details key={change.kind+':'+change.path} className="code-project-diff">
        <summary>{actionLabel[change.action] || '修改'} · {change.path}</summary>
        <pre aria-label={'修改差异 '+change.path}>{change.diff.split('\n').map((line,i)=>
          <span key={i} className={line.startsWith('+ ')?'added':line.startsWith('- ')?'removed':'context'}>
            {line+'\n'}
          </span>)}</pre>
        {change.truncated ? <small>差异过长，已截断。可打开文件核对完整内容。</small> : null}
      </details>)}
      {dirty ? <p role="note">当前编辑器有未保存修改；保存草稿会使本次预览失效，请先处理草稿冲突。</p> : null}
      <div className="code-project-buttons">
        <button disabled={blocked || revision!==preview.baseRevision} onClick={()=>void onRun(
          ()=>controller.applyBatch({previewId:preview.previewId,expectedRevision:preview.baseRevision}),
          '已一次性应用全部修改，请重新运行代码世界')}>应用全部修改</button>
        <button disabled={busy} onClick={()=>void onRun(
          ()=>controller.discardBatch({previewId:preview.previewId}), '已放弃本次预览，原项目未修改')}>
          放弃批量预览
        </button>
      </div>
    </> : null}
    {undo && !preview ? <div className="code-project-batch-undo">
      <span>最近一批修改已应用（草稿 r{undo.revision}）：{undo.files} 个源码文件、{undo.resources} 个资源。</span>
      <button disabled={blocked || revision!==undo.revision} onClick={()=>void onRun(
        ()=>controller.undoBatch({expectedRevision:undo.revision}),
        '已撤销上一批修改，请重新运行代码世界')}>撤销上一批修改</button>
      <small>仅撤销当前会话最近一批修改；后续独立修改会清除撤销记录。</small>
    </div> : null}
  </section>;
}
