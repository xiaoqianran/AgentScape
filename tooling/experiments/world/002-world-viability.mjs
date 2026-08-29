import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

import { createAssetModule } from '../../../generation/orchestration/createAssetModule.js';
import { assetManifests } from '../../../asset/manifests/index.js';
import { WorldRuntime } from '../../../world/runtime/WorldRuntime.js';
import { ObjectStore } from '../../../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../../world/runtime/systems/SpatialSystem.js';
import { NavigationSystem } from '../../../world/runtime/systems/NavigationSystem.js';
import { LocomotionSystem } from '../../../world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../../../world/runtime/systems/InteractionSystem.js';
import { PhysicsSystem } from '../../../world/runtime/systems/PhysicsSystem.js';
import { RapierPhysicsBackend } from '../../../world/runtime/physics/RapierPhysicsBackend.js';
import { RecastNavigationBackend } from '../../../world/runtime/navigation/RecastNavigationBackend.js';
import { SceneGraph } from '../../../world/runtime/graph/SceneGraph.js';
import { CommandHistory } from '../../../world/runtime/CommandHistory.js';
import { WorldValidator } from '../../../world/verification/WorldValidator.js';
import { RepairEngine } from '../../../world/verification/RepairEngine.js';
import { createCanonicalWorldPipeline } from '../../../world/compiler/createWorldPipeline.js';
import { createMonumentHall } from '../../../world/content/monumentHall.js';
import { createRuinedCourtyard } from '../../../world/content/ruinedCourtyard.js';
import { createGrandUrbanBlock } from '../../../world/content/grandUrbanBlock.js';
import { SkillRegistry } from '../../../agent/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../../agent/skills/registerCoreSkills.js';
import { AgentTools } from '../../../agent/AgentTools.js';
import { ToolCallingAgent } from '../../../agent/ToolCallingAgent.js';
import { disposeObject3D } from '../../../core/disposeObject3D.js';

const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const now = () => performance.now();
const measure = async (fn) => {
  const started = now();
  const value = await fn();
  return { value, durationMs: round(now() - started, 1) };
};
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

globalThis.ProgressEvent ||= class ProgressEvent {
  constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
};
globalThis.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };

async function runGrandUrbanNavigation() {
  const scene = new THREE.Scene();
  const world = createGrandUrbanBlock({ scene, loadAssets:false });
  scene.add(world.root);
  const navigation = new NavigationSystem({
    store:new ObjectStore(),
    environmentRoots:[world.root],
    backend:new RecastNavigationBackend()
  });
  try {
    const boulevard = await navigation.findPath([0,0,-33],[0,0,33]);
    const diagonal = await navigation.findPath([-44,0,-31],[44,0,31]);
    assert.equal(boulevard.reachable, true, 'Grand Urban boulevard must be reachable');
    assert.equal(diagonal.reachable, true, 'Grand Urban diagonal must be reachable');
    assert.ok(boulevard.path.some(([x,,z]) => Math.abs(x) > 2.2 && Math.abs(z) < 4), 'Civic beacon must force a real detour');
    assert.ok(boulevard.cost > 66, 'Grand Urban boulevard cost must reflect the obstacle detour');
    assert.ok(diagonal.cost > 95, 'Grand Urban diagonal must remain a long-range route');
    const status = navigation.status();
    assert.equal(status.lastBuild?.meshCount, 19, 'Grand Urban navigation should compile 19 static meshes');
    return {
      reachable:true,
      boulevardCost:round(boulevard.cost),
      boulevardPoints:boulevard.path.length,
      diagonalCost:round(diagonal.cost),
      diagonalPoints:diagonal.path.length,
      navMeshCount:status.lastBuild?.meshCount,
      navBuildMs:round(status.lastBuild?.durationMs || 0, 1)
    };
  } finally {
    navigation.dispose();
    world.dispose();
    disposeObject3D(scene);
  }
}

