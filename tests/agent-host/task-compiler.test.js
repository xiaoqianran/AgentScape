import { describe,it,expect,vi } from 'vitest';
import { buildTaskSpec,compileTaskSpecWithModel } from '../../apps/agent-host/TaskCompiler.js';
import { compileTaskSpec,GOLDEN_TASKS } from '../../apps/agent-host/TaskSpec.js';
import { createAgentHost } from '../../apps/agent-host/AgentHost.mjs';
import { finalizeRun } from '../../apps/agent-host/AgentRunFinalizer.js';
import { normalizeExecution } from '../../apps/agent-host/AgentExecution.js';

const config={baseUrl:'http://127.0.0.1:9753/v1',apiKey:'private-secret',modelId:'test-model',mcpToken:'m'.repeat(32)};
const prompt='创建一辆红色跑车，有四个轮子，车门可以打开';
const proposal={complete:true,requirements:[
  {kind:'entity',quote:'跑车',targetId:'car',count:1},
  {kind:'entity',quote:'四个轮子',targetId:'wheel',count:4},
  {kind:'entity',quote:'车门',targetId:'door',count:1},
  {kind:'action',quote:'车门可以打开',targetId:'door',capability:'OPEN',source:'project'},
  {kind:'visual',quote:'红色',description:'红色车身'}
]};
const mockResult=content=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});
const response=value=>({content:[{type:'text',text:JSON.stringify(value)}]});

