import * as THREE from 'three';
import { createAssetModule } from '../../../generation/orchestration/createAssetModule.js';
import { AssetCompiler } from '../../../asset/compiler/AssetCompiler.js';
import { RESOURCE_BUDGET } from '../../../asset/compiler/resourceBudget.js';
import { disposeObject3D } from '../../../core/disposeObject3D.js';
import { loadGaussianSplatVisual } from '../../../core/rendering/loadGaussianSplatVisual.js';
import { SimulationClock } from '../../core/SimulationClock.js';
import { createObservatoryGrid, disposeObservatoryGrid } from '../../visual/ObservatoryGrid.js';
import { createObservatoryRenderSurface } from '../../visual/ObservatoryRenderSurface.js';
import { resizeObservatoryRenderer } from '../../visual/RendererQuality.js';
import { downloadBytes, prepareGaussianRuntimeVisual } from '../../workbench/gaussianPipeline.js';

const MANIFEST_STORAGE_KEY = 'agentscape.observatory.asset-manifests.v1';
const safeId = (value) => String(value || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 160);
const bytesLabel = (value) => value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
const escapeHtml = (value) => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

export class ResourceLab {
  constructor({ viewport, onTelemetry, rendererMode='auto', rendererTiming=false, onRendererFailure=null, mode='assets' }) {
    this.viewport=viewport;
    this.onTelemetry=onTelemetry;
    this.rendererMode=rendererMode;
    this.rendererTiming=rendererTiming;
    this.onRendererFailure=onRendererFailure;
    this.mode=mode;
    this.clock=new SimulationClock();
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(48,1,.02,500);
    this.camera.position.set(5,3.8,6);
    this.grid=createObservatoryGrid({size:24});
    this.scene.add(this.grid);
    this.assetModule=createAssetModule();
    this.compiler=new AssetCompiler({store:this.assetModule.compiledStore,version:'observatory'});
    this.subject=null;
    this.gaussian=null;
    this.selectedAsset=null;
    this.gaussianState={status:'waiting'};
    this.restoreUploadedManifests();
  }

  async init() {
    Object.assign(this,await createObservatoryRenderSurface({
      viewport:this.viewport,scene:this.scene,camera:this.camera,rendererMode:this.rendererMode,
      rendererTiming:this.rendererTiming,onRendererFailure:this.onRendererFailure,controlsTarget:[0,1,0]
    }));
    this.assetModule.manager.configureRenderer?.(this.renderer);
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(this.viewport);
    this.resize();
    this.animation=requestAnimationFrame((time)=>this.frame(time));
    return this;
  }

  async load(scenario) {
    this.scenario=scenario;
    this.clock.reset();
    if(this.mode==='assets'&&!this.selectedAsset) await this.previewAsset('table');
    this.emitTelemetry();
  }

  resourceWorkbench() {
    return this.mode==='assets' ? {mountBrowser:(host)=>this.mountAssetBrowser(host),mountInspector:(host)=>this.mountAssetInspector(host)} : {mount:(host)=>this.mountGaussian(host)};
  }

  mountAssetBrowser(host) {
    host.innerHTML=`<label class="obs-resource-search obs-resource-search-compact">搜索<input type="search" data-resource-search placeholder="搜索 ID / 类型 / 能力…"></label>
      <div class="obs-resource-list obs-resource-list-sidebar" data-resource-list></div>`;
    const search=host.querySelector('[data-resource-search]');
    search.addEventListener('input',()=>this.renderAssetList(host,search.value));
    this.assetBrowserHost=host;
    this.renderAssetList(host,'');
  }

