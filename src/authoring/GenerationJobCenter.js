const ACTIVE_STATUSES=new Set(['generation-pending','generation-cancelling','connection-required']);
const text=(value,fallback='—')=>value==null||value===''?fallback:String(value);
const clone=(value)=>value==null?value:structuredClone(value);

export const generationJobCenterMarkup=()=>`
<section class="generation-console" aria-label="生成任务中心">
  <div class="generation-heading"><div><div class="eyebrow">创建</div><h2>创建资产</h2><p>生成内容、完成验证，然后将资产加入当前世界。</p></div><span id="generation-connector-badge" class="generation-badge">连接</span></div>
  <div id="generation-state" class="generation-state" data-state="connection-required"><strong id="generation-state-label">连接器未配置</strong><span id="generation-state-detail">配置本机连接器后才能提交或恢复生成任务。</span></div>
  <div class="generation-scroll">
    <details class="generation-section"><summary>连接器</summary><div class="generation-section-body">
      <label>连接器地址<input id="generation-connector-endpoint" type="url" placeholder="http://127.0.0.1:3210" /></label>
      <div class="generation-inline-actions"><button id="generation-save-endpoint" type="button">保存并重新加载</button><button id="generation-pair" type="button">配对 / 恢复</button><button id="generation-revoke" type="button" class="danger">撤销</button></div>
      <small id="generation-pairing-hint">凭据只由本机连接器会话管理；浏览器不保存提供方密钥。</small>
    </div></details>
    <details class="generation-section" open><summary>创建设置</summary><div class="generation-section-body">
      <label>提供方<select id="generation-provider"></select></label><label>能力<select id="generation-operation"></select></label>
      <div id="generation-capability-hint" class="generation-capability-hint">暂无可用生成能力。</div>
      <label>配置档<input id="generation-profile" placeholder="可选配置档" /></label>
      <label>输入参数<textarea id="generation-inputs" rows="4" spellcheck="false">{"prompt":""}</textarea></label><small>输入参数遵循所选能力的契约；更底层的提供方信息仍可按需查看。</small>
      <label>资产 ID<input id="generation-asset-id" placeholder="generated_asset_01" /></label>
      <label class="generation-confirm"><input id="generation-cost-confirm" type="checkbox" />我确认这会创建外部生成任务，可能产生费用。</label>
      <button id="generation-submit" type="button" class="generation-primary">开始生成</button>
      <small>这里只显示提供方声明的成本等级和时长等级，不伪造价格或耗时；确认状态不会跨生成任务持久化。</small>
    </div></details>
    <details id="generation-jobs-disclosure" class="generation-section generation-jobs-section"><summary>最近生成任务</summary><div class="generation-section-body">
      <div class="generation-section-title"><small>提供方生成任务历史</small><button id="generation-refresh" type="button">刷新</button></div>
      <div id="generation-job-list" class="generation-job-list"></div>
    </div></details>
    <details id="generation-result-disclosure" class="generation-section"><summary>结果 / 详情 <small id="generation-selected-id">未选择</small></summary><div class="generation-section-body">
      <div id="generation-job-detail" class="generation-job-detail">选择一个生成任务，查看进度、产物完整性与世界就绪状态。</div>
      <label>编译资产 ID<input id="generation-compile-asset-id" placeholder="generated_asset_01" /></label>
      <div class="generation-inline-actions generation-job-actions"><button id="generation-job-refresh" type="button">刷新任务</button><button id="generation-job-cancel" type="button">取消</button><button id="generation-job-import" type="button">导入产物</button><button id="generation-job-compile" type="button">编译 / 注册</button></div>
      <div class="generation-inline-actions generation-product-actions"><button id="generation-job-spawn" type="button" disabled>加入世界</button></div>
      <div id="generation-result-report" class="generation-result-report">生成完成不代表可以直接进入世界；必须先通过编译与准入检查，才能加入世界。</div>
    </div></details>
  </div>
</section>`;

