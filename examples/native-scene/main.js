import { WorldStorage } from '../../application/scene/WorldStorage.js';
import { WorldDirectory } from '../../application/scene/WorldDirectory.js';
import { openNativeOverlayCheckpoint, IndexedDBNativeOverlayHeadStore } from '../../application/native-scene/NativeOverlayCheckpoint.js';
import { attachNativeScene } from '../../application/native-scene/NativeSceneHost.js';
import { listNativeScenes, subscribeNativeScenes } from '../../application/native-scene/NativeRenderDiscovery.js';
import { StudioLiveBridgeClient } from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const target = document.querySelector('#target');
const attach = document.querySelector('#attach');
const inject = document.querySelector('#inject');
const detach = document.querySelector('#detach');
const mcp = document.querySelector('#mcp');
const saveOverlay = document.querySelector('#save-overlay');
const restoreOverlay = document.querySelector('#restore-overlay');
const overlayStatus = document.querySelector('#overlay-status');
const status = document.querySelector('[role=status]');
let session = null, bridge = null, checkpoint = null, busy = false;
// OPFS stores immutable content blocks. IndexedDB atomically publishes the
// latest root pointer, across full browser page reloads.
const overlayStorage = new WorldStorage(new WorldDirectory(await navigator.storage.getDirectory()));
const overlayHeads = new IndexedDBNativeOverlayHeadStore({
  key: 'agentscape.native-three-demo:native-courtyard-v1'
});
const updateOverlayActions = async () => {
  const connected = Boolean(session && checkpoint);
  saveOverlay.disabled = !connected || busy;
  restoreOverlay.disabled = true;
  if (!connected) {
    overlayStatus.textContent = '尚未连接 · 存档由浏览器 OPFS 和 IndexedDB 保存';
    return;
  }
  const root = await checkpoint.readLatest();
  restoreOverlay.disabled = !root || busy;
  overlayStatus.textContent = root
    ? '已找到有效存档指针 · 可点击恢复最近存档'
    : '尚无已发布存档 · 注入资产后点击保存';
};
const reportOverlayError = (action, error) => {
  const code = error?.code || error?.message || 'UNKNOWN_ERROR';
  overlayStatus.textContent = `${action}失败：${code}。当前世界未被存档操作主动清空；可检查浏览器站点存储后重试。`;
};
const withOverlayOperation = async (action, operation) => {
  if (busy || !checkpoint || !session) return;
  busy = true;
  saveOverlay.disabled = restoreOverlay.disabled = true;
  overlayStatus.textContent = `${action}中…`;
  try {
    const result = await operation();
    await updateOverlayActions();
    overlayStatus.textContent = action === '保存'
      ? '已保存注入层 · 内容块和最新存档指针均已发布'
      : '已恢复最近存档 · 当前 AgentScape 对象已替换，宿主场景不变';
    return result;
  } catch(error) {
    reportOverlayError(action, error);
  } finally {
    busy = false;
    if (session && checkpoint) {
      saveOverlay.disabled = false;
      restoreOverlay.disabled = !(await checkpoint.readLatest().catch(() => null));
    }
  }
};
saveOverlay.onclick = () => withOverlayOperation('保存', () => checkpoint.saveLatest());
restoreOverlay.onclick = () => withOverlayOperation('恢复', () => checkpoint.restoreLatest());
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
    checkpoint = await openNativeOverlayCheckpoint(session.scene, overlayStorage, overlayHeads);
    await updateOverlayActions();
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
    checkpoint = null;
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
    if (checkpoint) overlayStatus.textContent = '新增对象尚未保存 · 点击「保存注入层」以便刷新后恢复';
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
    checkpoint = null;
    inject.disabled = detach.disabled = true;
    target.disabled = false;
    refresh();
    void updateOverlayActions();
    status.textContent = '注入层已移除，原生场景继续运行。';
  } catch (error) { status.textContent = `卸载失败：${error.code || error.message}`; }
};
mcp.onchange = () => bridge?.setAutoEnabled(mcp.checked);
// Inspection hooks for the example and browser acceptance; never used by the project.
window.nativeDemo = { listNativeScenes, storage: overlayStorage, heads: overlayHeads, get checkpoint() { return checkpoint; }, get session() { return session; }, get bridge() { return bridge; } };
await import('./project/main.js');
