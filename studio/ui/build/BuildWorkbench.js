import { BUILD_MODE_META, BUILD_MODES } from '../../build/BuildSession.js';

export const buildWorkbenchMarkup=()=>`
<section class="build-workbench" aria-label="Build Workbench">
  <header class="build-heading">
    <div>
      <div class="eyebrow">BUILD</div>
      <h1>Build Workbench</h1>
      <p>在当前世界中生成 Image、3D Asset 或完整 World。</p>
    </div>
    <button id="build-open-advanced" class="build-advanced-button" type="button">Advanced</button>
  </header>

  <div class="build-world-context">
    <span class="build-context-dot"></span>
    <div><small>CURRENT WORLD</small><strong id="build-world-name">—</strong></div>
    <code id="build-world-id">—</code>
  </div>

  <div class="build-mode-tabs" role="tablist" aria-label="构建类型">
    <button type="button" data-build-mode="image" aria-selected="false"><span>Image</span><small>2D</small></button>
    <button type="button" data-build-mode="asset" class="active" aria-selected="true"><span>3D Asset</span><small>3D</small></button>
    <button type="button" data-build-mode="world" aria-selected="false"><span>World</span><small>ENV</small></button>
  </div>

  <div class="build-scroll">
    <section class="build-compose">
      <div class="build-mode-copy">
        <strong id="build-mode-title">生成 3D 资产</strong>
        <span id="build-mode-description">Text / Image → 3D → Compile → Asset</span>
      </div>
      <label class="build-prompt-label">Prompt
        <textarea id="build-prompt" rows="4" placeholder="描述你希望生成的内容…" spellcheck="false"></textarea>
      </label>
      <label id="build-asset-id-field" class="build-asset-id-field">Asset ID <span>可选</span>
        <input id="build-asset-id" placeholder="generated_asset_01" />
      </label>
      <label class="build-cost-confirm"><input id="build-cost-confirm" type="checkbox" />允许本次 Build 使用外部生成计算资源。</label>
      <div class="build-primary-actions">
        <button id="build-connect" type="button" class="build-connect">连接生成器</button>
        <button id="build-generate" type="button" class="build-generate">Generate 3D</button>
      </div>
      <div id="build-capability-state" class="build-capability-state">等待生成能力…</div>
    </section>

    <section class="build-pipeline" aria-label="Build Pipeline">
      <div class="build-section-heading"><span>Pipeline</span><small id="build-status-label">READY</small></div>
      <div id="build-step-list" class="build-step-list"></div>
      <div id="build-error" class="build-error hidden"></div>
    </section>

    <section id="build-result" class="build-result hidden" aria-label="Build Result">
      <div class="build-section-heading"><span>Result</span><small>READY</small></div>
      <div id="build-result-body" class="build-result-body"></div>
      <div id="build-result-actions" class="build-result-actions"></div>
    </section>
  </div>
</section>`;

const el=(tag,className='',text=null)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=String(text);return node;};

function localArtifactEntry(world,artifactId){
  const descriptor=world.generation?.artifacts?.registry?.get?.(artifactId);
  const location=descriptor?.locations?.find((item)=>item.kind==='local-cache'&&item.state==='available'&&item.access?.kind==='cache-key');
  return location?world.generation?.artifacts?.byteStore?.get?.(location.access.key)||null:null;
}

function capabilityText(caps,mode){
  if(!caps.paired) return '生成连接器尚未连接；连接后自动发现 Provider 能力。';
  if(caps[mode]) return `${BUILD_MODE_META[mode].label} 路由已就绪。Provider 由能力快照自动选择。`;
  if(caps.discovered?.[mode]) return `${BUILD_MODE_META[mode].label} 能力已发现，但 Provider 当前 Offline / Disabled；连接 Provider Runtime 后会自动变为 Ready。`;
  return `当前能力快照没有可用的 ${BUILD_MODE_META[mode].label} 路由。`;
}

export class BuildWorkbench {
  constructor({root,world,session,controller,environmentDefinition=null,log=()=>{}}={}){
    if(!root||!world?.generation||!session||!controller) throw new TypeError('BuildWorkbench requires root, world, session and controller');
    this.root=root;
    this.world=world;
    this.session=session;
    this.controller=controller;
    this.environmentDefinition=environmentDefinition;
    this.log=log;
    this.pairingId=null;
    this.lastImageResult=null;
    this.objectUrl=null;
    this.unsubscribers=[];
    this.bindElements();
  }