async function runRuinedCourtyardLocomotion() {
  const scene = new THREE.Scene();
  const world = createRuinedCourtyard({ scene, loadAssets:false });
  scene.add(world.root);
  const store = new ObjectStore();
  const physics = new PhysicsSystem({ backend:new RapierPhysicsBackend() });
  await physics.init();
  physics.addEnvironment(world.colliders,{id:world.id});
  const navigation = new NavigationSystem({
    store,physics,environmentRoots:[world.root],backend:new RecastNavigationBackend()
  });
  const locomotion = new LocomotionSystem({store,physics,navigation});
  const agentObject = new THREE.Group();
  agentObject.position.set(0,0,12); agentObject.updateMatrixWorld(true); scene.add(agentObject);
  const manifest = structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object:agentObject,manifest,state:{}});
  physics.attach('agent_01',manifest,agentObject);
  physics.step(1/60,store);
  try {
    const path = await navigation.findPath([0,0,12],[12,1.2,4.8]);
    assert.equal(path.reachable,true,'Ruined Courtyard east terrace must be reachable');
    let result = null;
    let error = null;
    locomotion.navigate('agent_01',[12,1.2,4.8],{speed:3,timeout:20}).then((value) => { result=value; }, (cause) => { error=cause; });
    for(let i=0;i<20 && !locomotion.tasks.has('agent_01');i++) await sleep();
    for(let i=0;i<1400 && !result && !error;i++) {
      locomotion.update(1/60);
      physics.step(1/60,store);
      if(i%24===0) await sleep();
    }
    if(error) throw error;
    assert.ok(result,'Ruined Courtyard locomotion must settle');
    assert.equal(result.status,'arrived');
    assert.ok(result.position[1] > 1.0,'Agent must physically climb onto the 1.2m terrace');
    return {
      status:result.status,
      finalPosition:result.position.map((v) => round(v)),
      routeCost:round(path.cost),
      routePoints:path.path.length,
      navBuildVersion:navigation.status().buildVersion
    };
  } finally {
    locomotion.cancelAll();
    navigation.dispose();
    physics.dispose();
    world.dispose();
    disposeObject3D(scene);
  }
}

async function createHeadlessMonumentRuntime() {
  const cabinetBytes = await readFile('public/assets/cabinet.glb');
  const manifests = structuredClone(assetManifests);
  manifests.cabinet.source = {
    kind:'glb',
    url:`data:model/gltf-binary;base64,${cabinetBytes.toString('base64')}`
  };
  const runtime = new WorldRuntime({appendChild(){}},{
    environmentFactory:null,
    assetModule:createAssetModule({manifests})
  });
  await runtime.physics.init();
  runtime.scene = new THREE.Scene();
  runtime.camera = new THREE.PerspectiveCamera(45,1,.05,120);
  runtime.controls = {target:new THREE.Vector3(),update(){}};
  runtime.environment = createMonumentHall({scene:runtime.scene,loadAssets:false});
  runtime.scene.add(runtime.environment.root);
  runtime.environmentFloor = runtime.environment.floor;
  runtime.physics.addEnvironment(runtime.environment.colliders,{id:runtime.environment.id});
  runtime.spatial = new SpatialSystem({store:runtime.store,scene:runtime.scene});
  runtime.sceneGraph = new SceneGraph({store:runtime.store,spatial:runtime.spatial,events:runtime.events});
  runtime.history = new CommandHistory({apply:(scene) => runtime.restore(scene),events:runtime.events});
  runtime.validator = new WorldValidator(runtime);
  runtime.repair = new RepairEngine(runtime);
  runtime.navigation = new NavigationSystem({
    store:runtime.store,physics:runtime.physics,environmentRoots:[runtime.environment.root],events:runtime.events,
    backend:new RecastNavigationBackend()
  });
  runtime.locomotion = new LocomotionSystem({store:runtime.store,physics:runtime.physics,navigation:runtime.navigation,events:runtime.events});
  runtime.interactions = new InteractionSystem({
    store:runtime.store,physics:runtime.physics,spatial:runtime.spatial,navigation:runtime.navigation,locomotion:runtime.locomotion,events:runtime.events
  });
  runtime.worldPipeline = createCanonicalWorldPipeline(runtime);
  runtime.skills = registerCoreSkills(new SkillRegistry({policy:runtime.policy,trace:runtime.trace,runtime}),runtime);
  runtime.ruleRuntime.start();
  return runtime;
}

