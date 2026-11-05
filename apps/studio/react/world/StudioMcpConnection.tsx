import { useState, useSyncExternalStore } from 'react';
import './StudioMcpConnection.css';

type Snapshot={
  status:'disconnected'|'connecting'|'connected';
  worldSessionId:string|null;
  error:string|null;
  autoEnabled:boolean;
  mode:'automatic'|'paired'|null;
};
type Controller={
  base:string;
  subscribe:(listener:()=>void)=>()=>void;
  snapshot:()=>Snapshot;
  setAutoEnabled:(enabled:boolean)=>void;
  refreshAuto:()=>void;
  connect:(pairCode:string)=>Promise<Snapshot>;
  disconnect:()=>void;
};

export function StudioMcpConnection({controller}:{controller:Controller}) {
  const [open,setOpen]=useState(false);
  const [advanced,setAdvanced]=useState(false);
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

  const status=state.status==='connected'?'已连接'
    :state.autoEnabled?'自动连接中'
    :'已关闭';

  return <div className="studio-mcp-connection" data-bridge-state={state.status}
    data-auto-enabled={String(state.autoEnabled)}>
    <button id="studio-mcp-toggle" type="button" className={state.status==='connected'?'is-connected':''}
      aria-expanded={open} aria-controls="studio-mcp-panel" onClick={()=>setOpen(value=>!value)}>
      <span aria-hidden="true">◎</span> MCP {status}
    </button>
    {open?<section id="studio-mcp-panel" aria-label="MCP 自动连接当前世界">
      <header>
        <strong>MCP 世界连接</strong>
        <button type="button" aria-label="关闭 MCP 连接面板" onClick={()=>setOpen(false)}>×</button>
      </header>
      <label className="studio-mcp-auto-toggle">
        <input id="studio-mcp-auto-enabled" type="checkbox" role="switch"
          aria-label="允许本机 MCP 自动控制当前世界"
          checked={state.autoEnabled} onChange={event=>{
            setError('');
            controller.setAutoEnabled(event.target.checked);
          }}/>
        <span>允许本机 MCP 自动控制当前世界</span>
      </label>
      {state.autoEnabled?<p>默认开启，无须配对码。Studio 会自动发现本机 MCP 服务，认证后的 AI 可直接调用 Scene 工具。切换世界后自动重连。</p>
        :<p>自动控制已关闭。MCP 无法默认操作当前世界；已有独立 Headless 会话不受影响。</p>}
      {state.status==='connected'?<>
        <p role="status">已连接 · {state.mode==='automatic'?'自动模式':'手动配对'} · <code>{state.worldSessionId?.slice(0,8)}…</code></p>
        {state.autoEnabled?<button type="button" onClick={()=>controller.setAutoEnabled(false)}>关闭 MCP 控制</button>
          :<button id="studio-mcp-disconnect" type="button" onClick={()=>controller.disconnect()}>断开连接</button>}
      </>:state.autoEnabled?<p role="status">正在等待本机 MCP 服务。服务启动或恢复后将自动重试，无须手动操作。</p>:null}
      {state.autoEnabled?<button type="button" onClick={()=>controller.refreshAuto()}>立即重试连接</button>
        :<details open={advanced} onToggle={event=>setAdvanced(event.currentTarget.open)}>
          <summary>高级：使用一次性配对码</summary>
          <p>如需手动控制特定会话，先在 MCP 客户端调用 <code>studio_pair_create</code>。</p>
          <label>一次性配对码
            <input id="studio-mcp-pair-code" type="password" autoComplete="off"
              value={code} onChange={event=>setCode(event.target.value.trim())}
              placeholder="粘贴 MCP 返回的配对码" />
          </label>
          <button id="studio-mcp-connect" type="button" disabled={state.status==='connecting'||code.length<32}
            onClick={()=>void connect()}>{state.status==='connecting'?'正在连接…':'手动连接'}</button>
        </details>}
      {(error||(state.error&&state.error!=='MCP_OFFLINE'))?<p role="alert">{error||state.error}</p>:null}
      <small>仅连接本机 {controller.base}，不会将 MCP Bearer Token 暴露给浏览器。多个 Studio 标签页时需使用明确的会话 ID。</small>
    </section>:null}
  </div>;
}
