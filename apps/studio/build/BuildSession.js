export const BUILD_MODES = Object.freeze(['image','asset','world']);

export const BUILD_MODE_META = Object.freeze({
  image:{label:'图片资产',title:'从图片制作物体',description:'导入图片 → 选择物体 → 确认 → 生成 3D → 放置',steps:['准备图片','确认物体','生成资产']},
  asset:{label:'3D Asset',title:'从已确认图片生成 3D 资产',description:'Approved Image → 3D → Compile → Asset',steps:['确认图片输入','生成 3D','编译与准入','Asset Ready']},
  world:{label:'World',title:'生成世界',description:'Text → Reference → World → Environment',steps:['理解输入','生成参考','生成世界','导入 World Bundle']}
});

const clone=(value)=>value==null?value:structuredClone(value);
const assertMode=(mode)=>{
  if(!BUILD_MODES.includes(mode)) throw new TypeError(`Unsupported build mode: ${mode}`);
  return mode;
};

function initialSteps(mode) {
  return BUILD_MODE_META[mode].steps.map((label,index)=>({id:`step_${index+1}`,label,status:'pending',detail:null}));
}

export class BuildSession {
  constructor({mode='asset',onChange=()=>{}}={}) {
    this.onChange=onChange;
    this.state={mode:assertMode(mode),status:'idle',prompt:'',result:null,error:null,startedAt:null,completedAt:null,steps:initialSteps(mode)};
  }

  snapshot(){return clone(this.state);}

  emit(){const snapshot=this.snapshot();this.onChange(snapshot);return snapshot;}

  setMode(mode) {
    mode=assertMode(mode);
    if(this.state.status==='running') return this.snapshot();
    this.state={mode,status:'idle',prompt:'',result:null,error:null,startedAt:null,completedAt:null,steps:initialSteps(mode)};
    return this.emit();
  }

  begin(prompt,{mode=this.state.mode}={}) {
    mode=assertMode(mode);
    this.state={mode,status:'running',prompt:String(prompt||'').trim(),result:null,error:null,startedAt:Date.now(),completedAt:null,steps:initialSteps(mode)};
    this.state.steps[0].status='completed';
    if(this.state.steps[1]) this.state.steps[1].status='running';
    return this.emit();
  }

  stage(index,detail=null) {
    if(this.state.status!=='running') return this.snapshot();
    const position=Math.max(0,Math.min(this.state.steps.length-1,Number(index)||0));
    for(let i=0;i<this.state.steps.length;i+=1){
      if(i<position) this.state.steps[i].status='completed';
      else if(i===position) this.state.steps[i].status='running';
      else this.state.steps[i].status='pending';
      if(i===position&&detail!=null) this.state.steps[i].detail=String(detail);
    }
    return this.emit();
  }

  complete(result) {
    for(const step of this.state.steps) step.status='completed';
    this.state.status='success';
    this.state.result=clone(result);
    this.state.error=null;
    this.state.completedAt=Date.now();
    return this.emit();
  }

  fail(error) {
    const active=this.state.steps.find((step)=>step.status==='running');
    if(active) active.status='error';
    this.state.status='error';
    this.state.error={code:error?.code||null,message:error?.message||String(error||'Build failed')};
    this.state.completedAt=Date.now();
    return this.emit();
  }
}