  mountAssetInspector(host) {
    host.innerHTML=`<div class="obs-panel-heading"><span>ASSET INSPECTOR</span><strong>资产检视</strong><small>从左侧 Catalog 选择资产；中央视口始终预览当前选择。</small></div>
      <div class="obs-resource-selection" data-resource-selection></div>
      <div class="obs-resource-divider"><span>IMPORT</span></div>
      <div class="obs-resource-card"><span>GLB / ASSET COMPILER</span><strong>导入新资产</strong><p>GLB 先经过 inspect → normalize → collider → admission，通过后才注册到 AssetCatalog。</p>
        <label>Asset ID<input data-asset-id placeholder="my_asset"></label>
        <label>显示名称<input data-asset-label placeholder="My Asset"></label>
        <label class="obs-resource-file">选择 GLB<input data-asset-file type="file" accept=".glb,model/gltf-binary"><small data-file-name>未选择文件</small></label>
        <button data-compile-asset type="button">编译并加入 Catalog</button><pre data-resource-report>等待 GLB。</pre>
      </div>`;
    const fileInput=host.querySelector('[data-asset-file]');
    fileInput.addEventListener('change',()=>{
      const file=fileInput.files?.[0];
      host.querySelector('[data-file-name]').textContent=file?`${file.name} · ${bytesLabel(file.size)}`:'未选择文件';
      if(file&&!host.querySelector('[data-asset-id]').value) host.querySelector('[data-asset-id]').value=safeId(file.name.replace(/\.glb$/i,''));
    });
    host.querySelector('[data-compile-asset]').addEventListener('click',()=>this.compileAsset(host));
    this.assetInspectorHost=host;
    this.renderAssetInspector();
  }

  renderAssetList(host,query='') {
    const assets=query.trim()?this.assetModule.catalog.search(query,{limit:100}):this.assetModule.catalog.list();
    const list=host.querySelector('[data-resource-list]');
    list.innerHTML=assets.map((asset)=>`<button type="button" data-asset="${escapeHtml(asset.id)}" class="obs-resource-item${asset.id===this.selectedAsset?' is-active':''}"><span>${escapeHtml(asset.source)}</span><strong>${escapeHtml(asset.label)}</strong><small>${escapeHtml(asset.id)} · ${escapeHtml(asset.type)}</small><em>${escapeHtml(asset.actions.join(' / ')||'visual only')}</em></button>`).join('')||'<div class="obs-empty">没有匹配的资产。</div>';
    list.querySelectorAll('[data-asset]').forEach((button)=>button.addEventListener('click',()=>this.previewAsset(button.dataset.asset)));
  }

  renderAssetInspector() {
    const host=this.assetInspectorHost;
    if(!host)return;
    const asset=this.assetModule.catalog.list().find((item)=>item.id===this.selectedAsset);
    const target=host.querySelector('[data-resource-selection]');
    if(!asset){target.innerHTML='<div class="obs-empty">从左侧选择一个资产。</div>';return;}
    target.innerHTML=`<article class="obs-resource-selected"><div class="obs-resource-selected-head"><span>${escapeHtml(asset.source)}</span><strong>${escapeHtml(asset.label)}</strong><small>${escapeHtml(asset.id)}</small></div><dl><div><dt>类型</dt><dd>${escapeHtml(asset.type)}</dd></div><div><dt>能力</dt><dd>${escapeHtml(asset.actions.join(' · ')||'visual only')}</dd></div><div><dt>状态</dt><dd>READY</dd></div></dl></article>`;
  }

  async previewAsset(assetId) {
    try {
      const {object,manifest}=await this.assetModule.manager.instantiate(assetId);
      this.replaceSubject(object);
      this.selectedAsset=assetId;
      this.fitObject(object);
      if(this.assetBrowserHost)this.renderAssetList(this.assetBrowserHost,this.assetBrowserHost.querySelector('[data-resource-search]').value);
      this.renderAssetInspector();
      this.emitTelemetry();
      return manifest;
    }catch(error){this.setReport(this.assetInspectorHost,`预览失败：${error.message}`,true);return null;}
  }

