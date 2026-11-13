// A declarative, project-owned behavior model. It never creates colliders or
// claims physics verification: visuals and persistence belong to Code Project.
const error = code => Object.assign(new Error(code), { code });
const keyName = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value);
const scalar = value => value === null || ['string', 'boolean'].includes(typeof value)
  || (typeof value === 'number' && Number.isFinite(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const assert = value => { if (!value) throw error('PROJECT_MACHINE_DEFINITION_INVALID'); };
const copy = value => structuredClone(value);
const ops = new Set(['eq', 'ne', 'lt', 'lte', 'gt', 'gte']);
const checkCount = (value, max) => Array.isArray(value) && value.length <= max;

function compileConditions(conditions, initial) {
  assert(checkCount(conditions, 16));
  return conditions.map(item => {
    assert(plain(item) && keyName(item.field) && Object.hasOwn(initial, item.field) && ops.has(item.op));
    const valueDefined = Object.hasOwn(item, 'value'), otherDefined = Object.hasOwn(item, 'other');
    assert(valueDefined !== otherDefined && Object.keys(item).every(k => ['field', 'op', 'value', 'other'].includes(k)));
    if (otherDefined) assert(keyName(item.other) && Object.hasOwn(initial, item.other));
    else assert(scalar(item.value));
    if (!['eq', 'ne'].includes(item.op)) {
      assert(typeof initial[item.field] === 'number');
      assert(otherDefined ? typeof initial[item.other] === 'number' : typeof item.value === 'number');
    }
    return copy(item);
  });
}

function compileEffects(effects, initial) {
  assert(checkCount(effects, 16) && effects.length > 0);
  const fields = new Set();
  return effects.map(item => {
    assert(plain(item) && keyName(item.field) && Object.hasOwn(initial, item.field) && !fields.has(item.field));
    assert(['set', 'add'].includes(item.op) && scalar(item.value));
    assert(Object.keys(item).every(k => ['field', 'op', 'value'].includes(k)));
    if (item.op === 'add') assert(typeof initial[item.field] === 'number' && typeof item.value === 'number');
    else assert(typeof initial[item.field] === typeof item.value
      && (initial[item.field] !== null || item.value === null));
    fields.add(item.field);
    return copy(item);
  });
}

export function compileProjectStateMachine({ initialState, transitions, timers = [], ranges = {} }) {
  assert(plain(initialState) && Object.keys(initialState).length > 0 && Object.keys(initialState).length <= 64);
  for (const [key, value] of Object.entries(initialState)) assert(keyName(key) && scalar(value));
  assert(plain(ranges) && Object.keys(ranges).every(key => Object.hasOwn(initialState, key)));
  const limits = {};
  for (const [key, range] of Object.entries(ranges)) {
    assert(typeof initialState[key] === 'number' && plain(range) && Object.keys(range).every(k=>['min','max'].includes(k)));
    assert(Number.isFinite(range.min) && Number.isFinite(range.max) && range.min <= range.max);
    limits[key] = copy(range);
  }
  assert(checkCount(transitions, 64) && transitions.length > 0);
  const compiled = new Map();
  const knownValues = new Map(Object.entries(initialState)
    .filter(([,value]) => typeof value !== 'number')
    .map(([key,value]) => [key, new Set([value])]));
  for (const item of transitions) {
    assert(plain(item) && keyName(item.name) && !compiled.has(item.name)
      && (item.description == null || typeof item.description === 'string')
      && (item.expose == null || typeof item.expose === 'boolean'));
    assert(Object.keys(item).every(k=>['name','description','expose','when','effects'].includes(k)));
    const effects = compileEffects(item.effects, initialState);
    for (const effect of effects) if (effect.op === 'set' && knownValues.has(effect.field)) {
      knownValues.get(effect.field).add(effect.value);
    }
    compiled.set(item.name, { name:item.name, description:item.description || '', expose:item.expose !== false,
      when:compileConditions(item.when || [], initialState), effects });
  }
  assert(checkCount(timers, 16));
  const usedTimerFields = new Set();
  const clocks = timers.map(item => {
    assert(plain(item) && keyName(item.field) && !usedTimerFields.has(item.field));
    assert(typeof initialState[item.field] === 'number' && Number.isFinite(item.rate) && item.rate > 0
      && Number.isFinite(item.max) && item.max >= initialState[item.field]);
    assert(Object.keys(item).every(k=>['field','rate','max','when','onComplete'].includes(k)));
    if (item.onComplete != null) assert(compiled.has(item.onComplete) && compiled.get(item.onComplete).expose === false);
    usedTimerFields.add(item.field);
    return {field:item.field,rate:item.rate,max:item.max,
      when:compileConditions(item.when || [], initialState),onComplete:item.onComplete || null};
  });
  const definition = { initial:copy(initialState), transitions:compiled, timers:clocks, ranges:limits, knownValues };
  validateProjectMachineState(definition, initialState);
  return definition;
}

export function validateProjectMachineState(definition, state) {
  if (!plain(state)) throw error('PROJECT_MACHINE_STATE_INVALID');
  const initial = definition.initial;
  if (Object.keys(state).length !== Object.keys(initial).length) throw error('PROJECT_MACHINE_STATE_INVALID');
  for (const [field, original] of Object.entries(initial)) {
    const value = state[field];
    if (!Object.hasOwn(state, field) || !scalar(value) || typeof value !== typeof original
      || (original === null && value !== null)) throw error('PROJECT_MACHINE_STATE_INVALID');
    const range = definition.ranges[field];
    if (range && (value < range.min || value > range.max)) throw error('PROJECT_MACHINE_STATE_INVALID');
    if (definition.knownValues.has(field) && !definition.knownValues.get(field).has(value)) {
      throw error('PROJECT_MACHINE_STATE_INVALID');
    }
  }
  return copy(state);
}

function eligible(when, state) {
  return when.every(c => {
    const value = c.other ? state[c.other] : c.value;
    switch (c.op) {
      case 'eq': return Object.is(state[c.field], value);
      case 'ne': return !Object.is(state[c.field], value);
      case 'lt': return state[c.field] < value;
      case 'lte': return state[c.field] <= value;
      case 'gt': return state[c.field] > value;
      case 'gte': return state[c.field] >= value;
      default: return false;
    }
  });
}

function step(definition, transition, state) {
  if (!eligible(transition.when, state)) throw error('PROJECT_MACHINE_GUARD_FAILED');
  const next = copy(state);
  for (const effect of transition.effects) {
    next[effect.field] = effect.op === 'add' ? next[effect.field] + effect.value : effect.value;
  }
  return validateProjectMachineState(definition, next);
}

export class ProjectStateMachine {
  constructor(config) {
    this.definition = compileProjectStateMachine(config);
    this.state = copy(this.definition.initial);
    this.object = config.object || null;
    this.onChange = config.onChange || null;
    this.verifyVisual = config.verifyVisual || null;
    assert(this.onChange == null || typeof this.onChange === 'function');
    assert(this.verifyVisual == null || typeof this.verifyVisual === 'function');
    this.sync(this.state, this.state, { kind:'initialize' });
  }

  read() { return copy(this.state); }
  available(name) {
    const action = this.definition.transitions.get(name);
    return Boolean(action?.expose && eligible(action.when, this.state));
  }
  sync(next, previous, meta) {
    const payload = copy(next), prior = copy(previous);
    const returned = this.onChange?.(payload, prior, meta);
    if (returned && typeof returned.then === 'function') throw error('PROJECT_MACHINE_ASYNC_CALLBACK_UNSUPPORTED');
    const check = this.verifyVisual?.(copy(next), {object:this.object,kind:meta.kind});
    if (check && typeof check.then === 'function') throw error('PROJECT_MACHINE_ASYNC_CALLBACK_UNSUPPORTED');
    if (this.verifyVisual && check !== true) throw error('PROJECT_MACHINE_VISUAL_UNVERIFIED');
  }
  commit(next, meta) {
    const previous = this.state;
    if (JSON.stringify(next) === JSON.stringify(previous)) return {changed:false,state:this.read()};
    try { this.sync(next, previous, meta); }
    catch (failure) {
      try { this.onChange?.(copy(previous), copy(next), {kind:'rollback'}); } catch { /* Preserve original error. */ }
      throw failure;
    }
    this.state = copy(next);
    return {changed:true,state:this.read()};
  }
  execute(name) {
    const action = this.definition.transitions.get(name);
    if (!action?.expose) throw error('PROJECT_MACHINE_ACTION_UNAVAILABLE');
    const next = step(this.definition, action, this.state);
    return {transition:name,...this.commit(next,{kind:'action',name})};
  }
  advance(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw error('PROJECT_MACHINE_CLOCK_INVALID');
    if (seconds === 0) return {changed:false,state:this.read()};
    let next = this.read(), completed = [];
    for (const timer of this.definition.timers) {
      if (!eligible(timer.when, next)) continue;
      const previous = next[timer.field];
      next[timer.field] = Math.min(timer.max, Number((previous + seconds * timer.rate).toFixed(9)));
      if (timer.onComplete && previous < timer.max && next[timer.field] >= timer.max) {
        next = step(this.definition, this.definition.transitions.get(timer.onComplete), next);
        completed.push(timer.onComplete);
      }
    }
    validateProjectMachineState(this.definition, next);
    return {...this.commit(next,{kind:'clock',seconds,completed}),completed};
  }
  validate(state) { return validateProjectMachineState(this.definition, state); }
  restore(state) {
    return this.commit(this.validate(state),{kind:'restore'});
  }
  listedActions() {
    return [...this.definition.transitions.values()].filter(action=>action.expose);
  }
}
