const DEFAULT_COFFEE_CORNER = { table:[4.8,0,4.2], cabinet:[2.4,0,4.2] };

export class LocalPlannerGateway {
  constructor({ coffeeCorner = DEFAULT_COFFEE_CORNER } = {}) { this.coffeeCorner = coffeeCorner; }
  isConfigured() { return true; }

  async complete({ messages }) {
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const q = String(user?.content || '').toLowerCase();
    const toolResultCount = messages.filter((m) => m.role === 'tool').length;
    if (toolResultCount) return { final: true, message: '任务已执行。', toolCalls: [] };

    const calls = [];
    if (q.includes('列出') || q.includes('对象') || q.includes('list')) calls.push({ name: 'listObjects', args: {} });
    if (q.includes('椅子') || q.includes('chair')) { calls.push({ name: 'searchAssets', args: { query: 'chair' } }); calls.push({ name: 'spawnAsset', args: { assetId: 'chair', position: [1.8, 0, 0] } }); }
    if (q.includes('打开') || q.includes('open')) calls.push({ name:'approachAndInteract', args:{ actorId:'agent_01', targetId:'cabinet_01', action:'open' } });
    if (q.includes('关闭') || q.includes('close')) calls.push({ name:'approachAndInteract', args:{ actorId:'agent_01', targetId:'cabinet_01', action:'close' } });
    if (q.includes('拿') || q.includes('pickup') || q.includes('pick up')) calls.push({ name: 'pickup', args: { id: 'cup_01' } });
    if (q.includes('放') || q.includes('place')) calls.push({ name: 'place', args: { id: 'cup_01', targetId: 'table_01' } });
    if (q.includes('咖啡角') || q.includes('coffee')) {
      calls.push({ name: 'moveObject', args: { id: 'table_01', position: this.coffeeCorner.table } });
      calls.push({ name: 'moveObject', args: { id: 'cabinet_01', position: this.coffeeCorner.cabinet } });
      calls.push({ name: 'place', args: { id: 'cup_01', targetId: 'table_01' } });
    }
    if (!calls.length) return { final: true, message: '本地模式无法规划这个请求。配置 LLM Gateway 后可使用自然语言多步规划。', toolCalls: [] };
    return { final: false, message: '', toolCalls: calls.map((call, i) => ({ id: `local_${i}`, ...call })) };
  }
}