export function parseGenerationInputs(value) {
  const source=String(value??'').trim(); if (!source) return {};
  let parsed; try { parsed=JSON.parse(source); } catch { throw new Error('Inputs JSON 格式无效'); }
  if (!parsed||typeof parsed!=='object'||Array.isArray(parsed)) throw new Error('Inputs JSON 必须是 object');
  return parsed;
}

export function generationStatusLabel(status) {
  return ({'generation-pending':'生成中','generation-cancelling':'取消中','provider-succeeded':'提供方已完成','generation-failed':'生成失败','generation-cancelled':'已取消','generation-expired':'已过期','connection-required':'需要连接','generation-unknown':'未知状态'})[status]||text(status,'未知状态');
}

export function generationJobActions(job,outcome=null) {
  const providerSucceeded=job?.status==='provider-succeeded';
  const compiled=outcome?.status==='asset-ready'||outcome?.status==='asset-provisional';
  return {canRefresh:Boolean(job?.jobId),canCancel:Boolean(job?.jobId)&&ACTIVE_STATUSES.has(job.status)&&job.status!=='connection-required',canImport:Boolean(job?.jobId)&&providerSucceeded,canCompile:Boolean(job?.jobId)&&providerSucceeded,canSpawn:compiled};
}

export function capabilityHint(capability) {
  if (!capability) return '暂无可用生成能力。';
  const duration=executionClassLabel(capability.execution?.durationClass||'unspecified'), cost=executionClassLabel(capability.execution?.costClass||'unspecified');
  const connection=capability.connectionRequired?'需要连接器会话':'未声明连接器前置条件';
  const auth=executionClassLabel(capability.prerequisites?.authMode||'none');
  const schemaRaw=capability.input?.schema?.id||capability.input?.schema?.title||capability.input?.types?.join(', ')||'通用输入'; const schema=executionClassLabel(schemaRaw);
  const profiles=Object.keys(capability.profiles||{}); const profileText=profiles.length?` · 配置档 ${profiles.join(', ')}`:'';
  return `${capability.operation} · 输入 ${schema}${profileText} · 时长等级 ${duration} · 成本等级 ${cost} · 鉴权 ${auth} · ${connection}`;
}

function el(tag,className=null,content=null){const node=document.createElement(tag);if(className)node.className=className;if(content!=null)node.textContent=String(content);return node;}
function option(value,label){const node=document.createElement('option');node.value=value;node.textContent=label;return node;}

function availabilityLabel(status){return ({available:'可用',unavailable:'不可用',disabled:'已禁用',degraded:'降级','connection-required':'需要连接',paired:'已配对',ready:'就绪'})[status]||text(status,'未知');}

function executionClassLabel(value){return ({unknown:'未知',unspecified:'未指定',none:'无',short:'短',medium:'中等',long:'长',low:'低',high:'高',text:'文本'})[value]||text(value,'未知');}
function outcomeStatusLabel(status){return ({'asset-ready':'资产就绪','asset-provisional':'资产暂定','asset-rejected':'资产被拒绝'})[status]||text(status,'未知状态');}
function admissionStatusLabel(status){return ({accepted:'已准入',provisional:'暂定准入',rejected:'已拒绝',ready:'就绪'})[status]||text(status,'未知状态');}

