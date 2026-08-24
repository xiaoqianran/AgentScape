const DEFAULT_COFFEE_CORNER = { table:[4.8,0,4.2], cabinet:[2.4,0,4.2] };
const COMPLETE = new Set(['verified', 'accepted']);
const ADVERSE = new Set(['blocked', 'failed', 'unverified', 'requested', 'error', 'noop']);

const stableValue = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key)=>`${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const sameArgs = (a = {}, b = {}) => stableValue(a) === stableValue(b);
const callKey = (call) => `${call.name}:${stableValue(call.args || {})}`;

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

function desiredCalls(q, coffeeCorner, context = {}, toolMessages = [], assistantCalls = new Map()) {
  const calls = [];
  if (q.includes('列出') || q.includes('对象') || q.includes('list')) calls.push({ name:'listObjects', args:{} });
  if (q.includes('椅子') || q.includes('chair')) {
    calls.push({ name:'searchAssets', args:{query:'chair'} });
    calls.push({ name:'spawnAsset', args:{assetId:'chair',position:[1.8,0,0]} });
  }

  const pickupIndex = Math.min(...['拿','取','pickup','pick up'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0), Infinity);
  const interactionCalls = [
    ...(q.includes('打开') || q.includes('open') ? [{ index:Math.min(...['打开','open'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0)), call:{ name:'approachAndInteract', args:{actorId:'agent_01',targetId:'cabinet_01',action:'open'} } }] : []),
    ...(q.includes('关闭') || q.includes('close') ? [{ index:Math.min(...['关闭','close'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0)), call:{ name:'approachAndInteract', args:{actorId:'agent_01',targetId:'cabinet_01',action:'close'} } }] : [])
  ].sort((a,b)=>a.index-b.index).map((item)=>item.call);
  const interactionIndex = Math.min(...interactionCalls.map((call)=>call.args.action === 'open'
    ? Math.min(...['打开','open'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0))
    : Math.min(...['关闭','close'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0))), Infinity);
  const placeIndex = Math.min(...['放到','放在','放上','place'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0), Infinity);
  const dropIndex = Math.min(...['放下','drop'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0), Infinity);
  const pickupRequested = Number.isFinite(pickupIndex);
  const placeRequested = ['放到','放在','放上','放置','放桌','place'].some((value)=>q.includes(value));
  const carrying = context?.task?.actor?.carry?.status === 'held';
  const carriedId = context?.task?.actor?.carry?.targetId || 'cup_01';
  const carryMentioned = q.includes('拿着') || q.includes('手里') || q.includes('携带');
  const dropped = toolMessages.some((message)=>message.name === 'dropHeld' && inferOutcome(parseToolContent(message)).state === 'verified');
  const interactionPending = interactionCalls.some((call)=>!toolMessages.some((message)=>
    message.name === call.name
      && (!assistantCalls.get(message.toolCallId) || sameArgs(assistantCalls.get(message.toolCallId).args || {}, call.args || {}))
      && COMPLETE.has(inferOutcome(parseToolContent(message)).state)
  ));
  const pickupBeforeInteraction = pickupRequested && pickupIndex < interactionIndex;
  const needsReleaseBeforeInteraction = interactionPending
    && (carrying || carryMentioned || pickupBeforeInteraction || dropped);
  const repickupAfterInteraction = placeRequested && interactionCalls.length > 0
    && (pickupBeforeInteraction || (!pickupRequested && (carrying || carryMentioned || dropped)));
  const pickupCall = { name:'approachAndPickup', args:{actorId:'agent_01',targetId:carriedId} };
  const placeCall = { name:'approachAndPlace', args:{actorId:'agent_01',supportId:'table_01'} };

  if (needsReleaseBeforeInteraction) {
    if (pickupBeforeInteraction) calls.push(pickupCall);
    calls.push({ name:'dropHeld', args:{actorId:'agent_01'} });
    calls.push(...interactionCalls);
    if (repickupAfterInteraction) calls.push(pickupCall);
    if (placeRequested) calls.push(placeCall);
  } else {
    const ordered = [];
    if (interactionCalls.length) ordered.push({ index:interactionIndex, call:interactionCalls[0] }, ...interactionCalls.slice(1).map((call)=>({ index:call.args.action === 'open'
      ? Math.min(...['打开','open'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0))
      : Math.min(...['关闭','close'].map((value)=>q.indexOf(value)).filter((value)=>value >= 0)), call })));
    if (pickupRequested) ordered.push({ index:pickupIndex, call:pickupCall });
    if (Number.isFinite(dropIndex)) ordered.push({ index:dropIndex, call:{ name:'dropHeld', args:{actorId:'agent_01'} } });
    if (repickupAfterInteraction && placeRequested) ordered.push({ index:placeIndex - 0.5, call:pickupCall });
    if (placeRequested) ordered.push({ index:placeIndex, call:placeCall });
    ordered.sort((a,b)=>a.index-b.index).forEach(({call})=>calls.push(call));
  }
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

  async complete({ messages, context = {} }) {
    const user = [...messages].reverse().find((m) => m.role === 'user');
    const q = String(user?.content || '').toLowerCase();
    const toolMessages = messages.filter((message) => message.role === 'tool');
    const assistantCalls = new Map();
    for (const message of messages) if (message.role === 'assistant') {
      for (const call of message.toolCalls || []) assistantCalls.set(call.id,call);
    }
    const desired = desiredCalls(q, this.coffeeCorner, context, toolMessages, assistantCalls);
    if (!desired.length) return { final:true, message:'本地模式无法规划这个请求。配置 LLM Gateway 后可使用自然语言多步规划。', toolCalls:[] };

    const occurrences = new Map();
    for (const call of desired) {
      const key = callKey(call);
      const occurrence = occurrences.get(key) || 0;
      occurrences.set(key, occurrence + 1);
      const matching = toolMessages
        .filter((message) => {
          if (message.name !== call.name) return false;
          const original = assistantCalls.get(message.toolCallId);
          return !original || sameArgs(original.args || {},call.args || {});
        })
        .map((message) => ({ message, value:parseToolContent(message) }));
      const latest = matching[occurrence];
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
