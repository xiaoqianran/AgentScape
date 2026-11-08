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
    :state.status==='connecting'?'连接中'
    :state.autoEnabled?'等待服务'
    :'未连接';
  const offline=state.autoEnabled&&state.status==='disconnected';
  const reason=error || (state.error && state.error !== 'MCP_OFFLINE' ? state.error : '');

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
      </>:state.autoEnabled?<p role="status" data-mcp-diagnostic={offline?'offline':'connecting'}>
        {offline?'本机 MCP 服务暂不可达，Studio 将自动重试。请确认服务已启动并监听以下地址；此时 AI 尚不能操作当前世界。':'正在连接本机 MCP 服务；连接成功后 AI 才能操作当前世界。'}
      </p>:<p role="status">MCP 当前未连接。可开启自动连接，或使用高级配对模式。</p>}
      {state.autoEnabled?<div className="studio-mcp-recovery">
          {offline?<p>检查服务地址：<code>{controller.base}</code> · 本机服务需先启动。无需重新打开世界，也无需输入配对码。</p>:null}
          <button id="studio-mcp-retry" type="button" disabled={state.status==='connecting'}
            onClick={()=>{setError('');controller.refreshAuto();}}>立即重试连接</button>
        </div>
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
      {reason?<p role="alert">连接失败：{reason}。请检查本机服务及连接配置后重试。</p>:null}
      <details className="studio-mcp-native-help">
        <summary>如何连接自己的 Three.js 项目？</summary>
        <p>此面板连接的是 Studio 当前世界。外部 Three.js 项目需先在自己的页面接入 AgentScape SDK，再通过本机 MCP 桥接；仅在这里开启自动连接，不会自动扫描或导入外部项目。</p>
        <ol>
          <li>在原生项目中调用 <code>AgentScape.attach(&#123; scene, camera, renderer, hostProjectId &#125;)</code>。</li>
          <li>保留原项目的渲染循环，并使用 SDK 的注入层挂载与持久化接口。</li>
          <li>启动本机 MCP 服务并建立受认证的会话，然后在浏览器中验证 AI 操作确实改变场景。</li>
        </ol>
        <a href="https://github.com/xiaoqianran/AgentScape/blob/main/docs/native-threejs-integration.md"
          target="_blank" rel="noopener noreferrer">查看原生 Three.js 接入指南</a>
      </details>
      <small>仅连接本机 {controller.base}，不会将 MCP Bearer Token 暴露给浏览器。多个 Studio 标签页时需使用明确的会话 ID。</small>
    </section>:null}
  </div>;
}
