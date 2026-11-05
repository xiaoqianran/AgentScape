import {
  addAgentTool,
  applyAgentSequence,
  createAgentJourney,
  finalizeAgentJourney,
  journeyRunDetail
} from '../../agent/AgentJourney.js';
import { GENERATED_PLACEMENT_TASK } from '../../agent/QuickTasks.js';
import { createCabinetCupTaskWorldIR, inspectCabinetCupTask } from '../../../../application/tasks/CabinetCupTask.js';

const initialStatus = () => ({
  state:'ready',
  label:'就绪',
  detail:'选择常用任务，或在下方描述你自己的目标。',
  action:null
});

export class TaskPanel {
  constructor({ setView = () => {}, onRun = () => {}, onOpenSettings = () => {}, demoRunners = {}, runtimeTestRunner = null,
    getActors=()=>({agents:[],selected:null}),onSelectActor=()=>{} } = {}) {
    this.setView = setView;
    this.onRun = onRun;
    this.onOpenSettings = onOpenSettings;
    this.demoRunners = demoRunners;
    this.runtimeTestRunner = runtimeTestRunner;
    this.getActors=getActors;this.onSelectActor=onSelectActor;
    this.agent = null;
    this.gateway = null;
    this.busy = false;
    this.available = true;
    this.activeTaskKey = null;
    this.activityCount = 0;
    this.journey = null;
    this.journeySource = null;
    this.status = initialStatus();
    this.logs = [];
    this.listeners = new Set();
    this.sequence = 0;
    this.abortController = null;
    this.lastRequest = null;
    this.standardTask = null;
    this.viewSnapshot = this.#snapshot();
  }

