import {
  addAgentTool,
  applyAgentSequence,
  createAgentJourney,
  finalizeAgentJourney,
  journeyRunDetail
} from '../../agent/AgentJourney.js';
import { GENERATED_PLACEMENT_TASK } from '../../agent/QuickTasks.js';

const initialStatus = () => ({
  state:'ready',
  label:'就绪',
  detail:'选择常用任务，或在下方描述你自己的目标。',
  action:null
});

export class TaskPanel {
  constructor({ setView = () => {}, onRun = () => {}, onOpenSettings = () => {}, demoRunners = {}, runtimeTestRunner = null } = {}) {
    this.setView = setView;
    this.onRun = onRun;
    this.onOpenSettings = onOpenSettings;
    this.demoRunners = demoRunners;
    this.runtimeTestRunner = runtimeTestRunner;
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
    this.viewSnapshot = this.#snapshot();
  }

  #snapshot() {
    return Object.freeze({
      busy:this.busy,
      available:this.available,
      activeTaskKey:this.activeTaskKey,
      activityCount:this.activityCount,
      status:this.status,
      journey:this.journey,
      logs:this.logs
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
    this.setView('task');
    return this.execute(prompt,prompt.length > 54 ? `${prompt.slice(0,54)}…` : prompt);
  }

  async runQuickTask(task) {
    if (!task || this.busy) return null;
    this.setView('task');
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
    this.beginJourney(prompt,label,demoId ? null : 'agent');
    this.setBusy(true,sourceKey);
    this.setState('running','正在执行任务',label);

    try {
      const demoRunner = demoId ? this.demoRunners?.[demoId] : null;
      const result = demoRunner ? await demoRunner.run(GENERATED_PLACEMENT_TASK) : await this.agent.run(prompt);
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
        this.setState('partial','任务部分完成',`${label} · ${tool} → ${outcome}`);
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
      this.setBusy(false);
    }
  }

  dispose() {
    this.listeners.clear();
  }
}
