// V1 deliberately keeps the LLM outside the runtime. Any model that can call
// AgentTools can replace this tiny planner without changing the 3D world.
export class DemoAgent {
  constructor(tools, log) {
    this.tools = tools;
    this.log = log;
  }

  async bootstrap() {
    await this.tools.call('spawnAsset', { assetId: 'table', position: [0, 0, 0], instanceId: 'table_01' });
    await this.tools.call('spawnAsset', { assetId: 'cabinet', position: [-2.7, 0, -1.1], instanceId: 'cabinet_01' });
    await this.tools.call('spawnAsset', { assetId: 'cup', position: [0.35, 1.4, 0], instanceId: 'cup_01' });
  }

  async run(text) {
    const q = text.toLowerCase().trim();
    this.log(`goal: ${text}`, 'goal');

    if (q.includes('打开') || q.includes('open')) {
      return this.tools.call('open', { id: 'cabinet_01' });
    }
    if (q.includes('关闭') || q.includes('close')) {
      return this.tools.call('close', { id: 'cabinet_01' });
    }
    if (q.includes('拿') || q.includes('pickup') || q.includes('pick up')) {
      return this.tools.call('pickup', { id: 'cup_01' });
    }
    if (q.includes('放') || q.includes('place')) {
      return this.tools.call('place', { id: 'cup_01', targetId: 'table_01' });
    }
    if (q.includes('咖啡角') || q.includes('coffee')) {
      this.tools.call('moveObject', { id: 'table_01', position: [0.3, 0, 0] });
      this.tools.call('moveObject', { id: 'cabinet_01', position: [-2.5, 0, -0.7] });
      return this.tools.call('place', { id: 'cup_01', targetId: 'table_01' });
    }
    if (q.includes('对象') || q.includes('objects') || q.includes('list')) {
      const result = await this.tools.call('listObjects');
      this.log(JSON.stringify(result, null, 2), 'result');
      return result;
    }
    this.log('V1 本地 planner 只识别：打开/关闭柜子、拿杯子、放杯子、建立咖啡角、列出对象。接入 LLM 后无需修改 Runtime。', 'hint');
  }
}