  #snapshot() {
    return Object.freeze({
      busy:this.busy,
      actors:this.getActors(),
      available:this.available,
      activeTaskKey:this.activeTaskKey,
      activityCount:this.activityCount,
      status:this.status,
      journey:this.journey,
      logs:this.logs,
      standardTask:this.standardTask,
      canCancel:Boolean(this.abortController) && !this.abortController.signal.aborted,
      canRetry:Boolean(this.lastRequest) && !this.busy && this.available
    });
  }

  emit() {
    this.viewSnapshot = this.#snapshot();
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.viewSnapshot;
  selectActor(actor) {if(this.busy)return;try{this.onSelectActor(actor);this.emit();}catch(error){this.setState('error','无法切换 Agent',error.message);}}

  attachAgent({ agent, gateway }) {
    this.agent = agent;
    this.gateway = gateway;
    this.setAvailability(gateway?.isConfigured?.() ?? true);
  }

  setOpenSettingsHandler(handler) {
    this.onOpenSettings = handler || (() => {});
    this.emit();
  }

  openSettings() {
    this.onOpenSettings();
  }

  setAvailability(available) {
    this.available = Boolean(available);
    if (!this.busy) {
      if (this.available) this.setState('ready','就绪','选择常用任务，或在下方描述你自己的目标。');
      else this.setState('offline','LLM Agent 未连接','Runtime 验收仍可直接运行；自然语言任务需要配置 Agent Gateway。',{ action:'配置' });
      return;
    }
    this.emit();
  }

  setState(state,label,detail,{ action = null } = {}) {
    this.status = Object.freeze({ state, label, detail, action });
    this.emit();
  }

  setBusy(busy, sourceKey = null) {
    this.busy = Boolean(busy);
    this.activeTaskKey = this.busy ? sourceKey : null;
    this.emit();
  }

  beginJourney(intent,label='任务',source=null) {
    this.journey = createAgentJourney(intent,label);
    this.journeySource = source;
    this.renderJourney();
    return this.journey;
  }

  observeAgentTool(event) {
    if (!this.busy || !this.journey) return;
    if (this.journeySource && event?.source !== this.journeySource) return;
    this.journey = addAgentTool(this.journey,event);
    this.renderJourney();
  }

  observeAgentSequence(event) {
    if (!this.busy || !this.journey) return;
    if (this.journeySource && event?.source !== this.journeySource) return;
    this.journey = applyAgentSequence(this.journey,event);
    this.renderJourney();
  }

  finishJourney({ result = null, status = 'success', detail = '' } = {}) {
    if (!this.journey) return null;
    this.journey = finalizeAgentJourney(this.journey,{ result, status, detail });
    this.renderJourney();
    return structuredClone(this.journey);
  }

  renderJourney() {
    this.emit();
  }

  log(text,kind='') {
    const entry = Object.freeze({ id:++this.sequence, text:String(text), kind:String(kind || '') });
    this.logs = [...this.logs, entry].slice(-80);
    this.activityCount = Math.min(this.activityCount + 1,99);
    this.emit();
  }

  markActivityRead() {
    if (!this.activityCount) return;
    this.activityCount = 0;
    this.emit();
  }

  recordRun(run) {
    try {
      this.onRun(run);
    } catch (error) {
      try { this.log(`执行记录错误：${error?.message || '未知错误'}`,'error'); } catch {}
    }
  }

  async submit(value) {
    const prompt = String(value || '').trim();
    if (!prompt || this.busy) return null;
    this.setView('world-task');
    return this.execute(prompt,prompt.length > 54 ? `${prompt.slice(0,54)}…` : prompt);
  }

  async checkStandardTask() {
    if (this.busy || !this.agent?.tools?.runtime) return null;
    this.setBusy(true,'standard-task-check');
    try {
      this.standardTask = await inspectCabinetCupTask(this.agent.tools.runtime);
      this.emit();
      return this.standardTask;
    } catch (error) {
      this.standardTask = {supported:false,reasons:[{code:error.code || 'TASK_INSPECTION_FAILED',message:error.message}]};
      this.emit();
      return this.standardTask;
    } finally { this.setBusy(false); }
  }

  async prepareStandardTask() {
    if (this.busy || !this.agent?.tools?.runtime) return null;
    this.setView('world-task');
    this.setBusy(true,'standard-task-prepare');
    this.standardTask = null;
    this.setState('running','正在准备标准场景','使用内置资产替换当前场景对象；完成后可以撤销。');
    try {
      const world = this.agent.tools.runtime;
      const plan = createCabinetCupTaskWorldIR(world.environment?.id,{revisionId:`cabinet-cup-${globalThis.crypto.randomUUID()}`});
      // A user-selected, authored preset still goes through Skill authorization,
      // canonical compilation, admission and the Runtime mutation transaction.
      const result = await this.agent.tools.call('runWorldPipeline',{plan});
      if (!['world-ready','world-provisional'].includes(result.status)) {
        const error = new Error(`标准场景准备失败：${result.reason || result.status}；原场景已保留。`);
        error.code = result.reason || 'TASK_SCENE_REJECTED';
        throw error;
      }
      this.standardTask = {...await inspectCabinetCupTask(world),admission:result.status};
      this.lastRequest = null;
      this.journey = null;
      this.setState('ready','标准场景已准备',`请检查条件后开始柜内取杯任务。场景准入：${result.status}；任务完成仍需实际执行验证。`);
      return this.standardTask;
    } catch (error) {
      this.standardTask = {supported:false,reasons:[{code:error.code || 'TASK_SCENE_FAILED',message:error.message}]};
      this.setState('error','无法准备标准场景',error.message);
      return null;
    } finally { this.setBusy(false); }
  }

  async runStandardTask() {
    if (this.busy || !this.available) return null;
    const inspection = await this.checkStandardTask();
    if (!inspection?.supported) return null;
    return this.submit('把 cabinet_01 柜子里面的 cup_01 杯子放到 table_01 桌面的 top 支撑面上。由 agent_01 先打开柜门，再拿起、搬运、放置并确认支撑与稳定；每一步失败都不要继续后续动作。');
  }

  async runQuickTask(task) {
    if (!task || this.busy) return null;
    this.setView('world-task');
    const label = task.title || '任务';
    const key = task.id || task.demo || task.prompt || label;
    if (task.id) return this.executeRuntimeTest(task.id,label,key);
    return this.execute(task.prompt,label,key,task.demo || null);
  }

  async executeRuntimeTest(testId,label='Runtime 验收',sourceKey=null) {
    if (this.busy) return null;
    if (!this.runtimeTestRunner) {
      this.setState('error','Runtime 测试不可用','Agent Runtime Test Runner 未配置。');
      return null;
    }
    const startedAt = performance.now();
    const runId = `runtime_${Date.now().toString(36)}`;
    this.beginJourney(label,`Runtime · ${label}`,'runtime-test');
    this.setBusy(true,sourceKey);
    this.setState('running','正在执行 Runtime 验收',label);
    try {
      const result = await this.runtimeTestRunner.run(testId);
      this.setState('success','Runtime 验收通过',`${label} · 不依赖 LLM。`);
      this.log(`Runtime 验收通过：${label}`,'result');
      const journey = this.finishJourney({ result, status:'success', detail:'确定性 Runtime 工具链验证通过。' });
      this.recordRun({ id:runId, title:`Runtime · ${label}`, prompt:testId, status:'success', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return result;
    } catch (error) {
      this.setState('error','Runtime 验收失败',error.message);
      this.log(`Runtime 验收失败：${error.message}`,'error');
      const journey = this.finishJourney({ status:'error', detail:error.message });
      this.recordRun({ id:runId, title:`Runtime · ${label}`, prompt:testId, status:'error', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return null;
    } finally {
      this.setBusy(false);
    }
  }

  async execute(prompt,label='任务',sourceKey=null,demoId=null) {
    if (this.busy) return null;
    if (!this.available || !this.agent) {
      this.setState('offline','智能体不可用','智能体能力当前不可用；由部署适配器提供，无需在浏览器填写地址。',{ action:'配置' });
      return null;
    }

    const startedAt = performance.now();
    const runId = `run_${Date.now().toString(36)}`;
    this.abortController = demoId ? null : new AbortController();
    this.lastRequest = demoId ? null : { prompt,label };
    this.beginJourney(prompt,label,demoId ? null : 'agent');
    this.setBusy(true,sourceKey);
    this.setState('running','正在执行任务',label);

    try {
      const demoRunner = demoId ? this.demoRunners?.[demoId] : null;
      const result = demoRunner ? await demoRunner.run(GENERATED_PLACEMENT_TASK) : await this.agent.run(prompt,{ signal:this.abortController.signal });
      if (result.taskStatus === 'cancelled') {
        const detail = result.message || '任务已停止；已完成的世界变化已保留。';
        this.setState('cancelled','任务已停止',detail);
        const journey=this.finishJourney({ result,status:'cancelled',detail });
        this.recordRun({id:runId,title:label,prompt,status:'cancelled',durationMs:performance.now()-startedAt,detail:journeyRunDetail(journey),journey});
        return result;
      }
      const executedSteps = (result.execution || []).filter((entry) => entry.executed !== false);
      const lastStep = result.lastMutation || executedSteps.at(-1) || null;
      const tool = lastStep?.tool || 'query';
      const outcome = lastStep?.outcome?.state || result.taskStatus || 'unknown';
      const unresolved = result.unresolvedMutations || [];
      const message = String(result.message || '');
      const failedMessage = /incomplete|exceeded|失败|error/i.test(message) && result.taskStatus !== 'completed';
      // 只读查询（如 listInteractablesNearMe）没有 mutation，不应被误判为未完成。
      const readOnlyAnswered = result.taskStatus === 'no-mutation'
        && !unresolved.length
        && Boolean(message)
        && !failedMessage
        && executedSteps.length > 0
        && executedSteps.every((entry) => entry.mutates !== true);
      const completed = result.taskStatus === 'completed'
        || result.status === 'completed'
        || readOnlyAnswered;
      if (completed) {
        if (readOnlyAnswered) {
          this.setState('success','查询完成',`${label} · ${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`);
          this.log('任务状态：查询完成 · 只读工具已返回结果','result');
        } else {
          this.setState('success','任务已完成',`${label} · 运行时验证通过。`);
          this.log('任务状态：已完成 · 变更链已验证','result');
        }
      } else {
        this.setState('partial','任务未完成',`${label} · ${tool} → ${lastStep?.outcome?.reason || outcome}。请检查对象、通路和支撑面后重试；重试会重新观察世界。`);
        this.log(`任务状态：未完成 · ${tool} → ${outcome}`,'error');
      }
      const status = completed ? 'success' : 'partial';
      const detail = completed ? (message || '运行时验证通过。') : `${tool} → ${outcome}`;
      const journey = this.finishJourney({ result, status, detail });
      this.recordRun({ id:runId, title:label, prompt, status, durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return result;
    } catch (error) {
      this.setState('error','任务执行失败',error.message);
      this.log(`错误：${error.message}`,'error');
      const journey = this.finishJourney({ status:'error', detail:error.message });
      this.recordRun({ id:runId, title:label, prompt, status:'error', durationMs:performance.now()-startedAt, detail:journeyRunDetail(journey), journey });
      return null;
    } finally {
      this.abortController = null;
      this.setBusy(false);
    }
  }

  cancel() {
    if (!this.busy || !this.abortController || this.abortController.signal.aborted) return false;
    this.abortController.abort();
    this.setState('cancelling','正在取消','已请求停止；当前动作将在安全边界结束，不再开始后续动作。已完成的变化和持有物会保留。');
    return true;
  }

  retry() {
    if (!this.lastRequest || this.busy) return null;
    this.setView('world-task');
    return this.execute(this.lastRequest.prompt,this.lastRequest.label);
  }

  focusCurrentTarget() {
    const world=this.agent?.tools?.runtime;
    const active=this.journey?.actions?.at(-1)?.args;
    const id=active?.targetId || active?.supportId || active?.id;
    if (!id || !world?.queries?.hasObject?.(id)) return false;
    const bounds=id && world?.queries?.getBounds?.(id);
    if (!bounds?.center) return false;
    const [x,y,z]=bounds.center;
    world.rendering?.applyCameraState?.({position:[x+3,y+2.5,z+4],target:[x,y,z]});
    return true;
  }

  dispose() {
    this.abortController?.abort();
    this.listeners.clear();
  }
}
