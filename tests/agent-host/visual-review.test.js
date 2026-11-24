import {describe,it,expect,vi} from 'vitest';
import {captureStudioVisual,reviewStudioVisual,iterateVisualProject} from '../../apps/agent-host/VisualReview.js';
import {buildTaskEvidence,collectSceneChecks} from '../../application/agent/TaskEvidence.js';

const configuration={mcpUrl:'http://127.0.0.1:39015/agent-mcp',mcpToken:'z'.repeat(32),
  apiKey:'test-secret-not-to-log',baseUrl:'https://example.invalid/v1',modelId:'vision-test'};
const jpegBase64=Buffer.from([0xff,0xd8,0xff,0xd9,1,2,3,4,5,6,7,8]).toString('base64');
const project={id:'world_'+ 'f'.repeat(32),worldSessionId:'session-good'};

function bridge({revision=2,active=true,sessionId=project.worldSessionId,imageRevision=revision,
  calls=[],sceneRevision=7,runtimeId='runtime-1',width=640,height=360}={}) {
  return async({projectScope})=>{
    calls.push(['connect',projectScope]);
    return {worldSessionId:sessionId,
      tools:[{name:'scene_observe',execute:async()=>({content:[{type:'text',
        text:JSON.stringify({revision:sceneRevision})}]})},...['studio_project','scene_capture'].map(name=>({name,execute:async(callId,args)=>{
        expect(name).toBe(args.operation==='read'?'studio_project':'scene_capture');
        calls.push([args.operation,args]);
        const value=args.operation==='read'?
          {active,revision,runningRevision:revision,runtimeId,project:{id:project.id}}:
          {status:'captured',mime:'image/jpeg',projectId:project.id,revision:imageRevision,runtimeId,
            sceneRevision,width,height,imageBase64:jpegBase64};
        return {content:[{type:'text',text:JSON.stringify(value)}]};
      }}))],
      close:async()=>{calls.push(['close']);}
    };
  };
}

