const MAX_ACTIONS = 12;
const MAX_CHANGES = 8;
const MUTATION_TOOLS = new Set([
  'navigateTo',
  'approachAndPickup',
  'approachAndPlace',
  'approachAndInteract',
  'executeWorldAction',
  'spawnAsset',
  'removeObject',
  'duplicateObject',
  'setTransform',
  'applyImpulse',
  'runWorldPipeline',
  'recompileWorldRevision',
  'buildGeneratedHybridWorld',
  'recoverPickupBlocker',
  'recoverArticulatedBlocker',
  'cleanupRecoveryBlocker'
]);

const ACTION_LABELS = Object.freeze({
  listObjects:'查看世界对象',
  inspectObject:'检查对象',
  findInteractionPose:'寻找可执行位置',
  getNavigationStatus:'检查导航状态',
  getLocomotionStatus:'检查移动状态',
  getCarryStatus:'检查手持状态',
  getArticulationStatus:'检查关节状态',
  inspectWorldAffordance:'检查世界交互点',
  listWorldAffordances:'查看世界交互点',
  navigateTo:'移动到目标位置',
  approachAndPickup:'走近并拿起',
  approachAndPlace:'走近并放置',
  approachAndInteract:'走近并交互',
  executeWorldAction:'执行世界动作',
  spawnAsset:'放置资产',
  removeObject:'移除对象',
  duplicateObject:'复制对象',
  setTransform:'调整对象',
  applyImpulse:'施加物理作用',
  proposeWorldIR:'规划世界',
  proposeWorldRevision:'规划世界修订',
  runWorldPipeline:'应用世界方案',
  recompileWorldRevision:'应用世界修订',
  buildGeneratedHybridWorld:'生成并打开世界',
  recoverPickupBlocker:'处理拿取阻挡',
  recoverArticulatedBlocker:'处理交互阻挡',
  cleanupRecoveryBlocker:'清理恢复对象'
});

const OUTCOME_LABELS = Object.freeze({
  verified:'已验证',
  accepted:'已接受',
  completed:'已完成',
  success:'已完成',
  blocked:'受阻',
  rejected:'未通过',
  failed:'失败',
  error:'失败',
  skipped:'已跳过',
  unknown:'状态未知'
});

const INTERACTION_LABELS = Object.freeze({
  open:'打开',
  close:'关闭',
  pickup:'拿起',
  place:'放置',
  drop:'放下',
  toggle:'切换',
  activate:'启动',
  deactivate:'关闭'
});

const pick = (args, ...keys) => {
  for (const key of keys) if (args?.[key] != null && args[key] !== '') return String(args[key]);
  return '';
};

const words = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replaceAll('_', ' ')
  .trim();

export function actionLabel(tool, args = {}) {
  const base = ACTION_LABELS[tool] || words(tool) || '执行动作';
  const actor = pick(args, 'actorId', 'agentId');
  const target = pick(args, 'targetId', 'id', 'instanceId', 'assetId');
  const support = pick(args, 'supportId', 'surfaceId');
  const action = pick(args, 'action');

  if (tool === 'approachAndPickup') return target ? `拿起 ${target}` : base;
  if (tool === 'approachAndPlace') {
    const object = target || '手中物体';
    return support ? `把 ${object} 放到 ${support}` : `放置 ${object}`;
  }
  if (tool === 'approachAndInteract') {
    if (target && action) return `${INTERACTION_LABELS[action] || action} ${target}`;
    return target ? `与 ${target} 交互` : base;
  }
  if (tool === 'executeWorldAction') {
    const id = pick(args, 'affordanceId', 'targetId', 'id');
    return [INTERACTION_LABELS[action] || action || '执行动作', id].filter(Boolean).join(' ');
  }
  if (tool === 'navigateTo') return target ? `移动到 ${target}` : base;
  if (tool === 'spawnAsset') {
    const asset = pick(args, 'assetId') || '资产';
    const instance = pick(args, 'instanceId');
    return instance ? `放置 ${asset} · ${instance}` : `放置 ${asset}`;
  }
  if (tool === 'removeObject') return target ? `移除 ${target}` : base;
  if (tool === 'duplicateObject') return target ? `复制 ${target}` : base;
  if (tool === 'setTransform') return target ? `调整 ${target}` : base;
  if (tool === 'runWorldPipeline') return '应用新的世界方案';
  if (tool === 'recompileWorldRevision') return '应用世界修订';
  if (tool === 'buildGeneratedHybridWorld') return '生成并替换当前世界';
  if (actor && target) return `${base} · ${actor} → ${target}`;
  if (target) return `${base} · ${target}`;
  return base;
}

export function outcomeLabel(outcome) {
  const state = typeof outcome === 'string' ? outcome : outcome?.state;
  return OUTCOME_LABELS[state] || words(state) || OUTCOME_LABELS.unknown;
}

