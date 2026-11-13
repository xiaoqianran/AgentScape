import { openCodeProject } from '../../application/native-scene/CodeProject.js';
import { StudioLiveBridgeClient } from '../../apps/studio/bridge/StudioLiveBridgeClient.js';

const status = document.querySelector('[role=status]'), output = document.querySelector('#observation');
let session, bridge;
const show = () => { output.textContent = JSON.stringify(session.scene.observe().project, null, 2); };
const report = error => { status.textContent = `操作失败：${error.code || error.message}`; };
async function open(project) {
  // Prepare a fresh project before replacing a working one.
  const next = await openCodeProject({ project, container: document.querySelector('#world'), authorized: true });
  try { session?.close(); } catch (error) { next.close(); throw error; }
  bridge?.dispose(); session = next;
  const port = new URLSearchParams(location.search).get('mcpPort') || '39015';
  bridge = new StudioLiveBridgeClient({ ...session, serverUrl: `http://127.0.0.1:${port}` });
  bridge.subscribe(() => { document.querySelector('#bridge').textContent = `MCP ${bridge.snapshot().status}`; });
  if (document.querySelector('#mcp').checked) bridge.setAutoEnabled(true);
  for (const id of ['teleport', 'pulse', 'save']) document.querySelector('#' + id).disabled = false;
  status.textContent = '项目已运行，自定义动作已注册。'; show();
}
document.querySelector('#start').onclick = async () => {
  try { const response = await fetch('/code-projects/portal.json'); if (!response.ok) throw new Error('PROJECT_LOAD_FAILED'); await open(await response.json()); }
  catch (error) { report(error); }
};
async function invoke(name, args) {
  const job = session.scene.interact({ action: 'custom', target: 'portal', name, args });
  const done = await session.scene.waitJob(job.id);
  status.textContent = done.status !== 'succeeded' ? `执行失败：${done.result.diagnostics[0]?.code}`
    : done.result.verification.status === 'verified' ? '传送完成，项目验证器已核对结果。' : '光效已执行，未请求验证。';
  show(); return done;
}
document.querySelector('#teleport').onclick = () => invoke('teleport', { destination: 'garden' }).catch(report);
document.querySelector('#pulse').onclick = () => invoke('pulse', { brightness: 2 }).catch(report);
document.querySelector('#save').onclick = async () => {
  try {
    const saved = await session.scene.save(), url = URL.createObjectURL(new Blob([JSON.stringify(saved.value)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'portal-project.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = '项目代码、资源与状态已打包。';
  } catch (error) { report(error); }
};
document.querySelector('#file').onchange = async event => { try { const file = event.target.files[0]; if (file) await open(await file.text()); } catch (error) { report(error); } };
document.querySelector('#mcp').onchange = event => bridge?.setAutoEnabled(event.target.checked);
window.codeProjectDemo = { get session() { return session; }, get bridge() { return bridge; }, open, invoke };