describe('general TaskCompiler acceptance boundary',()=>{
  it('preserves exact golden criteria without an unnecessary model call',async()=>{
    const request=vi.fn();
    for(const entry of GOLDEN_TASKS){
      const result=await compileTaskSpecWithModel(entry.prompt,{configuration:config,request});
      expect(result).toEqual(compileTaskSpec(entry.prompt));
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('expands counted entities and preserves action and visual requirements',()=>{
    const spec=buildTaskSpec(prompt,proposal);
    expect(spec.status).toBe('ready');
    expect(spec.source).toBe('model-proposal');
    expect(spec.requiredChecks.filter(item=>item.kind==='object-exists').map(item=>item.targetId))
      .toEqual(['car','wheel_01','wheel_02','wheel_03','wheel_04','door']);
    expect(spec.requiredChecks.at(-1)).toMatchObject({
      kind:'interaction-verified',targetId:'door',capability:'OPEN',source:'project'
    });
    expect(spec.visual.required).toBe(true);
    expect(spec.requirements).toEqual(proposal.requirements.map(item=>
      item.kind==='entity'?{...item,count:item.count}:item
    ));
  });

  it('enforces original counts, literal provenance, bounded schema and conservative coverage',()=>{
    expect(()=>buildTaskSpec(prompt,{...proposal,requirements:[
      {...proposal.requirements[1],count:3},...proposal.requirements.slice(2)
    ]})).toThrow('TASK_COUNT_MISMATCH');
    expect(()=>buildTaskSpec(prompt,{...proposal,requirements:[
      {...proposal.requirements[0],quote:'不存在的原始文字'},...proposal.requirements.slice(1)
    ]})).toThrow('TASK_SOURCE_QUOTE_MISMATCH');
    expect(buildTaskSpec(prompt,{complete:true,requirements:[
      {kind:'entity',quote:'跑车',targetId:'car'}
    ]})).toMatchObject({status:'review-required',reason:'TASK_SPEC_REVIEW_REQUIRED'});
    expect(()=>buildTaskSpec(prompt,{...proposal,requirements:[
      {...proposal.requirements[0],arbitrary:'injection'},...proposal.requirements.slice(1)
    ]})).toThrow();
    expect(()=>buildTaskSpec(prompt,{...proposal,requirements:[
      {...proposal.requirements[0],targetId:'../../escaped'},...proposal.requirements.slice(1)
    ]})).toThrow();
  });

  it('makes unsupported requirements and uncertain parsing explicit instead of claiming success',()=>{
    const partial=buildTaskSpec('建造带电梯的房屋',{complete:true,requirements:[
      {kind:'entity',quote:'房屋',targetId:'house'},
      {kind:'unverifiable',quote:'电梯',description:'不能验证电梯功能'}
    ]});
    expect(partial.status).toBe('review-required');
    expect(partial.compilation.unverifiableCount).toBe(1);
    expect(partial.requiredChecks).toEqual(expect.arrayContaining([
      expect.objectContaining({kind:'object-exists',targetId:'house'})
    ]));
    expect(buildTaskSpec(prompt,{...proposal,complete:false}).status).toBe('review-required');
    expect(buildTaskSpec('创建一辆红色跑车',{complete:true,requirements:[
      {kind:'entity',quote:'跑车',targetId:'car'},
      {kind:'state',quote:'红色',targetId:'car',stateKey:'color',value:'red'}
    ]}).visual.required).toBe(true);
  });

  it('refuses to truncate large counts or weaken deterministic excessive counts',()=>{
    const lots='创建16个轮子和16个车灯';
    const spec=buildTaskSpec(lots,{complete:true,requirements:[
      {kind:'entity',quote:'16个轮子',targetId:'wheel',count:16},
      {kind:'entity',quote:'16个车灯',targetId:'light',count:16}
    ]});
    expect(spec).toMatchObject({status:'review-required',reason:'TASK_CRITERIA_LIMIT',requiredChecks:[]});
    const apples='创建一棵有20个苹果的苹果树';
    const downgraded=buildTaskSpec(apples,{complete:true,requirements:[
      {kind:'entity',quote:'苹果树',targetId:'apple_tree'}
    ]});
    expect(downgraded).toMatchObject({status:'review-required',reason:'TASK_SPEC_COUNT_UNSUPPORTED'});
  });

  it('calls the configured model only once without leaking credentials into the task spec',async()=>{
    const request=vi.fn(async()=>mockResult(proposal));
    const spec=await compileTaskSpecWithModel(prompt,{configuration:config,request});
    expect(spec.status).toBe('ready');
    expect(request).toHaveBeenCalledTimes(1);
    const [url,options]=request.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9753/v1/chat/completions');
    expect(JSON.parse(options.body).messages[1].content).toContain(prompt);
    expect(JSON.stringify(spec)).not.toContain(config.apiKey);
  });

  it('fails closed on provider and response failures, and allows caller cancellation',async()=>{
    const invalid=async()=>new Response('not-json',{status:200});
    const missing=await compileTaskSpecWithModel('创建一个机器人',{configuration:config,request:invalid});
    expect(missing).toMatchObject({status:'review-required',compilation:{status:'unavailable'}});
    expect(missing.requiredChecks).toHaveLength(0);
    const down=await compileTaskSpecWithModel(prompt,{configuration:config,
      request:async()=>new Response('{}',{status:502})});
    expect(down.status).toBe('review-required');
    const wrongSource=await compileTaskSpecWithModel(prompt,{configuration:config,
      request:async()=>mockResult({...proposal,requirements:[{kind:'entity',quote:'Mars rover',targetId:'car'}]})});
    expect(wrongSource.status).toBe('review-required');
    const controller=new AbortController();
    controller.abort();
    await expect(compileTaskSpecWithModel(prompt,{configuration:config,signal:controller.signal,
      request:async(_url,{signal})=>{if(signal.aborted)throw new Error('aborted');return mockResult(proposal);}}))
      .rejects.toThrow('aborted');
  });

  it('connects model-derived checks through HTTP Agent Host to both backends',async()=>{
    for(const backend of ['pi','dsh']){
      let observed;
      const host=createAgentHost({config:{...config,dshPatch:'restricted.yml',dshProvider:'test',dshModel:'test',taskAcceptanceMode:'strict'},
        port:0,compileTask:(goal,options)=>compileTaskSpecWithModel(goal,{...options,request:async()=>mockResult(proposal)}),
        backends:{pi:async args=>{observed=args.prompt;return {taskStatus:'incomplete',execution:[]};},
          dsh:async args=>{observed=args.prompt;return {taskStatus:'incomplete',execution:[]};}},
        attachSession:async()=> 'world-test'});
      await host.listen();
      try{
        const response=await fetch('http://127.0.0.1:'+host.server.address().port+'/run',{
          method:'POST',headers:{origin:'http://localhost:5173','content-type':'application/json'},
          body:JSON.stringify({backend,prompt,runId:'compiler_test_'+backend})
        });
        expect(response.status).toBe(200);
        const output=await response.json();
        expect(output.taskSpec.requiredChecks).toEqual(expect.arrayContaining([
          expect.objectContaining({targetId:'wheel_04'})
        ]));
        expect(observed).toContain('wheel_04');
        expect(output.verified).toBe(false);
      }finally{await host.close();}
    }
  });
});

describe('general TaskSpec is still independently verified at runtime',()=>{
  const spec=buildTaskSpec('创建一辆跑车，有四个轮子',{complete:true,requirements:[
    {kind:'entity',quote:'跑车',targetId:'car'},
    {kind:'entity',quote:'四个轮子',targetId:'wheel',count:4}
  ]});
  const criteria=[{id:'model-world',kind:'world-valid'}];
  const execution=normalizeExecution('pi',[
    {name:'scene_apply',callId:'edit',args:{operations:[]},result:response({status:'succeeded'})},
    {name:'scene_verify',callId:'verify',args:{criteria},
      result:response({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
        verification:{status:'verified',evidence:{status:'world-accepted',
          checks:[{id:'model-world',kind:'world-valid',verified:true}]}}})}
  ]);
  function bridge(objects,actions=[]){
    let checked=[];
    return {checks:()=>checked,connect:async()=>({
      worldSessionId:'world-compiler',
      tools:['scene_observe','scene_verify'].map(name=>({name,execute:async(_id,args)=>{
        if(name==='scene_observe')return response({revision:9});
        checked=args.criteria;
        const checks=checked.map(item=>{
          const verified=item.kind==='world-valid'||(item.kind==='object-exists'&&objects.includes(item.targetId))||
            (item.kind==='interaction-verified'&&actions.includes(item.targetId+'.'+item.capability));
          if(item.kind==='interaction-verified')return {...item,expected:item.capability,verified,
            ...(verified?{evidence:{schema:'agentscape.interaction-evidence',schemaVersion:1,verified:true,
              worldRevisionId:'session:test-runtime',targetId:item.targetId,capability:item.capability,
              source:item.source==='project'?'project-defined':item.source==='asset'?'physical-articulation':item.source||'project-defined'}}:{})};
          return {...item,verified};
        });
        const ok=checks.every(item=>item.verified);
        return response({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',revision:9,
          verification:{status:ok?'verified':'unverified',evidence:{status:ok?'world-accepted':'world-incomplete',checks}}});
      }})),close:async()=>{}
    })};
  }
  it('cannot complete a car that is missing its fourth wheel',async()=>{
    const runtime=bridge(['car','wheel_01','wheel_02','wheel_03']);
    const result=await finalizeRun({output:{backend:'pi',worldSessionId:'world-compiler',execution},taskSpec:spec,
      configuration:{mcpToken:config.mcpToken,mcpUrl:'http://127.0.0.1/unused'},
      mcpConnector:runtime.connect});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
      verification:{reason:'SCENE_VERIFICATION_FAILED'}});
    expect(runtime.checks()).toEqual(expect.arrayContaining([
      expect.objectContaining({targetId:'wheel_04'})
    ]));
  });
  it('does not claim visual completion from structural and action checks alone',async()=>{
    const visualSpec=buildTaskSpec(prompt,proposal);
    const runtime=bridge(['car','wheel_01','wheel_02','wheel_03','wheel_04','door'],['door.OPEN']);
    const result=await finalizeRun({output:{backend:'pi',worldSessionId:'world-compiler',execution},taskSpec:visualSpec,
      configuration:{mcpToken:config.mcpToken,mcpUrl:'http://127.0.0.1/unused'},mcpConnector:runtime.connect});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
      verification:{reason:'VISUAL_REVIEW_PENDING'}});
  });
  it('accepts all deterministic checks only after fresh world verification',async()=>{
    const runtime=bridge(['car','wheel_01','wheel_02','wheel_03','wheel_04']);
    const result=await finalizeRun({output:{backend:'dsh',worldSessionId:'world-compiler',execution},taskSpec:spec,
      configuration:{mcpToken:config.mcpToken,mcpUrl:'http://127.0.0.1/unused'},
      mcpConnector:runtime.connect});
    expect(result.taskStatus).toBe('completed');
    expect(result.verification.checks).toHaveLength(6);
  });
});

