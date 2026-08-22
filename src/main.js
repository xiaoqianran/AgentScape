import './style.css';
import { WorldRuntime } from './runtime/WorldRuntime.js';
import { AgentTools } from './agent/AgentTools.js';
import { DemoAgent } from './agent/DemoAgent.js';

async function main() {
  const app = document.querySelector('#app');
  app.innerHTML = `
    <main class="shell">
      <section class="brandbar">
        <div><strong>AgentScape</strong><span>Build interactive 3D worlds for agents.</span></div>
        <div class="status"><i></i> Runtime online</div>
      </section>
      <section class="workspace">
        <div id="viewport" class="viewport">
          <div class="hint">拖拽旋转 · 滚轮缩放 · 右键平移</div>
        </div>
        <aside class="panel">
          <div class="eyebrow">AGENT CONSOLE</div>
          <h1>让 Agent 操作世界</h1>
          <p class="intro">V1 已把场景能力封装成工具。现在使用本地 planner 演示；之后可直接接任意支持 tool calling 的 LLM。</p>
          <div class="chips">
            <button data-prompt="打开柜子">打开柜子</button>
            <button data-prompt="关闭柜子">关闭柜子</button>
            <button data-prompt="拿起杯子">拿起杯子</button>
            <button data-prompt="把杯子放到桌上">放到桌上</button>
            <button data-prompt="建立一个咖啡角">建立咖啡角</button>
          </div>
          <div id="log" class="log"></div>
          <form id="command" class="command">
            <input id="input" autocomplete="off" placeholder="例如：打开柜子" />
            <button type="submit">执行</button>
          </form>
          <details>
            <summary>Agent tools</summary>
            <pre id="tools"></pre>
          </details>
        </aside>
      </section>
    </main>`;

  const logEl = document.querySelector('#log');
  function log(text, kind = '') {
    const row = document.createElement('div');
    row.className = `log-row ${kind}`;
    row.textContent = text;
    logEl.prepend(row);
  }

  const world = new WorldRuntime(document.querySelector('#viewport'));
  await world.init();
  world.events.on('tool.called', (event) => log(`tool: ${event.name} ${JSON.stringify(event.args)}`, 'tool'));
  world.events.on('interaction', (event) => log(`action: ${event.action} ${event.id}`, 'tool'));
  const tools = new AgentTools(world);
  const agent = new DemoAgent(tools, log);
  document.querySelector('#tools').textContent = tools.schema().join('\n');
  await agent.bootstrap();
  log('scene ready: table_01 · cabinet_01 · cup_01', 'result');

  async function execute(prompt) {
    try { await agent.run(prompt); }
    catch (err) { log(`error: ${err.message}`, 'error'); }
  }

  document.querySelectorAll('[data-prompt]').forEach(btn => btn.addEventListener('click', () => execute(btn.dataset.prompt)));
  document.querySelector('#command').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.querySelector('#input');
    if (!input.value.trim()) return;
    const value = input.value;
    input.value = '';
    await execute(value);
  });
}

main().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:white;padding:24px">AgentScape failed to start: ${err.message}</pre>`;
});