  async compileAsset(host) {
    const file=host.querySelector('[data-asset-file]').files?.[0];
    if(!file){this.setReport(host,'请先选择 GLB。',true);return;}
    if(file.size>RESOURCE_BUDGET.maxInputBytes){this.setReport(host,`文件超过 ${bytesLabel(RESOURCE_BUDGET.maxInputBytes)} 上限。`,true);return;}
    const assetId=safeId(host.querySelector('[data-asset-id]').value||file.name.replace(/\.glb$/i,''));
    if(!assetId){this.setReport(host,'Asset ID 无效。',true);return;}
    this.setReport(host,'inspect → normalize → collider → admission…');
    try{
      const result=await this.compiler.compile({bytes:new Uint8Array(await file.arrayBuffer()),sourceName:file.name,assetId,label:host.querySelector('[data-asset-label]').value.trim()||assetId});
      this.assetModule.manager.registerManifest(result.manifest);
      this.persistUploadedManifests();
      if(this.assetBrowserHost)this.renderAssetList(this.assetBrowserHost,this.assetBrowserHost.querySelector('[data-resource-search]').value);
      this.setReport(host,`${result.manifest.id} · ${result.quality.status} · ${result.inspection.stats.meshes} meshes · ${result.manifest.compiler.collisionStrategy}`);
      await this.previewAsset(result.manifest.id);
    }catch(error){this.setReport(host,`编译失败：${error.message}`,true);}
  }

  mountGaussian(host) {
    host.innerHTML=`<div class="obs-panel-heading"><span>GAUSSIAN WORLD VISUAL</span><strong>高斯泼溅</strong><small>复用 modal-world 的输出约定与 AgentScape 的 SPZ Runtime Loader。</small></div>
      <div class="obs-resource-pipeline"><b>PLY</b><i>→</i><b>SPZ</b><i>→</i><b>Runtime Loader</b><i>→</i><b>Preview</b></div>
      <div class="obs-resource-card"><span>UPLOAD / TRANSCODE</span><strong>上传 Gaussian PLY 或 SPZ</strong><p>PLY 在浏览器中转换为 SPZ；SPZ 校验后直接进入同一预览路径。</p>
        <label class="obs-resource-file">选择 PLY / SPZ<input data-gaussian-file type="file" accept=".ply,.spz,model/ply,model/spz"><small data-file-name>未选择文件</small></label>
        <pre data-resource-report>等待 Gaussian Splat 文件。</pre><button data-download-spz type="button" hidden>下载转换后的 SPZ</button>
      </div>`;
    host.querySelector('[data-gaussian-file]').addEventListener('change',()=>this.loadGaussian(host,host.querySelector('[data-gaussian-file]').files?.[0]));
    host.querySelector('[data-download-spz]').addEventListener('click',()=>{
      if(this.gaussianState.bytes)downloadBytes(this.gaussianState.bytes,this.gaussianState.downloadName);
    });
    this.gaussianHost=host;
  }