describe('domain-independent entity acceptance contracts',()=>{
  it.each([
    ['创建一座高塔','高塔','tower'],
    ['生成一条河流','河流','river'],
    ['制作一台机器人','机器人','robot'],
    ['建造一座城堡','城堡','castle'],
    ['创建一个喷泉','喷泉','fountain'],
    ['创建一间温室','温室','greenhouse'],
    ['创建一座桥梁','桥梁','bridge'],
    ['创建一个游乐场','游乐场','playground'],
    ['创建一个工厂','工厂','factory'],
    ['创建一台起重机','起重机','crane']
  ])('accepts a valid schema for %s without a dedicated template',(goal,quote,id)=>{
    const spec=buildTaskSpec(goal,{complete:true,requirements:[{kind:'entity',quote,targetId:id}]});
    expect(spec.status).toBe('ready');
    expect(spec.requiredChecks).toEqual([{id:'task-generated-01',kind:'object-exists',targetId:id}]);
  });
});

describe('Agent Host compilation cancellation',()=>{
  it('returns cancelled without running the backend when cancelled during model compilation',async()=>{
    let started;
    const compiling=new Promise(resolve=>{started=resolve;});
    const backend=vi.fn();
    const host=createAgentHost({config:{...config,taskAcceptanceMode:'strict'},port:0,
      compileTask:(_prompt,{signal})=>{
        started();
        return new Promise((_resolve,reject)=>{
          signal.addEventListener('abort',()=>reject(new Error('COMPILATION_ABORTED')),{once:true});
        });
      },
      backends:{pi:backend,dsh:backend}});
    await host.listen();
    try{
      const url='http://127.0.0.1:'+host.server.address().port;
      const run=fetch(url+'/run',{method:'POST',
        headers:{origin:'http://localhost:5173','content-type':'application/json'},
        body:JSON.stringify({runId:'compile_cancel_123',backend:'pi',prompt:'创建一个机器人'})
      });
      await compiling;
      const cancel=await fetch(url+'/cancel',{method:'POST',
        headers:{origin:'http://localhost:5173','content-type':'application/json'},
        body:JSON.stringify({runId:'compile_cancel_123'})
      });
      expect(cancel.status).toBe(200);
      const response=await run;
      expect(response.status).toBe(200);
      const result=await response.json();
      expect(result).toMatchObject({taskStatus:'cancelled',verified:false,
        verification:{reason:'RUN_CANCELLED'}});
      expect(result.events.at(-1)).toMatchObject({type:'run.finished',taskStatus:'cancelled'});
      expect(backend).not.toHaveBeenCalled();
    }finally{await host.close();}
  });
});

