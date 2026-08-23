const DEFAULT_COFFEE_CORNER = { table:[4.8,0,4.2], cabinet:[2.4,0,4.2] };
const COMPLETE = new Set(['verified', 'accepted']);
const ADVERSE = new Set(['blocked', 'failed', 'unverified', 'requested', 'error', 'noop']);

const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const sameArgs = (a = {}, b = {}) => stableValue(a) === stableValue(b);

function parseToolContent(message) {
  try { return JSON.parse(message.content || 'null'); }
  catch { return null; }
}

function inferOutcome(value) {
  if (value?._sequence?.outcome?.state) return value._sequence.outcome;
  if (value?.status === 'not-executed') return { state:'skipped', verified:false, reason:value.reason };
  if (value?.error) return { state:'error', verified:false, reason:value.code || 'TOOL_ERROR' };
  const status = value?.status;
  if (['action-completed','arrived','held','placed','dropped'].includes(status)) return { state:'verified', verified:true, status };
  if (status === 'blocked' || status === 'unreachable' || String(status || '').endsWith('-blocked')) return { state:'blocked', verified:false, status, reason:value.reason };
  if (String(status || '').endsWith('-failed')) return { state:'failed', verified:false, status, reason:value.reason };
  if (String(status || '').endsWith('-unverified') || status === 'cancelled') return { state:'unverified', verified:false, status, reason:value.reason };
  return { state:'accepted', verified:null, ...(status ? {status} : {}) };
}

function desiredCalls(q, coffeeCorner) {
  const calls = [];
  if (q.includes('列出') || q.includes('对象') || q.includes('list')) calls.push({ name:'listObjects', args:{} });
  if (q.includes('椅子') || q.includes('chair')) {
    calls.push({ name:'searchAssets', args:{query:'chair'} });
    calls.push({ name:'spawnAsset', args:{assetId:'chair',position:[1.8,0,0]} });
  }
  if (q.includes('打开') || q.includes('open')) calls.push({ name:'approachAndInteract', args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'} });
  if (q.includes('关闭') || q.includes('close')) calls.push({ name:'approachAndInteract', args:{actorId:'agent_01',targetId:'cabinet_01',action:'close'} });
  if (q.includes('拿') || q.includes('取') || q.includes('pickup') || q.includes('pick up')) calls.push({ name:'approachAndPickup', args:{actorId:'agent_01',targetId:'cup_01'} });
  if (q.includes('放下') || q.includes('drop')) calls.push({ name:'dropHeld', args:{actorId:'agent_01'} });
  else if (q.includes('放') || q.includes('place')) calls.push({ name:'approachAndPlace', args:{actorId:'agent_01',supportId:'table_01'} });
  if (q.includes('咖啡角') || q.includes('coffee')) {
    calls.push({
      name:'executeBatch',
      args:{ calls:[
        { name:'moveObject', args:{id:'table_01',position:coffeeCorner.table} },
        { name:'moveObject', args:{id:'cabinet_01',position:coffeeCorner.cabinet} },
        { name:'place', args:{id:'cup_01',targetId:'table_01'} }
      ] }
    });
  }
  return calls;
}

export class LocalPlannerGateway {
  constructor({ coffeeCorner = DEFAULT_COFFEE_CORNER } = {}) { this.coffeeCorner = coffeeCorner; }
  isConfigured() { return true; }

  async complete({ messages }) {
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const q = String(user?.content || '').toLowerCase();
    const desired = desiredCalls(q, this.coffeeCorner);
    if (!desired.length) return { final:true, message:'本地模式无法规划这个请求。配置 LLM Gateway 后可使用自然语言多步规划。', toolCalls:[] };

    const toolMessages = messages.filter((message) => message.role === 'tool');
    const assistantCalls = new Map();
    for (const message of messages) if (message.role === 'assistant') {
      for (const call of message.toolCalls || []) assistantCalls.set(call.id,call);
    }
    for (const call of desired) {
      const matching = toolMessages
        .filter((message) => {
          if (message.name !== call.name) return false;
          const original = assistantCalls.get(message.toolCallId);
          return !original || sameArgs(original.args || {},call.args || {});
        })
        .map((message) => ({ message, value:parseToolContent(message) }));
      const latest = matching.at(-1);
      if (!latest) return { final:false, message:'', toolCalls:[{ id:`local_${toolMessages.length}`, ...call }] };
      const outcome = inferOutcome(latest.value);
      if (outcome.state === 'skipped') return { final:false, message:'', toolCalls:[{ id:`local_${toolMessages.length}`, ...call }] };
      if (ADVERSE.has(outcome.state)) {
        const detail = outcome.reason || outcome.status || outcome.state;
        return { final:true, message:`任务未完成：${call.name} → ${detail}。`, toolCalls:[] };
      }
      if (!COMPLETE.has(outcome.state)) return { final:true, message:`任务未验证完成：${call.name} → ${outcome.state}。`, toolCalls:[] };
    }
    return { final:true, message:'任务已按验证结果逐步执行完成。', toolCalls:[] };
  }
}