export class GenerationJobCenter {
  constructor({root,world,tools,storage=globalThis.localStorage,locationRef=globalThis.location,log=()=>{}}={}) {
    if(!root||!world?.generation) throw new Error('GenerationJobCenter requires root and runtime generation service');
    Object.assign(this,{root,world,tools,storage,locationRef,log,jobs:[],capabilities:[],selectedJobId:null,pairingId:null,timer:null});
    this.outcomes=new Map(); this.imports=new Map(); this.assetIds=new Map(); this.bindElements();
  }
  bindElements(){const q=(s)=>this.root.querySelector(s);this.badge=q('#generation-connector-badge');this.state=q('#generation-state');this.stateLabel=q('#generation-state-label');this.stateDetail=q('#generation-state-detail');this.endpoint=q('#generation-connector-endpoint');this.pairingHint=q('#generation-pairing-hint');this.provider=q('#generation-provider');this.operation=q('#generation-operation');this.capabilityHint=q('#generation-capability-hint');this.profile=q('#generation-profile');this.inputs=q('#generation-inputs');this.assetId=q('#generation-asset-id');this.costConfirm=q('#generation-cost-confirm');this.jobsDisclosure=q('#generation-jobs-disclosure');this.resultDisclosure=q('#generation-result-disclosure');this.jobList=q('#generation-job-list');this.selectedId=q('#generation-selected-id');this.jobDetail=q('#generation-job-detail');this.compileAssetId=q('#generation-compile-asset-id');this.resultReport=q('#generation-result-report');this.buttons={saveEndpoint:q('#generation-save-endpoint'),pair:q('#generation-pair'),revoke:q('#generation-revoke'),submit:q('#generation-submit'),refresh:q('#generation-refresh'),jobRefresh:q('#generation-job-refresh'),cancel:q('#generation-job-cancel'),import:q('#generation-job-import'),compile:q('#generation-job-compile'),spawn:q('#generation-job-spawn')};}
  async init(){
    this.endpoint.value=this.storage?.getItem?.('agentscape.connectorEndpoint')||'';
    this.buttons.saveEndpoint.addEventListener('click',()=>this.saveEndpoint());this.buttons.pair.addEventListener('click',()=>this.pair());this.buttons.revoke.addEventListener('click',()=>this.revoke());this.buttons.submit.addEventListener('click',()=>this.submit());this.buttons.refresh.addEventListener('click',()=>this.refresh({remote:true}));this.buttons.jobRefresh.addEventListener('click',()=>this.refreshSelected());this.buttons.cancel.addEventListener('click',()=>this.cancelSelected());this.buttons.import.addEventListener('click',()=>this.importSelected());this.buttons.compile.addEventListener('click',()=>this.compileSelected());this.buttons.spawn.addEventListener('click',()=>this.spawnSelected());this.provider.addEventListener('change',()=>this.renderCapabilities());this.operation.addEventListener('change',()=>this.renderCapabilityHint());this.costConfirm.addEventListener('change',()=>this.renderCapabilityHint());
    this.world.events?.on?.('generation.state',(state)=>this.renderConnectorState(state));this.world.events?.on?.('generation.job.submitted',()=>this.refresh({remote:false}));this.world.events?.on?.('generation.job.cancelled',()=>this.refresh({remote:false}));this.world.events?.on?.('generation.artifact.imported',()=>this.renderSelected());
    this.renderConnectorState(this.world.generationState||this.world.generation.connectorStatus());this.refreshCapabilities();await this.refresh({remote:this.world.generation.connectorStatus().status==='paired'});
    this.timer=setInterval(()=>{if(this.jobs.some((job)=>ACTIVE_STATUSES.has(job.status))&&this.world.generation.connectorStatus().status==='paired')this.refresh({remote:true,silent:true});},5000);return this;
  }
  destroy(){if(this.timer)clearInterval(this.timer);this.timer=null;}
  setState(state,label,detail){this.state.dataset.state=state;this.stateLabel.textContent=label;this.stateDetail.textContent=detail;}
  renderConnectorState(state={}){
    const paired=state.status==='generation-ready'||state.status==='paired';this.badge.textContent=paired?'已配对':'连接';this.badge.classList.toggle('live',paired);
    if(paired){const connector=state.connector||this.world.generation.connectorStatus().connector;this.setState('ready','连接器已配对',`${text(connector?.id,'连接器')} · ${text(connector?.version,'版本未知')}`);this.pairingHint.textContent='Session 已建立；Provider Secret 仍只存在于 Connector 边界。';}
    else if(state.reason==='APPROVAL_REQUIRED'){this.pairingId=state.pairingId||this.pairingId;this.setState('approval-required','等待连接器批准','在本机连接器完成批准后，再点“配对 / 恢复”。');this.pairingHint.textContent=`配对 ID：${text(this.pairingId)} · 不包含 Provider 凭据。`;}
    else{this.setState('connection-required','连接器未连接',state.reason==='CONNECTOR_NOT_CONFIGURED'?'先填写本机连接器地址。':'点击“配对 / 恢复”建立受限会话。');this.pairingHint.textContent='凭据只由本机连接器会话管理；浏览器不保存提供方密钥。';}
    this.buttons.revoke.disabled=!paired;this.renderCapabilityHint?.();
  }
  saveEndpoint(){const endpoint=this.endpoint.value.trim();if(endpoint)this.storage?.setItem?.('agentscape.connectorEndpoint',endpoint);else this.storage?.removeItem?.('agentscape.connectorEndpoint');this.log(endpoint?'连接器地址已保存；正在重新加载运行时':'连接器地址已清除；正在重新加载运行时','result');this.locationRef?.reload?.();}
  async pair(){try{this.setState('working','连接中','正在与本机连接器建立受限会话…');const result=await this.world.generation.pairConnector({pairingId:this.pairingId});this.renderConnectorState(result);if(result.status==='generation-ready'){this.pairingId=null;this.world.generationState=clone(result);this.refreshCapabilities();await this.refresh({remote:true});}}catch(error){this.setState('error','连接器连接失败',error.message);this.log(`连接器错误：${error.message}`,'error');}}
  async revoke(){try{const result=await this.world.generation.revokeConnector();this.world.generationState=clone(result);this.renderConnectorState(result);this.log('连接器会话已撤销','result');}catch(error){this.setState('error','撤销失败',error.message);this.log(`撤销连接器会话失败：${error.message}`,'error');}}
  refreshCapabilities(){const providers=this.world.generation.listGenerationProviders({availableOnly:false}).providers;this.provider.replaceChildren();for(const provider of providers)this.provider.append(option(provider.id,`${provider.displayName||provider.id} · ${availabilityLabel(provider.status)}`));this.capabilities=this.world.generation.listGenerationCapabilities({availableOnly:false}).capabilities;this.renderCapabilities();}
  renderCapabilities(){const provider=this.provider.value,matching=this.capabilities.filter((capability)=>!provider||capability.provider===provider);this.operation.replaceChildren();for(const capability of matching)this.operation.append(option(capability.operation,`${capability.displayName||capability.operation} · ${availabilityLabel(capability.status)}`));this.renderCapabilityHint();}
  currentCapability(){return this.capabilities.find((capability)=>capability.operation===this.operation.value)||null;}
  renderCapabilityHint(){const capability=this.currentCapability();this.capabilityHint.textContent=capabilityHint(capability);const profiles=Object.keys(capability?.profiles||{});if(profiles.length===1&&!this.profile.value.trim())this.profile.value=profiles[0];const paired=this.world.generation.connectorStatus().status==='paired';const connectionBlocked=Boolean(capability?.connectionRequired)&&!paired;this.buttons.submit.disabled=!capability||capability.status!=='available'||connectionBlocked||!this.costConfirm.checked;}
  async submit(){try{const capability=this.currentCapability();if(!capability)throw new Error('请选择生成能力');if(!this.costConfirm.checked)throw new Error('提交前必须确认外部 Job 可能产生费用');if(capability.connectionRequired&&this.world.generation.connectorStatus().status!=='paired')throw new Error('必须先完成连接器配对');const assetId=this.assetId.value.trim()||`generated_${Date.now().toString(36)}`;this.buttons.submit.disabled=true;const job=await this.world.generation.submitGenerationJob({provider:capability.provider,operation:capability.operation,inputs:parseGenerationInputs(this.inputs.value),profile:this.profile.value.trim()||null,outputRoles:capability.output?.roles||[]});this.assetIds.set(job.jobId,assetId);this.selectedJobId=job.jobId;this.compileAssetId.value=assetId;this.costConfirm.checked=false;this.log(`生成任务已提交：${job.jobId}${job.reused?' · 已复用':''}`,'result');await this.refresh({remote:false});this.jobsDisclosure.open=true;this.resultDisclosure.open=true;}catch(error){this.setState('error','提交失败',error.message);this.log(`提交生成任务失败：${error.message}`,'error');}finally{this.renderCapabilityHint();}}
  async refresh({remote=false,silent=false}={}){try{const result=remote?await this.world.generation.reconcileGenerationJobs():this.world.generation.listGenerationJobs();this.jobs=result.jobs||[];if(this.selectedJobId&&!this.jobs.some((job)=>job.jobId===this.selectedJobId))this.selectedJobId=null;if(!this.selectedJobId&&this.jobs.length)this.selectedJobId=this.jobs[0].jobId;this.renderJobs();this.renderSelected();if(!silent&&result.status==='connection-required'&&this.jobs.length)this.setState('connection-required','离线 Job 快照','连接器不可用；当前显示本地脱敏快照。');}catch(error){if(!silent){this.setState('error','Job 恢复失败',error.message);this.log(`刷新生成任务失败：${error.message}`,'error');}}}
  renderJobs(){this.jobList.replaceChildren();for(const job of this.jobs){const button=el('button','generation-job-row');button.type='button';button.classList.toggle('selected',job.jobId===this.selectedJobId);const top=el('span','generation-job-row-top');top.append(el('strong',null,generationStatusLabel(job.status)),el('small',null,text(job.updatedAt)));const id=el('span','generation-job-row-id',job.jobId);const progress=job.progress?.value!=null?` · ${Math.round(job.progress.value*100)}%`:'';button.append(top,id,el('span','generation-job-row-meta',`${job.provider} · ${job.stage||job.phase||'等待中'}${progress}`));button.addEventListener('click',()=>{this.selectedJobId=job.jobId;this.resultDisclosure.open=true;this.renderJobs();this.renderSelected();});this.jobList.append(button);}if(!this.jobs.length)this.jobList.append(el('div','generation-empty','暂无生成任务。连接连接器后可恢复历史生成任务。'));}
  selectedJob(){return this.jobs.find((job)=>job.jobId===this.selectedJobId)||null;}
  renderSelected(){const job=this.selectedJob(),outcome=job?this.outcomes.get(job.jobId):null,imported=job?this.imports.get(job.jobId):null,actions=generationJobActions(job,outcome);this.selectedId.textContent=job?.jobId||'未选择';this.jobDetail.replaceChildren();if(!job)this.jobDetail.append(el('div','generation-empty','选择一个生成任务，查看进度、产物完整性与世界就绪状态。'));else{for(const [label,value] of [['状态',generationStatusLabel(job.status)],['阶段',job.stage||job.phase],['提供方',job.provider],['操作',job.operation],['尝试次数',job.attempt],['关联任务',(job.relations||[]).map((r)=>`${r.type}:${r.jobId}`).join(', ')||'—']]){const row=el('div','generation-detail-row');row.append(el('span',null,label),el('code',null,text(value)));this.jobDetail.append(row);}if(job.error)this.jobDetail.append(el('div','generation-error',`${text(job.error.code)} · ${text(job.error.message)}`));const artifacts=el('div','generation-artifacts');artifacts.append(el('strong',null,'产物'));for(const artifact of job.artifacts||[])artifacts.append(el('div',null,`${artifact.id} · ${artifact.role} · ${artifact.mime} · ${artifact.bytes} 字节 · ${artifact.hash}`));if(!(job.artifacts||[]).length)artifacts.append(el('small',null,'提供方尚未给出产物描述。'));this.jobDetail.append(artifacts);}const remembered=job?this.assetIds.get(job.jobId):null;if(job&&remembered&&!this.compileAssetId.value.trim())this.compileAssetId.value=remembered;this.buttons.jobRefresh.disabled=!actions.canRefresh;this.buttons.cancel.disabled=!actions.canCancel;this.buttons.import.disabled=!actions.canImport;this.buttons.compile.disabled=!actions.canCompile;this.buttons.spawn.disabled=!actions.canSpawn;this.renderResult(imported,outcome);}
  renderResult(imported,outcome){this.resultReport.replaceChildren();if(imported){this.resultReport.append(el('strong',null,`产物 ${imported.artifact.integrity}`),el('div',null,`${imported.artifact.id} · ${imported.artifact.mime} · ${imported.artifact.hash}`));const lineage=imported.artifact.lineage?.parents||[];this.resultReport.append(el('small',null,`上游血缘：${lineage.length?lineage.join(', '):'无'} · 生产任务：${text(imported.artifact.producer?.jobId)}`));}if(outcome){const admission=outcome.admission||{};this.resultReport.append(el('strong',null,`${outcomeStatusLabel(outcome.status)} · 准入 ${admissionStatusLabel(admission.status)}`),el('div',null,`资产 ${text(outcome.assetId)} · 原因 ${(admission.reasons||[]).join(', ')||'无'}`));if(outcome.status==='asset-rejected')this.resultReport.append(el('div','generation-error','提供方已成功，但编译器 / 准入检查拒绝该资产；不会提升为可用资产。'));}if(!imported&&!outcome)this.resultReport.append(el('div',null,'生成完成不代表可以直接进入世界；必须先通过编译与准入检查，才能加入世界。'));}
  async refreshSelected(){const job=this.selectedJob();if(!job)return;try{const updated=await this.world.generation.getGenerationJob(job.jobId),index=this.jobs.findIndex((item)=>item.jobId===job.jobId);if(index>=0)this.jobs[index]=updated;this.renderJobs();this.renderSelected();}catch(error){this.log(`生成任务错误：${error.message}`,'error');}}
  async cancelSelected(){const job=this.selectedJob();if(!job)return;try{await this.world.generation.cancelGenerationJob(job.jobId);await this.refresh({remote:false});}catch(error){this.log(`取消生成任务失败：${error.message}`,'error');}}
  async importSelected(){const job=this.selectedJob();if(!job)return;try{const result=await this.world.generation.importGenerationResult(job.jobId);this.imports.set(job.jobId,result);this.renderSelected();this.log(`产物已导入：${result.artifact.id}`,'result');}catch(error){this.log(`导入产物失败：${error.message}`,'error');}}
  async compileSelected(){const job=this.selectedJob();if(!job)return;try{const assetId=this.compileAssetId.value.trim()||this.assetIds.get(job.jobId)||`generated_${Date.now().toString(36)}`;this.assetIds.set(job.jobId,assetId);const outcome=await this.world.generation.generateAndCompileAsset({jobId:job.jobId,assetId,label:assetId});this.outcomes.set(job.jobId,outcome);const artifact=this.world.generation.artifactRegistry?.list?.().find((item)=>item.producer?.jobId===job.jobId&&item.integrity?.state==='verified');if(artifact&&!this.imports.has(job.jobId))this.imports.set(job.jobId,{status:'artifact-imported',jobId:job.jobId,artifact:{id:artifact.id,role:artifact.role,mime:artifact.mime,format:artifact.format,bytes:artifact.bytes,hash:artifact.hash,integrity:artifact.integrity?.state,producer:clone(artifact.producer),lineage:clone(artifact.lineage)},reused:true});this.renderSelected();this.log(`资产编译：${assetId} · ${outcome.status}`,outcome.status==='asset-rejected'?'error':'result');}catch(error){this.log(`资产编译失败：${error.message}`,'error');}}
  async spawnSelected(){const job=this.selectedJob();if(!job||!this.tools)return;const outcome=this.outcomes.get(job.jobId);if(!generationJobActions(job,outcome).canSpawn)return;try{const result=await this.tools.call('spawnAsset',{assetId:outcome.assetId,position:[1.5,0,1.2]});this.log(`生成资产已加入世界：${outcome.assetId} · ${typeof result==='string'?'就绪':'编辑器暂定'}`,'result');}catch(error){this.log(`加入生成资产失败：${error.message}`,'error');}}
}