describe('live-model failure guards and model selection',()=>{
  const car='创建一辆有四个轮子的汽车，车门能够打开';
  it('refuses property substitutions for counted parts and interactive behaviors',()=>{
    const bad={
      complete:true,requirements:[
        {kind:'entity',quote:'汽车',targetId:'car'},
        {kind:'state',quote:'有四个轮子',targetId:'car',stateKey:'wheel_count',value:4},
        {kind:'state',quote:'车门能够打开',targetId:'car',stateKey:'door_openable',value:true}
      ]
    };
    const result=buildTaskSpec(car,bad);
    expect(result.status).toBe('review-required');
    expect(result.compilation).toMatchObject({missingCountMentions:1,missingAbilityMentions:1});
    expect(result.requiredChecks.every(item=>item.kind!=='state-equals')).toBe(true);
  });
  it('rejects a broad quotation that hides missing subrequirements',()=>{
    const result=buildTaskSpec(car,{complete:true,requirements:[
      {kind:'entity',quote:car,targetId:'car',count:1}
    ]});
    expect(result.status).toBe('review-required');
  });
  it('disables reasoning on Nemotron 3.5 and supports a separate compiler model',async()=>{
    const request=vi.fn(async()=>mockResult({complete:true,requirements:[
      {kind:'entity',quote:'机器人',targetId:'robot'}
    ]}));
    const result=await compileTaskSpecWithModel('创建一个机器人',{
      configuration:{...config,modelId:'main-model',taskCompilerModelId:'nvidia/nemotron-3.5-super-vl-120b-a12b'},
      request
    });
    expect(result.status).toBe('ready');
    const body=JSON.parse(request.mock.calls[0][1].body);
    expect(body.model).toBe('nvidia/nemotron-3.5-super-vl-120b-a12b');
    expect(body.chat_template_kwargs).toEqual({enable_thinking:false});
  });
  it('never accepts truncated reasoning without final content',async()=>{
    const reply={choices:[{message:{content:null,reasoning_content:'thoughts'},finish_reason:'length'}]};
    const result=await compileTaskSpecWithModel('创建一个机器人',{configuration:config,
      request:async()=>new Response(JSON.stringify(reply),{status:200})});
    expect(result.status).toBe('review-required');
  });
});

describe('Chinese quantity audit for diverse classifiers',()=>{
  it('does not silently discard numbered towers, machines and lamps',()=>{
    for(const [prompt,noun,id] of [
      ['创建一座城堡，有两座塔楼','塔楼','tower'],
      ['创建一个工厂，有两台机器','机器','machine'],
      ['创建一条街道，有三盏路灯','路灯','lamp']
    ]){
      const wrong=buildTaskSpec(prompt,{complete:true,requirements:[
        {kind:'entity',quote:prompt.includes('城堡')?'城堡':prompt.includes('工厂')?'工厂':'街道',targetId:'root'},
        {kind:'entity',quote:noun,targetId:id}
      ]});
      expect(wrong).toMatchObject({status:'review-required',
        compilation:{missingCountMentions:1}});
    }
  });
  it('accepts explicitly counted tower requirements from the original text',()=>{
    const prompt='创建一座城堡，有两座塔楼';
    const spec=buildTaskSpec(prompt,{complete:true,requirements:[
      {kind:'entity',quote:'城堡',targetId:'castle'},
      {kind:'entity',quote:'两座塔楼',targetId:'tower',count:2}
    ]});
    expect(spec.status).toBe('ready');
    expect(spec.requiredChecks.map(x=>x.targetId)).toEqual(['castle','tower_01','tower_02']);
  });
});
