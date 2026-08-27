import * as THREE from "three";
import { ConnectorClient } from "../src/connector/ConnectorClient.js";
import { attachLegacyAuthoring } from "../src/authoring/LegacyAuthoringShell.js";
import { createAssetModule } from "../src/assets/createAssetModule.js";
import { SpatialSystem } from "../src/runtime/systems/SpatialSystem.js";
import { NavigationSystem } from "../src/runtime/systems/NavigationSystem.js";
import { LocomotionSystem } from "../src/runtime/systems/LocomotionSystem.js";
import { InteractionSystem } from "../src/runtime/systems/InteractionSystem.js";
import { SceneGraph } from "../src/runtime/graph/SceneGraph.js";
import { CommandHistory } from "../src/history/CommandHistory.js";
import { WorldValidator } from "../src/validation/WorldValidator.js";
import { RepairEngine } from "../src/validation/RepairEngine.js";
import { createCanonicalWorldPipeline } from "../src/pipeline/createWorldPipeline.js";
import { executeBehaviorCommand, verifyBehaviorCommand } from "../src/runtime/behavior/BehaviorCompiler.js";

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
  const { WorldRuntime }=await import("../src/runtime/WorldRuntime.js");
  const runtime=new WorldRuntime({appendChild(){}},{environmentFactory:null,assetModule:createAssetModule()});
  await runtime.physics.init();
  runtime.scene=new THREE.Scene();
  runtime.camera=new THREE.PerspectiveCamera(45,1,.05,120);
  runtime.controls={target:new THREE.Vector3(),update(){}};

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
  runtime.navigation=new NavigationSystem({store:runtime.store,physics:runtime.physics,environmentRoots:[ground],events:runtime.events});
  runtime.locomotion=new LocomotionSystem({store:runtime.store,physics:runtime.physics,navigation:runtime.navigation,events:runtime.events});
  runtime.interactions=new InteractionSystem({store:runtime.store,physics:runtime.physics,spatial:runtime.spatial,navigation:runtime.navigation,locomotion:runtime.locomotion,events:runtime.events});
  runtime.worldPipeline=createCanonicalWorldPipeline(runtime);
  return runtime;
}

async function drive(promise,runtime,max=1800){
  let done=false,result,error;
  promise.then((value)=>{done=true;result=value;},(cause)=>{done=true;error=cause;});
  for(let i=0;i<1000&&!done&&runtime.locomotion.tasks.size===0&&runtime.interactions.settleTasks.size===0;i++) await sleep();
  for(let i=0;i<max&&!done;i++){
    runtime.locomotion.update(1/60);
    runtime.physics.step(1/60,runtime.store);
    runtime.interactions.update(1/60,runtime.camera);
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
  const authoring=attachLegacyAuthoring(runtime,{
    connectorClient:connector,
    generationOptions:{pollIntervalMs:1000,generationTimeoutMs:20*60*1000}
  });
  const generation=authoring.generation;
  const initialized=await authoring.initialize({pair:false});
  if(initialized.status!=="generation-ready") throw new Error(`Generation unavailable: ${JSON.stringify(initialized)}`);

  const assetId="generated_real_red_apple_02";
  const prompt="a single glossy realistic red apple, centered, isolated object, clean neutral background, no text, no extra objects";
  mark("generation.begin",{assetId});
  const generated=await generation.generateTextAsset({prompt,assetId,label:"Real Red Apple",pollIntervalMs:1000,timeoutMs:20*60*1000});
  const appleManifest=runtime.assets.getManifest(assetId);
  mark("generation.ready",{status:generated.status,admission:generated.admission?.status||null,type:appleManifest.type,actions:appleManifest.actions,body:appleManifest.physics?.body,collisionStrategy:appleManifest.compiler?.collisionStrategy});

  const worldIR={
    schema:"agentscape.world-ir",schemaVersion:1,
    revision:{id:"real-apple-world-r1",reason:"real generated apple world e2e"},
    provenance:{source:"real-e2e-probe",createdBy:"AgentScape",evidenceRefs:[generated.artifactId].filter(Boolean)},
    intent:{name:"Real Apple Table Lab",description:"Place a generated apple on a table and have the embodied agent pick it up."},
    policy:{generation:{generate:false},physics:{fallbackPolicy:"deny"}},
    entities:[
      {id:"agent_01",asset:{assetId:"agent"},capabilityIntent:[],initialState:{}},
      {id:"table_01",asset:{assetId:"table"},capabilityIntent:[],initialState:{}},
      {id:"apple_01",asset:{assetId},capabilityIntent:["PICKUP"],initialState:{}}
    ],
    spatial:{relations:[{subject:"apple_01",predicate:"ON",object:"table_01",surfaceId:"top"}],constraints:[]},
    interactions:[{id:"pickup-generated-apple",actorId:"agent_01",targetId:"apple_01",capability:"PICKUP",description:"Agent autonomously approaches and picks up the generated apple."}],
    rules:[],acceptance:[]
  };

  mark("world.pipeline.begin");
  const pipeline=await runtime.worldPipeline.run(worldIR);
  const admission=pipeline.state.reports.worldAdmission;
  if(admission.status==="rejected") throw new Error(`WorldPipeline rejected: ${JSON.stringify(admission)}`);
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
  mark("probe.complete",{status:"passed",worldAdmission:admission.status,assetAdmission:generated.admission?.status||null});
} finally {
  runtime?.navigation?.dispose?.();
  runtime?.physics?.dispose?.();
  try{await connector.revoke();mark("pairing.revoked");}catch(error){mark("pairing.revoke-failed",{message:error.message});}
}
