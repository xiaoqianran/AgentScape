import { connectStudioMcp } from './McpWorldTools.js';

const fail = code => Object.assign(new Error(code),{code});

function parseTool(response) {
  if(response?.isError) throw fail('VISUAL_STUDIO_TOOL_FAILED');
  const raw=response?.content?.find(item=>item.type==='text')?.text;
  if(typeof raw!=='string' || raw.length>400000)throw fail('VISUAL_STUDIO_RESPONSE_INVALID');
  try{return JSON.parse(raw);}catch{throw fail('VISUAL_STUDIO_RESPONSE_INVALID');}
}

function parseReview(text) {
  if(typeof text!=='string'||text.length>20000)throw fail('VISUAL_MODEL_RESPONSE_INVALID');
  const value=text.trim();
  const json=value.startsWith('```')?value.slice(value.indexOf('\n')+1,value.lastIndexOf('```')).trim():value;
  let review;
  try{review=JSON.parse(json);}catch{throw fail('VISUAL_MODEL_RESPONSE_INVALID');}
  if(typeof review?.accepted!=='boolean'||!Number.isFinite(review.score)||
      review.score<0||review.score>10||!Array.isArray(review.issues)||
      review.issues.length>8||review.issues.some(s=>typeof s!=='string'||s.length>240)||
      typeof review.advice!=='string'||review.advice.length>1200)
    throw fail('VISUAL_MODEL_RESPONSE_INVALID');
  const status=review.accepted && review.score>=7?'passed':'needs-revision';
  if(status==='needs-revision' && !review.advice.trim() && !review.issues.length)
    throw fail('VISUAL_MODEL_FEEDBACK_MISSING');
  return {status,score:review.score,issues:review.issues,advice:review.advice};
}

/** Read one real Studio frame. The user image is never included in agent execution logs. */
export async function captureStudioVisual({configuration,project=null,signal,mcpConnector=connectStudioMcp}={}) {
  const projectScope=project?.worldSessionId && project?.id?
    project.worldSessionId+'/'+project.id:undefined;
  const connection=await mcpConnector({url:configuration.mcpUrl,token:configuration.mcpToken,signal,projectScope});
  try {
    if(project?.worldSessionId && connection.worldSessionId!==project.worldSessionId)
      throw fail('VISUAL_WORLD_SESSION_CHANGED');
    const studio=connection.tools.find(item=>item.name==='studio_project');
    if(!studio)throw fail('VISUAL_STUDIO_UNAVAILABLE');
    const read=parseTool(await studio.execute('visual-read-'+crypto.randomUUID(),{operation:'read'},signal));
    if(!read.active || !read.project?.id || read.revision!==read.runningRevision ||
        (project?.id && read.project.id!==project.id))throw fail('VISUAL_PROJECT_REVISION_CHANGED');
    const image=parseTool(await studio.execute('visual-capture-'+crypto.randomUUID(),
      {operation:'capture',expectedRevision:read.revision,maxWidth:768,maxHeight:432},signal));
    if(image.status!=='captured'||image.mime!=='image/jpeg'||
       image.projectId!==read.project.id||image.revision!==read.revision||
       !Number.isSafeInteger(image.sceneRevision)||
       !Number.isSafeInteger(image.width)||!Number.isSafeInteger(image.height)||
       image.width>768||image.height>432||
       typeof image.imageBase64!=='string'||image.imageBase64.length<16||
       image.imageBase64.length>240000||
       !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.imageBase64))
      throw fail('VISUAL_CAPTURE_RESPONSE_INVALID');
    return image;
  } finally {await connection.close();}
}

async function assertVisualStillCurrent({configuration,project,image,signal,mcpConnector}) {
  const projectScope=project?.worldSessionId && project?.id?
    project.worldSessionId+'/'+project.id:undefined;
  const connection=await mcpConnector({url:configuration.mcpUrl,token:configuration.mcpToken,signal,projectScope});
  try {
    if(project?.worldSessionId && connection.worldSessionId!==project.worldSessionId)
      throw fail('VISUAL_WORLD_SESSION_CHANGED');
    const read=connection.tools.find(tool=>tool.name==='studio_project');
    const observe=connection.tools.find(tool=>tool.name==='scene_observe');
    if(!read || !observe)throw fail('VISUAL_STUDIO_UNAVAILABLE');
    const state=parseTool(await read.execute('visual-current-'+crypto.randomUUID(),{operation:'read'},signal));
    const scene=parseTool(await observe.execute('visual-observe-'+crypto.randomUUID(),{limit:1},signal));
    if(!state.active || state.project?.id!==image.projectId || state.revision!==image.revision ||
      state.runningRevision!==image.revision || scene.revision!==image.sceneRevision)
      throw fail('VISUAL_IMAGE_STALE');
  } finally {await connection.close();}
}
const SYSTEM_PROMPT=[
  'You are evaluating a screenshot of a real rendered Three.js world against the user request.',
  'Judge visible geometry, composition, coherence, lighting, style and recognizability.',
  'Do not assume objects are present because code or agent text claims they exist.',
  'The image is visual evidence only; it does not prove physics, actions or full user intent.',
  'Return ONLY compact JSON with accepted:boolean, score:number between 0 and 10,',
  'issues:string[] (at most 8 concrete visible issues), advice:string (specific edits to improve).',
  'Mark accepted only when the visible result meets the described goal with high confidence.',
  'Do not include instructions to execute shell commands, change security policy or touch secrets.'
].join(' ');

