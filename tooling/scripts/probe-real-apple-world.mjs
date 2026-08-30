import * as THREE from "three";
import { SkillRegistry } from "../../agent/skills/SkillRegistry.js";
import { registerCoreSkills } from "../../agent/skills/registerCoreSkills.js";
import { assetAdmission } from "../../asset/admission.js";
import { ConnectorClient } from "../../generation/connector/ConnectorClient.js";
import { attachGenerationRuntime } from "../../generation/orchestration/GenerationRuntime.js";
import { createAssetModule } from "../../generation/orchestration/createAssetModule.js";
import { SpatialSystem } from "../../world/runtime/systems/SpatialSystem.js";
import { NavigationSystem } from "../../world/runtime/systems/NavigationSystem.js";
import { LocomotionSystem } from "../../world/runtime/systems/LocomotionSystem.js";
import { InteractionSystem } from "../../world/runtime/systems/InteractionSystem.js";
import { SceneGraph } from "../../world/runtime/graph/SceneGraph.js";
import { CommandHistory } from "../../world/runtime/CommandHistory.js";
import { WorldValidator } from "../../world/verification/WorldValidator.js";
import { RepairEngine } from "../../world/verification/RepairEngine.js";
import { WorldBuilder } from "../../world/build/WorldBuilder.js";
import { executeBehaviorCommand, verifyBehaviorCommand } from "../../world/runtime/behavior/BehaviorCompiler.js";

const endpoint=process.env.AGENTSCAPE_CONNECTOR_ENDPOINT || "http://127.0.0.1:48123";
const origin=process.env.AGENTSCAPE_CONNECTOR_ORIGIN || "http://127.0.0.1:5173";
const controlToken=process.env.AGENTSCAPE_CONNECTOR_CONTROL_TOKEN;
if(!controlToken) throw new Error("AGENTSCAPE_CONNECTOR_CONTROL_TOKEN is required for local pairing approval");

const mark=(stage,detail={})=>console.log(JSON.stringify({time:new Date().toISOString(),stage,...detail}));
const sleep=()=>new Promise((resolve)=>setTimeout(resolve,0));

async function pairConnector(){
  const client=new ConnectorClient({endpoint,origin});
  const first=await client.pair();
  if(first.status==="approval_required"){
    mark("pairing.approval-required",{pairingId:first.pairingId,connector:first.connector?.id||null});
    const response=await fetch(`${endpoint}/v1/pairings/${encodeURIComponent(first.pairingId)}/approve`,{
      method:"POST",headers:{"content-type":"application/json","X-Modal-Gen-Session":controlToken},body:"{}",redirect:"error"
    });
    if(!response.ok) throw new Error(`Connector approval failed: HTTP ${response.status}`);
    const paired=await client.pair({pairingId:first.pairingId});
    if(paired.status!=="paired") throw new Error(`Connector pairing failed: ${paired.status}`);
  }
  if(!client.isPaired()) throw new Error("Connector session is not paired");
  return client;
}

async function createHeadlessRuntime(){
  globalThis.localStorage ||= {getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
  globalThis.ProgressEvent ||= class ProgressEvent { constructor(type,init={}){this.type=type;Object.assign(this,init);} };
  const { WorldRuntime }=await import("../../world/runtime/WorldRuntime.js");
  const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:null,assetModule:createAssetModule()});
  await runtime.physics.init();
  runtime.scene=new THREE.Scene();
  runtime.rendering={viewPose:()=>({position:[0,0,0],rotation:[0,0,0,1]}),cameraState:()=>({position:[0,0,0],target:[0,0,-1]}),applyCameraState:()=>true,update(){}};

  const ground=new THREE.Mesh(new THREE.BoxGeometry(12,.2,12),new THREE.MeshBasicMaterial());
  ground.position.y=-.1; ground.name="HeadlessGround"; ground.updateMatrixWorld(true); runtime.scene.add(ground);
  runtime.environment={
    id:"headless-real-apple-lab",root:ground,
    colliders:[{shape:"box",halfExtents:[6,.1,6],translation:[0,-.1,0]}],
    layout:{bounds:{min:[-5,-5],max:[5,5]},groundY:0,margin:.5}
  };
  runtime.physics.addEnvironment(runtime.environment.colliders,{id:runtime.environment.id});
  runtime.spatial=new SpatialSystem({store:runtime.store,scene:runtime.scene});
  runtime.sceneGraph=new SceneGraph({store:runtime.store,spatial:runtime.spatial,events:runtime.events});
  runtime.history=new CommandHistory({apply:(scene)=>runtime.restore(scene),events:runtime.events});
  runtime.validator=new WorldValidator(runtime);
  runtime.repair=new RepairEngine(runtime);
  runtime.navigation=new NavigationSystem({store:runtime.store,physics:runtime.physics,environmentRoots:[ground],events:runtime.events,backend:new RecastNavigationBackend()});
  runtime.locomotion=new LocomotionSystem({store:runtime.store,physics:runtime.physics,navigation:runtime.navigation,events:runtime.events});
  runtime.interactions=new InteractionSystem({store:runtime.store,physics:runtime.physics,spatial:runtime.spatial,navigation:runtime.navigation,locomotion:runtime.locomotion,events:runtime.events});
  return runtime;
}