async function driveAgent(promise,runtime,max=12000) {
  let done=false,result,error;
  promise.then((value) => {done=true;result=value;}, (cause) => {done=true;error=cause;});
  for(let i=0;i<max && !done;i++) {
    runtime.locomotion.update(1/60);
    runtime.physics.step(1/60,runtime.store);
    runtime.interactions.update(1/60,runtime.camera);
    runtime.sceneGraph.update();
    if(i%12===0) await sleep(); else await Promise.resolve();
  }
  if(error) throw error;
  assert.equal(done,true,'Agent task must settle within deterministic frame budget');
  return result;
}

const taskAcceptanceCriteria = [
  {id:'world-valid',kind:'world-valid'},
  {id:'agent-exists',kind:'object-exists',targetId:'agent_01'},
  {id:'cabinet-open-verified',kind:'interaction-verified',targetId:'cabinet_01',capability:'OPEN'},
  {id:'cup-pickup-verified',kind:'interaction-verified',targetId:'cup_01',capability:'PICKUP'},
  {id:'cup-place-verified',kind:'interaction-verified',targetId:'table_01',capability:'PLACE'},
  {id:'cup-on-table',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'},
  {id:'no-unresolved',kind:'no-unresolved'}
];
const persistedWorldCriteria = [
  {id:'world-valid',kind:'world-valid'},
  {id:'agent-exists',kind:'object-exists',targetId:'agent_01'},
  {id:'cabinet-exists',kind:'object-exists',targetId:'cabinet_01'},
  {id:'cup-exists',kind:'object-exists',targetId:'cup_01'},
  {id:'table-exists',kind:'object-exists',targetId:'table_01'},
  {id:'cup-on-table',kind:'relation-exists',subject:'cup_01',predicate:'ON',object:'table_01',surfaceId:'top'},
  {id:'no-unresolved',kind:'no-unresolved'}
];

async function runEmbodiedWorldTask() {
  const runtime = await createHeadlessMonumentRuntime();
  const tools = new AgentTools(runtime,{profile:'builder',actor:'agent_01'});
  try {
    const worldIR = {
      schema:'agentscape.world-ir',schemaVersion:1,
      revision:{id:'viability-monument-r1',reason:'offline deterministic world viability benchmark'},
      provenance:{source:'world-viability',createdBy:'AgentScape',evidenceRefs:[]},
      intent:{name:'Monument Hall Viability Task',description:'Open cabinet, pick up cup, carry it across the hall, and place it on the table.'},
      policy:{generation:{generate:false},physics:{fallbackPolicy:'deny'}},
      entities:[
        {id:'agent_01',asset:{assetId:'agent'},transform:{position:[0,0,9]},capabilityIntent:[],initialState:{}},
        {id:'cabinet_01',asset:{assetId:'cabinet'},transform:{position:[-5.2,0,3.9]},capabilityIntent:['OPEN'],initialState:{}},
        {id:'cup_01',asset:{assetId:'cup'},capabilityIntent:['PICKUP'],initialState:{}},
        {id:'table_01',asset:{assetId:'table'},transform:{position:[5.2,0,4.2]},capabilityIntent:[],initialState:{}}
      ],
      spatial:{relations:[{subject:'cup_01',predicate:'INSIDE',object:'cabinet_01',receptacleId:'interior'}],constraints:[]},
      interactions:[
        {id:'open-cabinet',actorId:'agent_01',targetId:'cabinet_01',capability:'OPEN'},
        {id:'pickup-cup',actorId:'agent_01',targetId:'cup_01',capability:'PICKUP'},
        {id:'place-cup',actorId:'agent_01',supportId:'table_01',capability:'PLACE'}
      ],
      rules:[],acceptance:[]
    };

    const pipeline = await runtime.worldPipeline.run(worldIR);
    assert.notEqual(pipeline.state.reports.worldAdmission.status,'rejected',`World pipeline rejected: ${JSON.stringify(pipeline.state.reports.worldAdmission)}`);
    assert.equal(pipeline.state.artifacts.behaviorBundle.behaviorGraph.commands.length,3,'WorldIR must compile all three interaction commands');
    assert.equal(runtime.store.list().length,4,'World pipeline must instantiate four runtime objects');
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();
    assert.equal(runtime.sceneGraph.list({subject:'cup_01',predicate:'INSIDE',object:'cabinet_01'}).length,1,'Cup must begin inside cabinet interior');
    const initialPath = await runtime.navigation.findPath(runtime.physics.getPosition('agent_01'),runtime.physics.getPosition('cabinet_01'));
    assert.equal(initialPath.reachable,true,'Agent must be able to reach the cabinet in Monument Hall');
    assert.ok(initialPath.path.length > 1,'Agent navigation must produce a real path');

    const sequence = [
      ['approachAndInteract',{actorId:'agent_01',targetId:'cabinet_01',action:'open'}],
      ['approachAndPickup',{actorId:'agent_01',targetId:'cup_01'}],
      ['approachAndPlace',{actorId:'agent_01',supportId:'table_01',surfaceId:'top'}],
      ['evaluateWorldAcceptance',{criteria:taskAcceptanceCriteria}]
    ];
    const gateway = {
      isConfigured:() => true,
      async complete({messages}) {
        const completed = messages.filter((message) => message.role === 'tool').length;
        const next = sequence[completed];
        return next
          ? {message:'',toolCalls:[{id:`viability_${completed}`,name:next[0],args:next[1]}]}
          : {message:'world viability task verified',toolCalls:[]};
      }
    };
    const agent = new ToolCallingAgent({tools,gateway,maxSteps:8});
    const agentStart = runtime.physics.getPosition('agent_01');
    const result = await driveAgent(agent.run('打开 cabinet_01，拿起 cup_01，把它带到 table_01 并放到 top，然后用世界验收标准证明任务完成。'),runtime);
    const agentEnd = runtime.physics.getPosition('agent_01');

    assert.equal(result.taskStatus,'completed',JSON.stringify(result));
    assert.equal(result.acceptanceBundle?.result?.status,'world-accepted','Agent task acceptance must be world-accepted');
    assert.equal(runtime.store.get('cabinet_01').state.parts?.door,'open','Cabinet door must be promoted to verified open state');
    assert.equal(runtime.store.get('cup_01').state.heldBy,undefined,'Cup must no longer be held after placement');
    assert.equal(runtime.interactions.carryStatus('agent_01').status,'empty','Agent hands must be empty after placement');
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();
    const support = runtime.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'});
    assert.equal(support.on,true,'Cup must be physically supported by table.top');
    assert.ok(runtime.history.status().undo >= 3,'Verified Agent mutations must be recorded in transactional history');
    const acceptedSnapshot = runtime.serialize({name:'Viability Accepted Snapshot'});
    assert.equal(acceptedSnapshot.objects.length,4,'Accepted scene snapshot must contain all runtime objects');
    assert.equal(acceptedSnapshot.verification?.acceptanceEvidence?.result?.status,'world-accepted','Scene snapshot must carry acceptance evidence');

    await runtime.mutate('viability:inject-drift',() => runtime.interactions.move('cup_01',[0,0,0]));
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();
    const driftReplay = await tools.call('replayWorldAcceptance');
    assert.equal(driftReplay.status,'world-incomplete','Acceptance replay must detect post-acceptance world drift');
    assert.ok(driftReplay.checks.some((check) => check.id === 'cup-on-table' && check.verified === false),'Drift must specifically break cup-on-table evidence');
    await runtime.restore(acceptedSnapshot);
    for(let i=0;i<180;i++) {
      runtime.physics.step(1/60,runtime.store);
      runtime.interactions.update(1/60,runtime.camera);
      if(i%30===0) await sleep();
    }
    runtime.sceneGraph.changed(); runtime.sceneGraph.update();

    const historicalReplay = await tools.call('replayWorldAcceptance');
    assert.equal(historicalReplay.status,'world-incomplete','Restored interaction evidence must remain historical until re-executed');
    assert.ok(historicalReplay.checks.some((check) => check.reason === 'INTERACTION_NOT_VERIFIED'),'Restore must not forge fresh interaction evidence');

    const persistedAcceptance = await tools.call('evaluateWorldAcceptance',{criteria:persistedWorldCriteria});
    assert.equal(persistedAcceptance.status,'world-accepted','Restored physical world state must independently pass persistent-state acceptance');
    const restoredSupport = runtime.spatial.supportStatus('cup_01','table_01',{surfaceId:'top'});
    assert.equal(restoredSupport.on,true,'Restored cup must still be physically ON table.top');

    const executed = runtime.trace.list({type:'agent.sequence'}).map((entry) => entry.payload).filter((entry) => entry.executed === true);
    const mutationOutcomes = executed.filter((entry) => ['approachAndInteract','approachAndPickup','approachAndPlace'].includes(entry.tool));
    assert.deepEqual(mutationOutcomes.map((entry) => [entry.tool,entry.outcome.state]),[
      ['approachAndInteract','verified'],
      ['approachAndPickup','verified'],
      ['approachAndPlace','verified']
    ]);

    return {
      environment:runtime.environment.id,
      worldAdmission:pipeline.state.reports.worldAdmission.status,
      worldAdmissionReasons:pipeline.state.reports.worldAdmission.reasons,
      behaviorCommands:pipeline.state.artifacts.behaviorBundle.behaviorGraph.commands.map((command) => command.capability),
      initialNavigation:{reachable:true,cost:round(initialPath.cost),points:initialPath.path.length},
      agentTravel:round(Math.hypot(agentEnd[0]-agentStart[0],agentEnd[2]-agentStart[2])),
      mutationOutcomes:mutationOutcomes.map((entry) => ({tool:entry.tool,state:entry.outcome.state,status:entry.outcome.status || null})),
      taskAcceptance:{status:result.acceptanceBundle.result.status,verified:result.acceptanceBundle.result.verifiedCount,failed:result.acceptanceBundle.result.failedCount},
      supportAfterPlace:{on:support.on,gap:support.gap},
      history:runtime.history.status(),
      driftReplay:{status:driftReplay.status,failed:driftReplay.failedCount,changed:driftReplay.replay?.changedCriteria || []},
      restoredHistoricalReplay:{status:historicalReplay.status,failed:historicalReplay.failedCount},
      restoredPersistentAcceptance:{status:persistedAcceptance.status,verified:persistedAcceptance.verifiedCount,failed:persistedAcceptance.failedCount}
    };
  } finally {
    runtime.ruleRuntime.stop();
    runtime.locomotion?.cancelAll?.();
    runtime.navigation?.dispose?.();
    runtime.physics?.dispose?.();
    runtime.environment?.dispose?.();
    disposeObject3D(runtime.scene);
  }
}

const report = {
  schema:'agentscape.world-viability',schemaVersion:1,
  mode:'offline-deterministic',
  stages:{}
};

const urban = await measure(runGrandUrbanNavigation);
report.stages.grandUrbanNavigation = {...urban.value,durationMs:urban.durationMs};
const ruins = await measure(runRuinedCourtyardLocomotion);
report.stages.ruinedCourtyardLocomotion = {...ruins.value,durationMs:ruins.durationMs};
const embodied = await measure(runEmbodiedWorldTask);
report.stages.embodiedTask = {...embodied.value,durationMs:embodied.durationMs};
report.status = 'passed';
report.verdict = 'runtime-world-usable';
report.scope = {
  verified:[
    'curated-world navmesh at city scale',
    'real character-controller traversal over elevation',
    'canonical WorldIR compile/admission with INSIDE receptacle placement',
    'real cabinet GLB shell + executable interior receptacle + articulated door',
    'Agent navigation + OPEN + PICKUP from cabinet interior + CARRY + PLACE',
    'Rapier settle + ON support relation',
    'world-level acceptance evidence',
    'transactional mutation history',
    'drift detection',
    'scene serialize/restore with Physics-world rebuild + persistent-state revalidation'
  ],
  notVerifiedOnline:[
    'live modal-provider 2D/3D generation',
    'live external LLM/VLM planning'
  ],
  knownSemanticGap:[
    'benchmark world admission remains provisional because current asset/layout evidence is provisional even though Runtime execution is verified'
  ]
};

console.log(JSON.stringify(report,null,2));
