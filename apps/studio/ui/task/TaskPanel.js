import { generatedPlacementDemoTask } from '../../demos/generated-placement/generatedPlacementDemo.js';
import { AGENT_RUNTIME_TESTS } from '../../agent/AgentRuntimeTestRunner.js';
import {
  addAgentTool,
  applyAgentSequence,
  createAgentJourney,
  finalizeAgentJourney,
  journeyRunDetail
} from './AgentJourney.js';

const GENERATED_PLACEMENT_TASK = generatedPlacementDemoTask();

export const QUICK_TASK_GROUPS = Object.freeze([
  {
    label:'Runtime 验收',
    tasks:AGENT_RUNTIME_TESTS
  },
  {
    label:'常用任务',
    tasks:[
      { title:'拿起杯子', detail:'走到杯子前并安全拿起', prompt:'让 agent_01 走到 cup_01 前并拿起杯子' },
      { title:'把杯子放到桌上', detail:'放到桌面并确认稳定', prompt:'让 agent_01 先拿起 cup_01，再把它放到 table_01 上并确认稳定' },
      { title:'打开柜门', detail:'走到柜子前并确认打开', prompt:'让 agent_01 走到 cabinet_01 前并打开柜门' },
      { title:'放下手中物体', detail:'释放当前手持物体', prompt:'让 agent_01 放下当前拿着的物体' }
    ]
  },
  {
    label:'流程任务',
    tasks:[
      { title:GENERATED_PLACEMENT_TASK.title, detail:GENERATED_PLACEMENT_TASK.detail, prompt:GENERATED_PLACEMENT_TASK.prompt, demo:GENERATED_PLACEMENT_TASK.id, wide:true },
      { title:'完成具身任务', detail:'打开 → 拿起 → 放置 → 验证', prompt:'让 agent_01 打开 cabinet_01，确认柜门完成打开后拿起 cup_01，再把杯子放到 table_01 上；每一步失败都不要继续后续动作', wide:true },
      { title:'建立咖啡角', detail:'让智能体规划完整场景流程', prompt:'建立一个咖啡角', wide:true }
    ]
  }
]);

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
      const completed = result.taskStatus === 'completed' || result.status === 'completed';
      const tool = result.lastMutation?.tool || 'mutation';
      const outcome = result.lastMutation?.outcome?.state || 'unknown';
      if (completed) {
        this.setState('success','任务已完成',`${label} · 运行时验证通过。`);
        this.log('任务状态：已完成 · 变更链已验证','result');
      } else {
        this.setState('partial','任务部分完成',`${label} · ${tool} → ${outcome}`);
        this.log(`任务状态：未完成 · ${tool} → ${outcome}`,'error');
      }
      const status = completed ? 'success' : 'partial';
      const detail = completed ? (result.message || '运行时验证通过。') : `${tool} → ${outcome}`;
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