  async loadGaussian(host,file) {
    if(!file)return;
    host.querySelector('[data-file-name]').textContent=`${file.name} · ${bytesLabel(file.size)}`;
    this.setReport(host,file.name.toLowerCase().endsWith('.ply')?'读取 PLY → 转码 SPZ…':'校验 SPZ…');
    try{
      const prepared=await prepareGaussianRuntimeVisual({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
      const loaded=await loadGaussianSplatVisual({source:{data:prepared.bytes,format:'spz'}});
      this.replaceSubject(loaded.object,loaded);
      this.cameraRig.moveTo([4,2.5,5],[0,0,0]);
      this.gaussianState={...prepared,status:'ready',runtimeCount:loaded.splatCount,downloadName:`${file.name.replace(/\.(ply|spz)$/i,'')}.spz`};
      host.querySelector('[data-download-spz]').hidden=!prepared.converted;
      this.setReport(host,`${prepared.inputFormat.toUpperCase()} ${bytesLabel(file.size)} → SPZ ${bytesLabel(prepared.bytes.byteLength)} · ${loaded.splatCount.toLocaleString()} splats`);
      this.emitTelemetry();
    }catch(error){this.gaussianState={status:'failed',error:error.message};this.setReport(host,`处理失败：${error.message}`,true);this.emitTelemetry();}
  }

  replaceSubject(object,gaussian=null) {
    if(this.subject){this.scene.remove(this.subject);if(this.gaussian)this.gaussian.dispose?.();else disposeObject3D(this.subject);}
    this.subject=object;this.gaussian=gaussian;this.scene.add(object);object.updateMatrixWorld(true);
  }

  fitObject(object) {
    const box=new THREE.Box3().setFromObject(object);if(box.isEmpty())return;
    const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),radius=Math.max(size.length()*.65,1);
    this.cameraRig.moveTo(center.clone().add(new THREE.Vector3(radius,radius*.75,radius)).toArray(),center.toArray());
  }

  setReport(host,message,error=false){const node=host?.querySelector('[data-resource-report]');if(node){node.textContent=message;node.dataset.error=error?'true':'false';}}
  setGridVisible(visible){this.grid.visible=Boolean(visible);}
  focusScenario(){if(this.subject)this.mode==='assets'?this.fitObject(this.subject):this.cameraRig.moveTo([4,2.5,5],[0,0,0]);}
  toggleRunning(){return false;} step(){} async reset(){return this.load(this.scenario);} captureCheckpoint(){return null;} restoreCheckpoint(){return null;}

  telemetry(){
    const assets=this.assetModule.catalog.list();
    const gaussianReady=this.gaussianState.status==='ready';
    return {scenario:this.scenario,clock:this.clock,checkpointFrame:null,
      inspector:{title:this.mode==='assets'?'AssetCatalog':'Gaussian Runtime',kind:'resource-workbench',values:this.mode==='assets'?{assets:assets.length,selected:this.selectedAsset||'—',compiled:assets.filter((asset)=>asset.source==='compiled').length}:{status:this.gaussianState.status,input:this.gaussianState.inputFormat||'—',runtime:this.gaussianState.runtimeFormat||'spz',splats:this.gaussianState.runtimeCount||0}},
      assertions:this.mode==='assets'?[{label:'AssetCatalog 可读取',pass:assets.length>=5,detail:`${assets.length} 个资产`},{label:'上传资产通过 AssetCompiler 后注册',status:'pending',detail:'选择 GLB 后执行'}]:[{label:'输入限定为 Gaussian PLY / SPZ',pass:true},{label:'Runtime 使用 SPZ',pass:true},{label:'上传、转换并完成预览',status:gaussianReady?'pass':'pending'}],
      metrics:this.mode==='assets'?{assets:assets.length,selected:this.selectedAsset||'—',pipeline:'GLB → Compiler → Catalog'}:{format:this.gaussianState.runtimeFormat||'spz',splats:this.gaussianState.runtimeCount||0,pipeline:'PLY → SPZ → Runtime'}};
  }
  emitTelemetry(){if(this.scenario)this.onTelemetry?.(this.telemetry());}
  frame(time){if(this.rendererState?.failed)return;this.controls.update();this.renderer.render(this.scene,this.camera);this.rendererProbe?.afterRender(time);this.animation=requestAnimationFrame((next)=>this.frame(next));}
  resize(){this.renderQuality=resizeObservatoryRenderer({renderer:this.renderer,camera:this.camera,viewport:this.viewport});}
  restoreUploadedManifests(){let list=[];try{list=JSON.parse(localStorage.getItem(MANIFEST_STORAGE_KEY)||'[]');}catch{}for(const manifest of Array.isArray(list)?list:[]){try{this.assetModule.manager.registerManifest(manifest);}catch{}}}
  persistUploadedManifests(){const list=[...this.assetModule.manager.manifests.values()].filter((manifest)=>manifest.source?.kind==='compiled');localStorage.setItem(MANIFEST_STORAGE_KEY,JSON.stringify(list));}
  async dispose(){cancelAnimationFrame(this.animation);this.resizeObserver?.disconnect?.();if(this.subject){if(this.gaussian)this.gaussian.dispose?.();else disposeObject3D(this.subject);}this.controls?.dispose?.();disposeObservatoryGrid(this.grid);this.renderer?.dispose?.();this.renderer?.domElement?.remove?.();}
}