  bindElements(){
    const q=(selector)=>this.root.querySelector(selector);
    this.modeButtons=[...this.root.querySelectorAll('[data-build-mode]')];
    this.worldName=q('#build-world-name');this.worldId=q('#build-world-id');
    this.modeTitle=q('#build-mode-title');this.modeDescription=q('#build-mode-description');
    this.prompt=q('#build-prompt');this.assetIdField=q('#build-asset-id-field');this.assetId=q('#build-asset-id');
    this.costConfirm=q('#build-cost-confirm');this.connectButton=q('#build-connect');this.generateButton=q('#build-generate');
    this.capabilityState=q('#build-capability-state');this.statusLabel=q('#build-status-label');this.stepList=q('#build-step-list');this.error=q('#build-error');
    this.result=q('#build-result');this.resultBody=q('#build-result-body');this.resultActions=q('#build-result-actions');
    this.advancedButton=q('#build-open-advanced');
  }

  init(){
    this.session.onChange=(state)=>this.renderSession(state);
    for(const button of this.modeButtons) button.addEventListener('click',()=>this.setMode(button.dataset.buildMode));
    this.connectButton.addEventListener('click',()=>this.connect());
    this.generateButton.addEventListener('click',()=>this.generate());
    this.prompt.addEventListener('input',()=>this.renderControls());
    this.costConfirm.addEventListener('change',()=>this.renderControls());
    this.advancedButton.addEventListener('click',()=>this.root.classList.add('build-advanced-open'));
    this.unsubscribers.push(this.world.events.on('generation.state',()=>this.renderCapabilities()));
    this.unsubscribers.push(this.world.events.on('environment.replaced',()=>this.renderWorld()));
    this.renderWorld();this.renderCapabilities();this.renderSession(this.session.snapshot());
    return this;
  }

  destroy(){for(const unsubscribe of this.unsubscribers.splice(0))unsubscribe?.();this.revokePreview();}

  setMode(mode){if(!BUILD_MODES.includes(mode))return;this.session.setMode(mode);}

  renderWorld(){
    const environment=this.world.environment;
    const builtinTitle=environment?.id===this.environmentDefinition?.id?this.environmentDefinition?.title:null;
    this.worldName.textContent=environment?.title||environment?.label||builtinTitle||environment?.id||'Current World';
    this.worldId.textContent=environment?.id||'environment';
  }

  renderCapabilities(){
    const caps=this.controller.capabilities();
    const state=this.session.snapshot();
    this.connectButton.classList.toggle('hidden',caps.paired);
    this.connectButton.textContent=this.pairingId?'继续配对':'连接生成器';
    this.capabilityState.textContent=capabilityText(caps,state.mode);
    for(const button of this.modeButtons){
      const mode=button.dataset.buildMode;
      button.classList.toggle('available',Boolean(caps[mode]));
      button.classList.toggle('discovered',!caps[mode]&&Boolean(caps.discovered?.[mode]));
    }
    this.renderControls();
  }

  renderControls(){
    const state=this.session.snapshot();
    const caps=this.controller.capabilities();
    const running=state.status==='running';
    this.prompt.disabled=running;
    this.assetId.disabled=running;
    this.costConfirm.disabled=running;
    this.generateButton.disabled=running||!caps.paired||!caps[state.mode]||!this.costConfirm.checked||!this.prompt.value.trim();
  }

  renderSession(state){
    this.root.dataset.buildMode=state.mode;
    const meta=BUILD_MODE_META[state.mode];
    this.modeTitle.textContent=meta.title;
    this.modeDescription.textContent=meta.description;
    this.assetIdField.classList.toggle('hidden',state.mode!=='asset');
    for(const button of this.modeButtons){const active=button.dataset.buildMode===state.mode;button.classList.toggle('active',active);button.setAttribute('aria-selected',active?'true':'false');}
    this.generateButton.textContent=state.mode==='image'?'Generate Image':state.mode==='world'?'Generate World':'Generate 3D';
    this.statusLabel.textContent=state.status.toUpperCase();
    this.stepList.replaceChildren();
    for(const step of state.steps){
      const row=el('div','build-step');row.dataset.state=step.status;
      row.append(el('span','build-step-indicator',step.status==='completed'?'✓':step.status==='error'?'!':'•'));
      const copy=el('div','build-step-copy');copy.append(el('strong','',step.label));if(step.detail)copy.append(el('small','',step.detail));
      row.append(copy);this.stepList.append(row);
    }
    this.error.classList.toggle('hidden',!state.error);
    this.error.textContent=state.error?`${state.error.code?`${state.error.code} · `:''}${state.error.message}`:'';
    this.renderResult(state.result);
    this.renderCapabilities();
  }

  renderResult(result){
    this.revokePreview();
    this.result.classList.toggle('hidden',!result);
    this.resultBody.replaceChildren();this.resultActions.replaceChildren();
    if(!result)return;
    if(result.kind==='image') this.renderImageResult(result);
    else if(result.kind==='asset') this.renderAssetResult(result);
    else if(result.kind==='world') this.renderWorldResult(result);
  }