describe('real Studio frame and multimodal review contract',()=>{
  it('binds capture to running revision and does not leak image through audit outputs',async()=>{
    const calls=[];
    const capture=await captureStudioVisual({configuration,project,mcpConnector:bridge({calls})});
    expect(capture).toMatchObject({revision:2,sceneRevision:7,mime:'image/jpeg',width:640,height:360});
    expect(calls.map(item=>item[0])).toEqual(['connect','read','capture','close']);
    expect(calls[0][1]).toBe(project.worldSessionId+'/'+project.id);
    expect(calls[2][1]).toMatchObject({expectedRevision:2,maxWidth:768,maxHeight:432});
  });
  it('never sends a 1px frame to the vision model',async()=>{
    const request=vi.fn();
    await expect(reviewStudioVisual({prompt:'tree',configuration,project,
      mcpConnector:bridge({width:1,height:1}),request})).rejects.toThrow('VISUAL_CAPTURE_RESPONSE_INVALID');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects stale revision or changed world session before evaluating pixels',async()=>{
    await expect(captureStudioVisual({configuration,project,
      mcpConnector:bridge({imageRevision:1})})).rejects.toThrow('VISUAL_CAPTURE_RESPONSE_INVALID');
    await expect(captureStudioVisual({configuration,project,
      mcpConnector:bridge({sessionId:'other'})})).rejects.toThrow('VISUAL_WORLD_SESSION_CHANGED');
    await expect(captureStudioVisual({configuration,project,
      mcpConnector:bridge({active:false})})).rejects.toThrow('VISUAL_PROJECT_REVISION_CHANGED');
  });
  it('sends the actual JPEG to the existing OpenAI-compatible model, returns only bounded feedback',async()=>{
    const request=vi.fn(async (_url,init)=>{
      const data=JSON.parse(init.body);
      expect(data.model).toBe('vision-test');
      expect(data.messages[1].content[0].text).toContain('苹果树');
      expect(data.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,'+jpegBase64);
      return {ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({
        accepted:false,score:5,issues:['树冠没有叶子'],advice:'增加绿色叶片和可见枝杈'
      })}}]})};
    });
    const result=await reviewStudioVisual({prompt:'制作一棵精致苹果树',configuration,project,
      mcpConnector:bridge(),request});
    expect(result).toMatchObject({status:'needs-revision',score:5,revision:2,issues:['树冠没有叶子']});
    expect(JSON.stringify(result)).not.toContain(jpegBase64);
    expect(JSON.stringify(result)).not.toContain(configuration.apiKey);
    expect(request).toHaveBeenCalledOnce();
    expect(result.sceneRevision).toBe(7);
  });
  it('refuses model acceptance when Studio source changes after the screenshot',async()=>{
    let connections=0;
    const connector=async options=>{
      connections++;
      return bridge({revision:connections===1?2:3})(options);
    };
    const request=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:
      JSON.stringify({accepted:true,score:9,issues:[],advice:''})}}]})});
    await expect(reviewStudioVisual({prompt:'tree',configuration,project,
      mcpConnector:connector,request})).rejects.toThrow('VISUAL_IMAGE_STALE');
    expect(connections).toBe(2);
  });
  it('rejects a screenshot from another scene revision before charging the vision model',async()=>{
    const request=vi.fn();
    await expect(reviewStudioVisual({prompt:'tree',configuration,project,
      expectedWorld:{worldSessionId:project.worldSessionId,projectId:project.id,projectRevision:2,runtimeId:'runtime-1',sceneRevision:6},
      mcpConnector:bridge(),request})).rejects.toThrow('VISUAL_VERIFIED_WORLD_CHANGED');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a rerun with identical numeric revisions during model review',async()=>{
    let connections=0;
    const connector=async options=>bridge({runtimeId:++connections===1?'runtime-1':'runtime-2'})(options);
    const request=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:JSON.stringify({accepted:true,score:9,issues:[],advice:''})}}]})});
    await expect(reviewStudioVisual({prompt:'tree',configuration,project,mcpConnector:connector,request})).rejects.toThrow('VISUAL_IMAGE_STALE');
  });
  it('retries malformed output once on the same frame and accounts for both requests',async()=>{
    const request=vi.fn(async(_url,options)=>({ok:true,text:async()=>JSON.stringify({usage:{total_tokens:100},choices:[{message:{content:request.mock.calls.length===1?'{}':JSON.stringify({accepted:false,score:3,issues:['Missing foliage'],advice:'Add connected branches and dense leaves'})}}]})}));
    const result=await reviewStudioVisual({prompt:'apple tree',configuration,project,mcpConnector:bridge(),request});
    expect(request).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({status:'needs-revision',score:3,modelRequests:2,usage:{total_tokens:200}});
    expect(JSON.parse(request.mock.calls[1][1].body).messages[0].content).toContain('Previous response violated');
    expect(JSON.parse(request.mock.calls[0][1].body).messages[1]).toEqual(JSON.parse(request.mock.calls[1][1].body).messages[1]);
  });
  it('does not accept malformed or unsupported vision responses',async()=>{
    const request=async()=>({ok:true,text:async()=>JSON.stringify({choices:[{message:{content:'{}'}}]})});
    await expect(reviewStudioVisual({prompt:'apple tree',configuration,project,
      mcpConnector:bridge(),request})).rejects.toThrow('VISUAL_MODEL_RESPONSE_INVALID');
  });
});

function pending(revision=2,binding={}){
  const world={worldSessionId:project.worldSessionId,projectId:project.id,projectRevision:revision,runtimeId:'runtime-'+revision,sceneRevision:7,...binding};
  const criterion={id:'valid',kind:'world-valid'};
  const records=collectSceneChecks({schema:'agentscape.scene-result',operation:'verify',status:'succeeded',
    verification:{status:'verified',evidence:{status:'world-accepted',checks:[{...criterion,verified:true}]}}},[criterion]).records;
  return {taskStatus:'awaiting-visual',verified:false,world,verification:{scope:'world-state',status:'verified',reason:'VISUAL_REVIEW_PENDING'},
    evidence:buildTaskEvidence({world,scope:'world-state',records,bound:true,worldReady:true,visualRequired:true})};
}
const verdict=(world,details)=>({...world,revision:world.projectRevision,imageDigest:'a'.repeat(64),...details});

