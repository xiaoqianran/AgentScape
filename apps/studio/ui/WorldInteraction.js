import * as THREE from 'three';

// Shared world-first overlay: click-to-interact, in-place text / image editing, camera view
// presets and an optional cutaway toggle. The cabin-prefixed class names are shared with the
// world-first stylesheet so both worlds keep one presentation contract.
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
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const prompt = document.createElement('button');
  prompt.className = 'cabin-interact';
  prompt.type = 'button';
  prompt.hidden = true;
  ui.viewport.append(prompt);
  const controls = document.createElement('div');
  controls.className = 'cabin-views';
  for(const view of environment.views || []) {
    const button=document.createElement('button');
    button.type='button'; button.textContent=view.label;
    button.addEventListener('click',()=>{
      viewport.camera.position.set(...view.position);
      viewport.controls.target.set(...view.target);
      viewport.controls.update();
    });
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
  const byObject = new Map(environment.interactions.map(item=>[item.object,item]));
  const visible = object => {
    for(let node=object;node;node=node.parent) if(!node.visible) return false;
    return true;
  };
  const pick = event => {
    const rect=viewport.element.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    ray.setFromCamera(pointer,viewport.camera);
    const hits=ray.intersectObjects([environment.root,...world.store.list().map(([,record])=>record.object)],true);
    for(const hit of hits) {
      if(!hit.object.isMesh || hit.object.userData.noHit || hit.object.material?.visible===false || hit.object.userData.cabinCollisionProxy || !visible(hit.object)) continue;
      for(let node=hit.object;node;node=node.parent) if(byObject.has(node)) return byObject.get(node);
      // A visible wall or unrelated entity occludes the interaction behind it.
      return null;
    }
    return null;
  };
  let start=null,selected=null;
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
        selected=item;
        bounds.setFromObject(item.object).getCenter(center);
        viewport.controls.target.copy(center);
        viewport.camera.position.copy(center).add(new THREE.Vector3(2,1.2,-2));
        viewport.controls.update();
        editor?.select?.(null);
        prompt.hidden=false;prompt.textContent=item.label;
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
      if(!result.verified && result.status!=='world-state-read') {prompt.hidden=false;prompt.textContent=`未完成：${result.reason || result.status}`;}
      persist();
      return result;
    } catch(error) {prompt.hidden=false;prompt.textContent=`操作失败：${error.message}`;return {verified:false,reason:error.message};}
  };
  if(host && world.affordances) host.executeWorldEdit=({targetId,text})=>executeTyped({targetId,action:'write',args:{text}});
  const activate = async () => {
    if(!selected || !visible(selected.object)) {prompt.hidden=true;return;}
    try {
      const contract=selected.contractId && world.affordances?.get(selected.contractId);
      if(contract && contract.kind!=='text') {
        const state=contract.read();
        const action=contract.kind==='switch'?(state.on?'turn_off':'turn_on'):contract.kind==='book'?(state.out?'return':'pull_out'):(state.requestedOpen?'close':'open');
        await executeTyped({targetId:contract.id,action});
        return;
      }
      selected.activate();
      world.events.emit('environment.interaction',{environmentId:environment.id,id:selected.id,label:selected.label});
    } catch(error) { prompt.textContent=`操作失败：${error.message}`; }
  };
  const down=event=>{
    if(event.button!==0 || editor?.transform?.axis) {start=null;return;}
    start={x:event.clientX,y:event.clientY,id:event.pointerId};
  };
  const up=event=>{
    const previous=start; start=null;
    if(!previous || previous.id!==event.pointerId || Math.hypot(event.clientX-previous.x,event.clientY-previous.y)>=6) return;
    selected=pick(event);
    prompt.hidden=!selected;
    if(!selected) return;
    event.stopImmediatePropagation();
    editor?.select?.(null);
    prompt.textContent=selected.label;
    activate();
  };
  const cancel=()=>{start=null;};
  prompt.addEventListener('click',activate);
  // Capturing prevents a world click from also selecting an unrelated runtime asset.
  viewport.element.addEventListener('pointerdown',down,true);
  viewport.element.addEventListener('pointerup',up,true);
  viewport.element.addEventListener('pointercancel',cancel,true);
  const persist=()=>{
    if (!environment.storageKey) return;
    try { localStorage.setItem(environment.storageKey,JSON.stringify(environment.snapshot())); } catch { /* Storage can be disabled. */ }
  };
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
    viewport.element.removeEventListener('pointerdown',down,true);
    viewport.element.removeEventListener('pointerup',up,true);
    viewport.element.removeEventListener('pointercancel',cancel,true);
    if (host) {
      delete host.executeWorldEdit;
      host.removeEventListener('click',persist);host.removeEventListener('keyup',persist);
      host.remove();
    }
    prompt.remove();controls.remove();
  }};
}