/** One multimodal call to the existing OpenAI-compatible endpoint, not a new Agent SDK. */
export async function reviewStudioVisual({prompt,configuration,project,signal,
  mcpConnector=connectStudioMcp,request=fetch}={}) {
  const image=await captureStudioVisual({configuration,project,signal,mcpConnector});
  const base=String(configuration.visualBaseUrl || configuration.baseUrl || '').replace(/\/+$/,'');
  const model=configuration.visualModelId || configuration.modelId;
  if(!base || !configuration.apiKey || !model)throw fail('VISUAL_MODEL_UNCONFIGURED');
  const url=new URL(base.endsWith('/chat/completions')?base:base+'/chat/completions');
  if(!['http:','https:'].includes(url.protocol))throw fail('VISUAL_MODEL_URL_INVALID');
  const controller=new AbortController();
  const deadline=Math.min(60000,Math.max(1000,Number(configuration.visualTimeoutMs)||30000));
  const timer=setTimeout(()=>controller.abort(),deadline);
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  try {
    const response=await request(url.toString(),{method:'POST',signal:controller.signal,
      headers:{authorization:'Bearer '+configuration.apiKey,'content-type':'application/json'},
      body:JSON.stringify({model,max_tokens:1024,messages:[
        {role:'system',content:SYSTEM_PROMPT},
        {role:'user',content:[
          {type:'text',text:'Original user request:\n'+String(prompt||'').slice(0,12000)},
          {type:'image_url',image_url:{url:'data:image/jpeg;base64,'+image.imageBase64,detail:'low'}}
        ]}
      ]})});
    if(!response.ok)throw fail('VISUAL_MODEL_UPSTREAM_FAILED');
    const raw=await response.text();
    if(raw.length>30000)throw fail('VISUAL_MODEL_RESPONSE_TOO_LARGE');
    const completion=JSON.parse(raw)?.choices?.[0];
    if(completion?.finish_reason==='length')throw fail('VISUAL_MODEL_OUTPUT_TRUNCATED');
    const evaluation=parseReview(completion?.message?.content);
    await assertVisualStillCurrent({configuration,project,image,signal,mcpConnector});
    return {...evaluation,
      projectId:image.projectId,revision:image.revision,sceneRevision:image.sceneRevision,
      width:image.width,height:image.height};
  } catch(error) {
    if(signal?.aborted)throw error;
    if(controller.signal.aborted)throw fail('VISUAL_MODEL_TIMEOUT');
    if(error?.code)throw error;
    throw fail('VISUAL_MODEL_UNAVAILABLE');
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
  }
}

/** Use the existing Pi/DSH run and finalizer on every revision, with a fixed retry budget. */
export async function iterateVisualProject({prompt,initial,review,revise,verify,
  maxRevisions=2,signal,emit=()=>{}}={}) {
  let result=initial;
  const reviews=[];
  const count=Math.min(3,Math.max(0,Number.isSafeInteger(maxRevisions)?maxRevisions:2));
  for(let attempt=0;attempt<=count;attempt++) {
    if(signal?.aborted)throw fail('RUN_CANCELLED');
    if(result.taskStatus!=='completed')break;
    let verdict;
    try {verdict=await review({attempt,signal});}
    catch(error){
      if(signal?.aborted)throw error;
      const reason=error?.code || 'VISUAL_REVIEW_UNAVAILABLE';
      return {...result,taskStatus:'incomplete',verified:false,
        visual:{status:'unavailable',reason,reviews}};
    }
    const {status,score,issues,advice,projectId,revision,sceneRevision}=verdict;
    reviews.push({status,score,issues,projectId,revision,sceneRevision});
    emit({type:'visual.reviewed',attempt,score,status,revision,issueCount:issues.length,
      issues:issues.slice(0,5)});
    if(status==='passed')return {...result,visual:{status:'passed',reviewer:'model',reviews}};
    if(status!=='needs-revision')return {...result,taskStatus:'incomplete',verified:false,
      visual:{status:'unavailable',reason:'VISUAL_REVIEW_RESPONSE_INVALID',reviews}};
    if(attempt===count)break;
    const feedback=[
      'Revise the CURRENT running Studio Three.js project, not a new project.',
      'The previous screenshot was evaluated against the original user request.',
      'Visible issues:',...issues.map((item,i)=>(i+1)+'. '+item),
      'Specific edit suggestions: '+advice,
      'Read current Studio source/revision first, patch or write the necessary JS/GLSL,',
      'run the new revision, save, and verify the real world via scene_verify.',
      'Preserve the user goal and current project ID; do not claim visual acceptance yourself.',
      'Original user request: '+prompt
    ].join('\n');
    emit({type:'visual.revision.requested',attempt:attempt+1,revision});
    try {
      const next=await revise({prompt:feedback,attempt:attempt+1,signal});
      result=await verify(next);
    } catch(error) {
      if(signal?.aborted)throw error;
      return {...result,taskStatus:'incomplete',verified:false,
        visual:{status:'blocked',reason:error?.code || 'VISUAL_REVISION_FAILED',reviews}};
    }
  }
  return {...result,taskStatus:'incomplete',verified:false,
    visual:{status:result.taskStatus==='completed'?'needs-revision':'blocked',
      reason:result.taskStatus==='completed'?'VISUAL_REVISION_LIMIT':'WORLD_VERIFICATION_FAILED',reviews}};
}