describe('Pi/DSH independent visual revision loop',()=>{
  it('revises source using observed feedback, re-verifies and stops after visual acceptance',async()=>{
    const prompts=[],events=[],seen=[];
    const reviews=[
      {status:'needs-revision',score:4,issues:['缺少苹果'],advice:'增加红苹果',revision:1},
      {status:'passed',score:9,issues:[],advice:'',revision:2}
    ];
    const result=await iterateVisualProject({prompt:'漂亮的苹果树',initial:pending(1),
      review:async({world})=>verdict(world,reviews.shift()),
      revise:async({prompt})=>{prompts.push(prompt);return {execution:[{tool:'studio_project'}]};},
      verify:async outcome=>{seen.push(outcome);return pending(2);},
      emit:item=>events.push(item)});
    expect(result).toMatchObject({taskStatus:'completed',verified:true,
      visual:{status:'passed',reviewer:'model'}});
    expect(result.visual.reviews).toHaveLength(2);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('增加红苹果');
    expect(prompts[0]).toContain('漂亮的苹果树');
    expect(events.map(e=>e.type)).toEqual(['visual.reviewed','visual.revision.requested','visual.reviewed']);
    expect(seen).toHaveLength(1);
  });
  it('refuses a verdict not bound to the Host verified world',async()=>{
    const world={worldSessionId:project.worldSessionId,projectId:project.id,projectRevision:2,runtimeId:'runtime-1',sceneRevision:7};
    const result=await iterateVisualProject({prompt:'tree',initial:pending(2,world),
      review:async({world:expected})=>{
        expect(expected).toEqual(world);
        return {status:'passed',score:10,issues:[],advice:'',worldSessionId:world.worldSessionId,projectId:world.projectId,revision:2,runtimeId:'runtime-2',sceneRevision:7};
      }});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,visual:{status:'unavailable',reason:'VISUAL_VERIFIED_WORLD_CHANGED'}});
  });
  it('caps revisions and never claims success from a rejected visual image',async()=>{
    let edits=0;
    const result=await iterateVisualProject({prompt:'make a house',initial:pending(),
      maxRevisions:2,review:async({world})=>verdict(world,{status:'needs-revision',score:2,issues:['empty'],advice:'add walls'}),
      revise:async()=>{edits++;return {};},
      verify:async()=>pending(2+edits)});
    expect(edits).toBe(2);
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
      visual:{status:'needs-revision',reason:'VISUAL_REVISION_LIMIT'}});
    expect(result.visual.reviews).toHaveLength(3);
  });
  it('keeps the last verified world and reports code-revision failure without crashing the host',async()=>{
    const result=await iterateVisualProject({prompt:'build a house',
      initial:pending(),
      review:async({world})=>verdict(world,{status:'needs-revision',score:4,issues:['roof missing'],advice:'add roof'}),
      revise:async()=>{throw Object.assign(Error('syntax'),{code:'PROJECT_MODULE_SYNTAX'});}});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
      visual:{status:'blocked',reason:'PROJECT_MODULE_SYNTAX'}});
    expect(result.verification.scope).toBe('world-state');
  });
  it('preserves world state evidence but marks missing vision unavailable',async()=>{
    const result=await iterateVisualProject({prompt:'tree',initial:pending(),
      review:async()=>{throw Object.assign(new Error('no webgl'),{code:'VISUAL_CANVAS_UNAVAILABLE'});}});
    expect(result).toMatchObject({taskStatus:'incomplete',verified:false,
      verification:{scope:'world-state',status:'verified'},
      visual:{status:'unavailable',reason:'VISUAL_CANVAS_UNAVAILABLE'}});
  });
});
