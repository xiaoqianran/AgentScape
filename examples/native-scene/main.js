import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import { listNativeScenes, subscribeNativeScenes } from '../../application/native-scene/NativeRenderDiscovery.js';
import { StudioLiveBridgeClient } from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const target = document.querySelector('#target');
const attach = document.querySelector('#attach');
const inject = document.querySelector('#inject');
const detach = document.querySelector('#detach');
const mcp = document.querySelector('#mcp');
const status = document.querySelector('[role=status]');
let session = null, bridge = null;
const overlayBlocks = new Map();
const overlayStorage = new WorldStorage({
  async read(hash, expectedBytes) {
    const bytes = overlayBlocks.get(hash);
    if (!bytes || bytes.length !== expectedBytes) throw new Error('OVERLAY_BLOCK_NOT_FOUND');
    return bytes.slice();
  },
  async write(hash, bytes) {
    if (!overlayBlocks.has(hash)) overlayBlocks.set(hash, bytes.slice());
  }
});
const refresh = () => {
  const previous = target.value;
  target.replaceChildren(...listNativeScenes().map(candidate => {
    const option = document.createElement('option');
    option.value = candidate.id;
    option.textContent = `${candidate.scene.name || candidate.id} (${candidate.camera.type})`;
    return option;
  }));
  if ([...target.options].some(option => option.value === previous)) target.value = previous;
  attach.disabled = Boolean(session) || !target.options.length;
  if (!session) status.textContent = '已发现原生场景，请选择连接目标。';
};
subscribeNativeScenes(refresh);
attach.onclick = async () => {
  attach.disabled = true;
  try {
    const candidate = listNativeScenes().find(item => item.id === target.value);
    if (!candidate) throw new Error('未找到目标场景');
    // Sidecar environment registration. Nothing is added to the original source.
    const floor = candidate.scene.getObjectByName('NativeFloor');
    if (!floor) throw new Error('NATIVE_FLOOR_NOT_FOUND');
    session = await attachNativeScene({ ...candidate,
      // Reuse the original mesh for physical collision and navigation.
      walkableMesh: floor,
      hostProjectId: 'agentscape.native-three-demo',
      hostRevision: 'native-courtyard-v1',
    });
    const port = new URLSearchParams(location.search).get('mcpPort') || '39015';
    if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('MCP_PORT_INVALID');
    bridge = new StudioLiveBridgeClient({ ...session, serverUrl: `http://127.0.0.1:${port}` });
    bridge.subscribe(() => {
      const state = bridge.snapshot();
      document.querySelector('#bridge-status').textContent = state.status === 'connected'
        ? `MCP 已连接 · ${state.worldSessionId}` : `MCP ${state.status}${state.error ? ' · ' + state.error : ''}`;
    });
    if (mcp.checked) bridge.setAutoEnabled(true);
    target.disabled = true;
    inject.disabled = false;
    detach.disabled = false;
    status.textContent = '已连接：原生渲染、Shader 和动画保持运行。';
  } catch (error) {
    bridge?.dispose();
    bridge = null;
    session?.close();
    session = null;
    status.textContent = `连接失败：${error.code || error.message}`;
    attach.disabled = false;
  }
};
inject.onclick = async () => {
  inject.disabled = true;
  try {
    const models = [
      { id: 'native_cabinet', asset: 'builtin://cabinet', position: [-2, 0, 0] },
      { id: 'native_cup', asset: 'builtin://cup', position: [1, 2, 0] },
      { id: 'native_agent', asset: 'builtin://agent', position: [3, 0, 2] },
    ];
    for (const model of models) {
      if (!session.world.store.has(model.id)) await session.scene.addModel(model);
    }
    status.textContent = '已注入 3 个资产；杯子由真实物理解算落到原生地板上。';
  } catch (error) {
    status.textContent = `注入失败：${error.code || error.message}`;
    inject.disabled = false;
  }
};
detach.onclick = () => {
  try {
    session.close();
    bridge.dispose();
    bridge = null;
    session = null;
    inject.disabled = detach.disabled = true;
    target.disabled = false;
    refresh();
    status.textContent = '注入层已移除，原生场景继续运行。';
  } catch (error) { status.textContent = `卸载失败：${error.code || error.message}`; }
};
mcp.onchange = () => bridge?.setAutoEnabled(mcp.checked);
// Inspection hooks for the example and browser acceptance; never used by the project.
window.nativeDemo = { listNativeScenes, storage: overlayStorage, get session() { return session; }, get bridge() { return bridge; } };
await import('./project/main.js');