async function drive(promise,runtime,max=1800){
  let done=false,result,error;
  promise.then((value)=>{done=true;result=value;},(cause)=>{done=true;error=cause;});
  for(let i=0;i<1000&&!done&&runtime.locomotion.tasks.size===0&&runtime.interactions.settleTasks.size===0;i++) await sleep();
  for(let i=0;i<max&&!done;i++){
    runtime.locomotion.update(1/60);
    runtime.physics.step(1/60,runtime.store);
    runtime.interactions.update(1/60,runtime.rendering.viewPose());
    runtime.sceneGraph.update();
    if(i%24===0) await sleep(); else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error(`Runtime task did not settle: locomotion=${runtime.locomotion.tasks.size} settle=${runtime.interactions.settleTasks.size}`);
  return result;
}

const connector=await pairConnector();
let runtime;
try{
  runtime=await createHeadlessRuntime();
  const generation=attachGenerationRuntime(runtime,{
    connectorClient:connector,
    pollIntervalMs:1000,
    generationTimeoutMs:20*60*1000
  });
  const initialized=await generation.initialize({pair:false});
  if(initialized.status!=="generation-ready") throw new Error(`Generation unavailable: ${JSON.stringify(initialized)}`);

  const worldBuilder=new WorldBuilder(runtime);
  const registry=registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime,{worldBuilder});
  runtime.skills=registry;
  const prompt="a single glossy realistic red apple, centered, isolated object, clean neutral background, no text, no extra objects";
  const worldIR={
    schema:"agentscape.world-ir",schemaVersion:1,
    revision:{id:"real-apple-world-r1",reason:"real generated apple bounded retry e2e"},
    provenance:{source:"real-e2e-probe",createdBy:"AgentScape",evidenceRefs:[]},
    intent:{name:"Real Apple Table Lab",description:"Generate a missing apple inside bounded World retry, place it on a table, and have the embodied agent pick it up."},
    policy:{generation:{generate:false},physics:{fallbackPolicy:"deny"}},
    entities:[
      {id:"agent_01",asset:{assetId:"agent"},capabilityIntent:[],initialState:{}},
      {id:"table_01",asset:{assetId:"table"},capabilityIntent:[],initialState:{}},
      {id:"apple_01",asset:{prompt,generate:false},capabilityIntent:["PICKUP"],initialState:{}}
    ],
    spatial:{relations:[{subject:"apple_01",predicate:"ON",object:"table_01",surfaceId:"top"}],constraints:[]},
    interactions:[{id:"pickup-generated-apple",actorId:"agent_01",targetId:"apple_01",capability:"PICKUP",description:"Agent autonomously approaches and picks up the generated apple."}],
    rules:[],acceptance:[]
  };

  mark("world.pipeline.begin",{mode:"bounded-generation-retry"});
  const invocation=await registry.invoke("runWorldPipeline",{plan:worldIR},{profile:"builder",actor:"real-e2e-probe"});
  if(!invocation.success) throw new Error(`runWorldPipeline skill failed: ${JSON.stringify(invocation.error)}`);
  const worldResult=invocation.result;
  if(worldResult.status==="world-rejected") throw new Error(`WorldPipeline rejected: ${JSON.stringify({reason:worldResult.reason,retry:worldResult.retry,admission:worldResult.admission})}`);
  if(worldResult.attempts?.length!==2 || worldResult.attempts[0]?.retry?.status!=="retry-proposed" || worldResult.attempts[1]?.admission?.status==="rejected") {
    throw new Error(`Bounded generation retry evidence invalid: ${JSON.stringify(worldResult.attempts)}`);
  }
  const generatedAsset=worldResult.attempts[0]?.generation?.assets?.find((item)=>item.instanceId==="apple_01") || null;
  if(!generatedAsset?.assetId) throw new Error(`Retry produced no published apple asset: ${JSON.stringify(worldResult.attempts[0]?.generation||null)}`);
  const assetId=generatedAsset.assetId;
  const appleManifest=runtime.assets.getManifest(assetId);
  const appleAdmission=assetAdmission(appleManifest,{generated:true});
  mark("generation.ready",{assetId,status:generatedAsset.status,admission:appleAdmission.status,type:appleManifest.type,actions:appleManifest.actions,body:appleManifest.physics?.body,collisionStrategy:appleManifest.compiler?.collisionStrategy});

  const pipeline=worldResult.pipeline;
  const admission=worldResult.admission;
  for(let i=0;i<120;i++) runtime.physics.step(1/60,runtime.store);
  runtime.sceneGraph.update();
  const appleBefore=runtime.physics.getPosition("apple_01");
  const tableSurface=runtime.spatial.getSupportSurface("table_01","top");
  const support=runtime.spatial.supportStatus("apple_01","table_01",{surfaceId:"top"});
  if(pipeline.state.reports.relationAdmission?.status!=="ready" || !support.on) {
    throw new Error(`Apple is not verified ON table.top: ${JSON.stringify({relationAdmission:pipeline.state.reports.relationAdmission,support})}`);
  }
  mark("world.pipeline.ready",{
    admission:admission.status,
    reasons:admission.reasons,
    relationAdmission:pipeline.state.reports.relationAdmission?.status,
    support,
    applePosition:appleBefore,
    tableTop:tableSurface?.center?.toArray?.()||null,
    objects:runtime.listObjects()
  });

  const command=pipeline.state.artifacts.behaviorBundle.behaviorGraph.commands.find((item)=>item.capability==="PICKUP");
  if(!command) throw new Error("World IR did not compile a PICKUP RuntimeCommand");
  const agentStart=runtime.physics.getPosition("agent_01");
  mark("behavior.execute",{commandId:command.commandId,agentStart,applePosition:appleBefore});
  const pickup=await drive(executeBehaviorCommand(runtime,command),runtime);
  const verification=verifyBehaviorCommand(command,pickup);
  const held=runtime.store.get("apple_01").state.heldBy||null;
  const agentEnd=runtime.physics.getPosition("agent_01");
  const appleEnd=runtime.physics.getPosition("apple_01");
  const traveled=Math.hypot(agentEnd[0]-agentStart[0],agentEnd[2]-agentStart[2]);
  if(!verification.verified || pickup.status!=="held" || held?.id!=="agent_01") throw new Error(`PICKUP verification failed: ${JSON.stringify({pickup,verification,held})}`);
  if(traveled<0.25) throw new Error(`Agent did not meaningfully approach the apple: traveled=${traveled}`);
  mark("behavior.verified",{pickupStatus:pickup.status,verification,held,agentStart,agentEnd,appleEnd,traveled:Number(traveled.toFixed(3)),locomotion:pickup.locomotion});
  mark("probe.complete",{status:"passed",worldAdmission:admission.status,assetAdmission:appleAdmission.status,generatedAssetId:assetId,attempts:worldResult.attempts.length});
} finally {
  runtime?.navigation?.dispose?.();
  runtime?.physics?.dispose?.();
  try{await connector.revoke();mark("pairing.revoked");}catch(error){mark("pairing.revoke-failed",{message:error.message});}
}
