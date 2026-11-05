import * as THREE from 'three';
import './WorldOverlays.css';

// Environment camera presets, catalog and inline editors. Pointer selection and actions
// belong to EditorController and the shared React dock.
export const CABIN_INLINE_EDITORS = Object.freeze([
  Object.freeze({ id:'sign', label:'路牌文字', maxLength:10 }),
  Object.freeze({ id:'note', label:'便签文字', maxLength:10 }),
  Object.freeze({ id:'pic', label:'挂画图片地址', maxLength:2048, type:'image', accept:'image/*' })
]);

// Forms are declared as data by the world definition; the world content module binds to the
// stable `${id}Editor` / `${id}Input` / `${id}Ok` contract through the injected editorHost.
export function createInlineEditors(parent, descriptors = []) {
  const host = document.createElement('div');
  host.className = 'cabin-editors';
  for (const descriptor of descriptors) {
    const id = String(descriptor.id);
    const label = String(descriptor.label || id);
    const form = document.createElement('section');
    form.id = `${id}Editor`;
    form.setAttribute('role','dialog');
    form.setAttribute('aria-label',label);
    const text = document.createElement('label');
    text.textContent = label;
    const input = document.createElement('input');
    input.id = `${id}Input`;
    input.maxLength = Number(descriptor.maxLength) || 40;
    text.htmlFor = input.id;
    const save = document.createElement('button');
    save.type='button'; save.id = `${id}Ok`; save.textContent = '保存';
    const close = document.createElement('button');
    close.type='button'; close.textContent='取消';
    close.addEventListener('click',()=>form.classList.remove('show'));
    form.addEventListener('keydown',event=>{
      event.stopPropagation();
      if(event.key==='Escape') form.classList.remove('show');
    });
    form.append(text,input,save,close);
    if (descriptor.type === 'image') {
      const file=document.createElement('input');
      file.type='file'; file.accept=descriptor.accept || 'image/*';
      file.setAttribute('aria-label',`${label}上传`);
      file.addEventListener('change',()=>{
        const image=file.files?.[0];
        if(!image || !String(image.type || '').startsWith('image/')) return;
        const reader=new FileReader();
        reader.addEventListener('load',()=>{input.value=String(reader.result);save.click();});
        reader.readAsDataURL(image);
      });
      form.append(file);
    }
    host.append(form);
  }
  parent.append(host);
  return host;
}

export function mountWorldInteraction({ world, ui, editor = null, host = null }) {
  const environment = world.environment;
  const viewport = world.rendering?.viewport?.();
  if (!environment || !viewport || !environment.interactions?.length) return null;
  environment.setCamera?.(viewport.camera);
  const controls = document.createElement('div');
  controls.className = 'cabin-views';
  const viewButtons = [];
  for(const view of environment.views || []) {
    const button=document.createElement('button');
    button.type='button'; button.textContent=view.label;
    button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{
      for (const sibling of viewButtons) {
        const active=sibling === button;
        sibling.classList.toggle('active',active);
        sibling.setAttribute('aria-pressed',String(active));
      }
      viewport.camera.position.set(...view.position);
      viewport.controls.target.set(...view.target);
      viewport.controls.update();
    });
    viewButtons.push(button);
    controls.append(button);
  }
  if (typeof environment.setCutaway === 'function') {
    const cutaway=document.createElement('button');
    cutaway.type='button'; cutaway.textContent='显示完整外墙';
    let open=true;
    cutaway.addEventListener('click',()=>{
      open=!open; environment.setCutaway(open);
      cutaway.textContent=open?'显示完整外墙':'剖开房屋';
    });
    controls.append(cutaway);
    controls.applyCutawayState=(value)=>{ open=Boolean(value); cutaway.textContent=open?'显示完整外墙':'剖开房屋'; };
  }
  ui.viewport.append(controls);
  const center=new THREE.Vector3();
  const bounds=new THREE.Box3();
  const catalog=environment.catalog;
  if (catalog) {
    const details=document.createElement('details');
    details.className='cabin-catalog';
    const summary=document.createElement('summary');
    summary.textContent=catalog.label;
    const list=document.createElement('div');
    const listed=new Set();
    for(const item of environment.interactions) {
      const group=catalog.groupOf?.(item) ?? null;
      if(group && listed.has(group)) continue;
      if(group) listed.add(group);
      const button=document.createElement('button');
      button.type='button';
      item.object.getWorldPosition(center);
      const prefix=catalog.labelOf?.(item,center) || null;
      button.textContent=prefix ? `${prefix} · ${item.label}` : item.label;
      button.addEventListener('click',()=>{

        bounds.setFromObject(item.object).getCenter(center);
        viewport.controls.target.copy(center);
        viewport.camera.position.copy(center).add(new THREE.Vector3(2,1.2,-2));
        viewport.controls.update();
        editor?.selectSelection?.({source:'environment',id:item.contractId || item.id});
        details.open=false;
      });
      list.append(button);
    }
    details.append(summary,list);controls.append(details);
  }
  const executeTyped = async command => {
    try {
      const operation=()=>world.commands.executeAffordance(command,{editor:true});
      const result=world.mutate ? await world.mutate('editor:world-action',operation,{source:'editor',...command}) : await operation();
      if(!result.verified && result.status!=='world-state-read') throw new Error(result.reason || result.status);
      persist();
      return result;
    } catch(error) {return {verified:false,reason:error.message};}
  };
  if(host && world.affordances) host.executeWorldEdit=({targetId,text})=>executeTyped({targetId,action:'write',args:{text}});
  const persist=()=>{
    if (!environment.storageKey) return;
    try { localStorage.setItem(environment.storageKey,JSON.stringify(environment.snapshot())); } catch { /* Storage can be disabled. */ }
  };
  const stopInteraction=world.events.on?.('environment.interaction',persist);
  const saved=(()=>{
    if (!environment.storageKey) return null;
    try{return JSON.parse(localStorage.getItem(environment.storageKey)||'null');}catch{return null;}
  })();
  if(saved && environment.restore?.(saved)) controls.applyCutawayState?.(environment.snapshot()?.cutaway);
  if (host) {
    host.addEventListener('click',persist);
    host.addEventListener('keyup',persist);
  }
  return {persist,dispose(){
    persist();
    stopInteraction?.();
    if (host) {
      delete host.executeWorldEdit;
      host.removeEventListener('click',persist);host.removeEventListener('keyup',persist);
    }
    controls.remove();
  }};
}
