// Adapters describe source state explicitly. They never expose arbitrary callbacks
// or claim that an animated hinge is a force-verified articulated asset.
export function createCabinAffordances({hinges,switches,texts,drawers,books}) {
  const contracts=[];
  const hingeNames=['front-left-window','front-right-window','left-window','attic-window','right-window','back-window','front-door','wardrobe-left','wardrobe-right'];
  hinges.forEach((object,index)=>{
    const spring=object.userData.spring;
    contracts.push({
      id:`cabin:${hingeNames[index] || `hinge-${index}`}`,label:object.userData.aimLabel || '门窗',object,
      kind:'hinge',actions:['open','close'],evidenceKind:'animated-transform',colliderId:`cabin:hinge:${index}`,
      read:()=>({requestedOpen:spring.open,openness:spring.cur,velocity:spring.vel,angle:object.rotation.y}),
      request:action=>{const desired=action==='open';if(spring.open!==desired) {if(object.userData.onToggle)object.userData.onToggle();else spring.open=desired;}},
      verify:action=>Math.abs(spring.cur-(action==='open'?1:0))<.015 && Math.abs(spring.vel)<.003 && Math.abs(object.rotation.y-(object.userData.base+object.userData.delta*spring.cur))<.001,
      capture:()=>({cur:spring.cur,vel:spring.vel,open:spring.open && !object.userData.closing}),
      restore:value=>{Object.assign(spring,value);object.rotation.y=object.userData.base+object.userData.delta*spring.cur;}
    });
  });
  for(const entry of switches) contracts.push({
    ...entry,kind:'switch',actions:['turn_on','turn_off'],evidenceKind:'device-state',
    read:()=>({on:entry.get()}),request:action=>entry.set(action==='turn_on'),
    verify:action=>entry.get()===(action==='turn_on'),capture:()=>({on:entry.get()}),restore:value=>entry.set(value.on)
  });
  for(const entry of texts) contracts.push({
    ...entry,kind:'text',actions:['read','write'],evidenceKind:'text-state',
    read:()=>({text:entry.get()}),request:(_action,args)=>entry.set(args.text),
    verify:(_action,args)=>entry.get()===args.text,capture:()=>({text:entry.get()}),restore:value=>entry.set(value.text),
    validate:(action,args)=>action==='write' && (typeof args.text!=='string' || args.text.length>100) ? 'TEXT_MUST_BE_AT_MOST_100_CHARACTERS' : null
  });
  for(const object of drawers) {
    const slide=object.userData.slide;
    contracts.push({id:object.name==='wardrobeDrawerG'?'cabin:wardrobe-drawer':'cabin:bedside-drawer',label:object.userData.aimLabel || '抽屉',object,kind:'drawer',actions:['open','close'],evidenceKind:'animated-transform',
      precondition:action=>object.name==='wardrobeDrawerG' && action==='open' && !hinges.slice(7,9).every(hinge=>hinge.userData.spring.open && !hinge.userData.closing) ? 'WARDROBE_DOORS_MUST_BE_OPEN' : null,
      read:()=>({requestedOpen:slide.open,openness:slide.cur,velocity:slide.vel,position:object.position[slide.axis]}),
      request:action=>{if(slide.open!==(action==='open'))object.userData.onClick();},
      verify:action=>Math.abs(slide.cur-(action==='open'?1:0))<.015 && Math.abs(slide.vel)<.003,
      capture:()=>({cur:slide.cur,vel:slide.vel,open:slide.open}),
      restore:value=>{Object.assign(slide,value);object.position[slide.axis]=slide.base+slide.dist*slide.cur;}
    });
  }
  books.forEach((object,index)=>{
    const state=object.userData;
    contracts.push({id:`cabin:shelf-book-${index+1}`,label:`书架上的书 ${index+1}`,object,kind:'book',actions:['pull_out','return'],evidenceKind:'animated-transform',
      read:()=>({out:state.out,displacement:state.cur,velocity:state.vel}),request:action=>{state.out=action==='pull_out';},
      position:[state.bx+.3,object.position.y+.2,object.position.z],
      verify:action=>Math.abs(state.cur-(action==='pull_out'?1:0))<.01 && Math.abs(state.vel)<.003,
      capture:()=>({out:state.out,cur:state.cur,vel:state.vel}),restore:value=>{Object.assign(state,value);object.position.x=state.bx+.11*state.cur;}
    });
  });
  for(const entry of contracts) {
    const restore=entry.restore;
    entry.validateSnapshot=value=>{
      const template=entry.capture();
      if(!value || typeof value!=='object' || Array.isArray(value))return false;
      return Object.entries(template).every(([key,example])=>typeof value[key]===typeof example &&
        (typeof example==='number'?Number.isFinite(value[key]):typeof example==='string'?value[key].length<=100:true));
    };
    entry.restore=value=>{
      if(!entry.validateSnapshot(value))throw new TypeError(`Invalid affordance snapshot: ${entry.id}`);
      restore(Object.fromEntries(Object.keys(entry.capture()).map(key=>[key,value[key]])));
    };
  }
  return contracts;
}
