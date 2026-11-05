import { useState, useSyncExternalStore } from 'react';
import './StudioMcpConnection.css';

type Snapshot={status:'disconnected'|'connecting'|'connected';worldSessionId:string|null;error:string|null};
type Controller={
  base:string;
  subscribe:(listener:()=>void)=>()=>void;
  snapshot:()=>Snapshot;
  connect:(pairCode:string)=>Promise<Snapshot>;
  disconnect:()=>void;
};

export function StudioMcpConnection({controller}:{controller:Controller}) {
  const [open,setOpen]=useState(false);
  const [code,setCode]=useState('');
  const [error,setError]=useState('');
  const state=useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);

  const connect=async()=>{
    setError('');
    try {
      await controller.connect(code);
      setCode('');
    } catch(cause) {
      setError(cause instanceof Error?cause.message:String(cause));
    }
  };

  return <div className="studio-mcp-connection" data-bridge-state={state.status}>
    <button id="studio-mcp-toggle" type="button" className={state.status==='connected'?'is-connected':''}
      aria-expanded={open} aria-controls="studio-mcp-panel" onClick={()=>setOpen(value=>!value)}>
      <span aria-hidden="true">◎</span> MCP {state.status==='connected'?'已连接':'连接'}
    </button>
    {open?<section id="studio-mcp-panel" aria-label="连接 MCP 到当前世界">
      <header>
        <strong>连接 MCP 到当前世界</strong>
        <button type="button" aria-label="关闭 MCP 配对面板" onClick={()=>setOpen(false)}>×</button>
      </header>
      <p>在已授权的 MCP 客户端调用 <code>studio_pair_create</code>，将返回的配对码粘贴在这里。连接后 AI 的 Scene 操作直接影响当前世界；切换世界会自动断开。</p>
      {state.status==='connected'?<>
        <p role="status">已连接 · <code>{state.worldSessionId?.slice(0,8)}…</code></p>
        <button id="studio-mcp-disconnect" type="button" onClick={()=>controller.disconnect()}>断开授权</button>
      </>:<>
        <label>一次性配对码
          <input id="studio-mcp-pair-code" type="password" autoComplete="off"
            value={code} onChange={event=>setCode(event.target.value.trim())}
            placeholder="粘贴 MCP 返回的配对码" />
        </label>
        <button id="studio-mcp-connect" type="button" disabled={state.status==='connecting'||code.length<32}
          onClick={()=>void connect()}>{state.status==='connecting'?'正在连接…':'授权连接当前世界'}</button>
      </>}
      {(error||state.error)?<p role="alert">{error||state.error}</p>:null}
      <small>仅连接本机 {controller.base}；配对码只使用一次，不会写入浏览器存储。</small>
    </section>:null}
  </div>;
}