  renderImageResult(result){
    const entry=localArtifactEntry(this.world,result.artifactId);
    if(entry?.data){
      this.objectUrl=URL.createObjectURL(new Blob([entry.data],{type:result.artifact?.mime||'image/png'}));
      const preview=el('div','build-image-preview');const img=document.createElement('img');img.src=this.objectUrl;img.alt=result.prompt||result.artifactId;preview.append(img);this.resultBody.append(preview);
    }
    const info=el('div','build-result-copy');info.append(el('strong','',result.prompt||'Generated Image'),el('code','',result.artifactId));this.resultBody.append(info);
    const to3d=el('button','build-result-primary','生成 3D');to3d.type='button';
    to3d.addEventListener('click',()=>this.generate3DFromImage(result));
    this.resultActions.append(to3d);
  }

  renderAssetResult(result){
    const info=el('div','build-result-copy');info.append(el('strong','',result.asset?.label||result.prompt||result.assetId),el('code','',result.assetId),el('small','',result.status==='asset-provisional'?'Asset provisional · 可进入当前工作区验证':'Asset ready · 已编译并注册'));
    this.resultBody.append(info);
    const place=el('button','build-result-primary','加入当前世界');place.type='button';
    place.addEventListener('click',async()=>{place.disabled=true;try{await this.controller.placeAsset(result.assetId);this.log(`Build Asset 已加入当前世界：${result.assetId}`,'result');place.textContent='已加入世界';}catch(error){this.log(`Build Asset 放置失败：${error.message}`,'error');}finally{place.disabled=false;}});
    this.resultActions.append(place);
  }

  renderWorldResult(result){
    const info=el('div','build-result-copy');info.append(el('strong','',result.prompt||'Generated World'),el('code','',result.manifestArtifactId),el('small','',`${Object.values(result.artifacts||{}).filter(Boolean).length} artifacts · World bundle ready`));
    this.resultBody.append(info);
    const open=el('button','build-result-primary','打开为当前世界');open.type='button';
    open.addEventListener('click',async()=>{open.disabled=true;try{await this.controller.openWorld(result.manifestArtifactId);this.log(`Build World 已打开：${result.manifestArtifactId}`,'result');open.textContent='当前世界';}catch(error){this.log(`Build World 打开失败：${error.message}`,'error');}finally{open.disabled=false;}});
    this.resultActions.append(open);
  }

  async connect(){
    this.connectButton.disabled=true;
    try{
      const result=await this.controller.connect({pairingId:this.pairingId});
      if(result.status==='generation-ready'){this.pairingId=null;this.world.generationState=structuredClone(result);this.log('Build 生成连接器已就绪','result');}
      else if(result.reason==='APPROVAL_REQUIRED'){this.pairingId=result.pairingId||this.pairingId;this.log(`Build 等待连接器批准：${this.pairingId}`,'plan');}
      this.renderCapabilities();
    }catch(error){this.log(`Build 连接器失败：${error.message}`,'error');this.capabilityState.textContent=error.message;}
    finally{this.connectButton.disabled=false;}
  }

  async generate(){
    const mode=this.session.snapshot().mode;
    const prompt=this.prompt.value.trim();
    if(!prompt||!this.costConfirm.checked)return;
    const assetId=this.assetId.value.trim()||null;
    this.session.begin(prompt,{mode});
    try{
      let result;
      if(mode==='image') result=await this.controller.generateImage({prompt,onProgress:(job)=>this.session.stage(1,job.stage||job.phase||job.status||'生成中')});
      else if(mode==='asset') result=await this.controller.generateAsset({prompt,assetId,onProgress:()=>this.session.stage(1,'生成 3D')});
      else result=await this.controller.generateWorld({prompt,onProgress:()=>this.session.stage(1,'生成参考与世界')});
      if(result.kind==='image')this.lastImageResult=result;
      this.session.complete(result);
      this.log(`Build 完成：${result.kind}`,'result');
    }catch(error){this.session.fail(error);this.log(`Build 失败：${error.message}`,'error');}
    finally{this.costConfirm.checked=false;this.renderControls();}
  }

  async generate3DFromImage(imageResult){
    if(!this.costConfirm.checked){this.capabilityState.textContent='Image → 3D 是新的外部生成任务，请先再次确认使用生成计算资源。';return;}
    const assetId=this.assetId.value.trim()||null;
    this.session.begin(imageResult.prompt||'Image to 3D',{mode:'asset'});
    try{
      const result=await this.controller.generateAssetFromImage({imageResult,assetId,onProgress:(job)=>this.session.stage(1,job.stage||job.phase||job.status||'3D 重建中')});
      this.session.complete(result);this.log(`Image → 3D 完成：${result.assetId}`,'result');
    }catch(error){this.session.fail(error);this.log(`Image → 3D 失败：${error.message}`,'error');}
    finally{this.costConfirm.checked=false;this.renderControls();}
  }

  revokePreview(){if(this.objectUrl){URL.revokeObjectURL(this.objectUrl);this.objectUrl=null;}}
}
