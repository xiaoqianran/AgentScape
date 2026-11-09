import React, { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createNativeWorldHost } from '../native-frameworks/createNativeWorldHost.js';

function NativeWorld() {
  const container = useRef(null);
  const [status, setStatus] = useState('connecting');
  const hostRef = useRef(null);
  useEffect(() => {
    // Each mount owns its host; StrictMode cleanup can happen before attach resolves.
    const host = createNativeWorldHost(container.current, setStatus);
    hostRef.current = host;
    window.nativeFrameworkDemo = host;
    void host.start();
    return () => {
      host.dispose();
      if (hostRef.current === host) hostRef.current = null;
      if (window.nativeFrameworkDemo === host) delete window.nativeFrameworkDemo;
    };
  }, []);
  return <section style={{ padding: 24, maxWidth: 960 }}>
    <h1>React + 原生 Three.js + AgentScape</h1>
    <p data-testid="status">{status}</p>
    <button type="button" onClick={() => hostRef.current?.detach()}>仅卸载 AgentScape</button>
    <div data-testid="canvas-host" ref={container} style={{ marginTop: 12, minHeight: 420, width: '100%' }} />
  </section>;
}

const root = createRoot(document.getElementById('app'));
root.render(<StrictMode><NativeWorld /></StrictMode>);
window.unmountNativeFramework = () => root.unmount();