const actionState = (entry) => {
  if (entry.executed === false || entry.outcome?.state === 'skipped') return 'skipped';
  const state = entry.outcome?.state;
  if (['verified','accepted','completed','success'].includes(state)) return 'success';
  if (['error','failed','blocked','rejected'].includes(state)) return 'error';
  return entry.executed === false ? 'skipped' : 'done';
};

const changeState = (entry) => {
  const state = entry.outcome?.state;
  if (['verified','accepted','completed','success'].includes(state)) return 'success';
  if (['error','failed','blocked','rejected'].includes(state)) return 'error';
  return state === 'skipped' ? 'skipped' : 'done';
};

export function createAgentJourney(intent = '', label = '任务') {
  return {
    intent:String(intent || '').trim(),
    label:String(label || '任务'),
    state:'running',
    actions:[],
    changes:[],
    result:{ state:'running', label:'执行中', detail:'Agent 正在根据最新世界状态规划下一步。' }
  };
}

export function addAgentTool(journey, event = {}) {
  if (!journey || journey.state !== 'running' || !event.name) return journey;
  const actions = [...journey.actions, {
    tool:event.name,
    args:event.args ? structuredClone(event.args) : {},
    label:actionLabel(event.name, event.args),
    state:'running',
    outcome:null
  }].slice(-MAX_ACTIONS);
  return { ...journey, actions };
}

export function applyAgentSequence(journey, event = {}) {
  if (!journey || journey.state !== 'running') return journey;
  let actions = journey.actions;
  if (event.tool) {
    const index = [...actions].map((entry) => entry.tool).lastIndexOf(event.tool);
    if (index >= 0) {
      actions = actions.map((entry, position) => position === index ? {
        ...entry,
        state:actionState(event),
        outcome:event.outcome ? structuredClone(event.outcome) : entry.outcome
      } : entry);
    }
  }

  let changes = journey.changes;
  if (event.tool && event.executed !== false && event.mutates) {
    changes = [...changes, {
      tool:event.tool,
      label:actionLabel(event.tool, event.args),
      state:changeState(event),
      outcome:event.outcome ? structuredClone(event.outcome) : null,
      detail:outcomeLabel(event.outcome)
    }].slice(-MAX_CHANGES);
  }

  return { ...journey, actions, changes };
}

function executionActions(execution = []) {
  return execution.slice(-MAX_ACTIONS).map((entry) => ({
    tool:entry.tool,
    args:entry.args ? structuredClone(entry.args) : {},
    label:actionLabel(entry.tool, entry.args),
    state:actionState(entry),
    outcome:entry.outcome ? structuredClone(entry.outcome) : null
  }));
}

function executionChanges(execution = []) {
  return execution
    .filter((entry) => entry.executed !== false && entry.mutates)
    .slice(-MAX_CHANGES)
    .map((entry) => ({
      tool:entry.tool,
      label:actionLabel(entry.tool, entry.args),
      state:changeState(entry),
      outcome:entry.outcome ? structuredClone(entry.outcome) : null,
      detail:outcomeLabel(entry.outcome)
    }));
}

export function finalizeAgentJourney(journey, {
  result = null,
  status = 'success',
  detail = ''
} = {}) {
  if (!journey) return null;
  const execution = Array.isArray(result?.execution) ? result.execution : null;
  const actions = execution ? executionActions(execution) : journey.actions.map((entry) => ({
    ...entry,
    state:entry.state === 'running' ? (status === 'success' ? 'success' : status === 'error' ? 'error' : 'done') : entry.state
  }));
  const derivedChanges = execution
    ? executionChanges(execution)
    : journey.changes.length
      ? journey.changes
      : status === 'success'
        ? actions
          .filter((entry) => MUTATION_TOOLS.has(entry.tool))
          .slice(-MAX_CHANGES)
          .map((entry) => ({
            tool:entry.tool,
            label:entry.label,
            state:'success',
            outcome:{ state:'verified', verified:true },
            detail:'已验证'
          }))
        : journey.changes;
  const message = String(detail || result?.message || '').trim();

  const resultCopy = status === 'success'
    ? { state:'success', label:'成功', detail:message || '世界状态已经验证。' }
    : status === 'partial'
      ? { state:'partial', label:'部分完成', detail:message || '部分世界变化未能完成验证。' }
      : { state:'error', label:'失败', detail:message || '任务执行失败。' };

  return {
    ...journey,
    state:status,
    actions,
    changes:derivedChanges,
    result:resultCopy
  };
}

export function journeyRunDetail(journey) {
  if (!journey) return '';
  const actionCount = journey.actions.length;
  const changeCount = journey.changes.length;
  const outcome = journey.result?.label || '未知';
  return `${actionCount} 个动作 · ${changeCount} 个世界变化 · ${outcome}`;
}
