import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../core/EventBus.js';
import { ObjectStore } from '../../world/runtime/ObjectStore.js';
import { SpatialSystem } from '../../world/runtime/systems/SpatialSystem.js';
import { LocomotionSystem } from '../../world/runtime/systems/LocomotionSystem.js';
import { InteractionSystem } from '../../world/runtime/systems/InteractionSystem.js';
import { SceneGraph } from '../../world/runtime/graph/SceneGraph.js';
import { assetManifests } from '../../asset/manifests/index.js';
import { SkillRegistry } from '../../agent/skills/SkillRegistry.js';
import { registerSpatialSkills } from '../../agent/skills/packs/spatialSkills.js';
import { registerInteractionSkills } from '../../agent/skills/packs/interactionSkills.js';
import { AgentTools } from '../../agent/AgentTools.js';
import { AssetAgentVerifier } from '../../studio/agent/AssetAgentVerifier.js';
import { createRapierPhysicsSystem } from '../helpers/createRapierPhysicsSystem.js';
import { createRecastNavigationSystem } from '../helpers/createRecastNavigationSystem.js';

const floorMesh=()=>{const mesh=new THREE.Mesh(new THREE.BoxGeometry(12,.2,12));mesh.position.y=-.1;mesh.updateMatrixWorld(true);return mesh;};
const cupVisual=()=>{const group=new THREE.Group();const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.15,.15,.32,16));mesh.position.y=.16;group.add(mesh);return group;};
const tableVisual=()=>{const group=new THREE.Group();const top=new THREE.Mesh(new THREE.BoxGeometry(2.4,.16,1.25));top.position.y=1;group.add(top);return group;};

async function setup({carryable=true}={}){
  const store=new ObjectStore();
  const scene=new THREE.Scene();
  const ground=floorMesh(); scene.add(ground);
  const physics=createRapierPhysicsSystem(); await physics.init();
  physics.addEnvironment([{shape:'box',halfExtents:[6,.1,6],translation:[0,-.1,0]}]);

  const agent=new THREE.Group(); agent.position.set(0,0,3.2); scene.add(agent); agent.updateMatrixWorld(true);
  const agentManifest=structuredClone(assetManifests.agent);
  store.add('agent_01',{id:'agent_01',assetId:'agent',object:agent,manifest:agentManifest,state:{}}); physics.attach('agent_01',agentManifest,agent);

  const cup=cupVisual(); cup.position.set(-1,0,1.1); scene.add(cup); cup.updateMatrixWorld(true);
  const cupManifest=structuredClone(assetManifests.cup);
  if(!carryable) cupManifest.actions=['move'];
  store.add('generated_prop_01',{id:'generated_prop_01',assetId:'generated-test-prop',object:cup,manifest:cupManifest,state:{}}); physics.attach('generated_prop_01',cupManifest,cup);

  const table=tableVisual(); table.position.set(1.5,0,-1.2); scene.add(table); table.updateMatrixWorld(true);
  const tableManifest=structuredClone(assetManifests.table);
  store.add('table_01',{id:'table_01',assetId:'table',object:table,manifest:tableManifest,state:{}}); physics.attach('table_01',tableManifest,table);

  for(let i=0;i<60;i++) physics.step(1/60,store);
  const events=new EventBus();
  const spatial=new SpatialSystem({store,scene});
  const navigation=createRecastNavigationSystem({store,physics,environmentRoots:[ground],events});
  const locomotion=new LocomotionSystem({store,physics,navigation,events});
  const interactions=new InteractionSystem({store,physics,spatial,navigation,locomotion,events});
  const sceneGraph=new SceneGraph({store,spatial,events}); sceneGraph.changed();
  const runtime={
    store,scene,physics,spatial,navigation,locomotion,interactions,sceneGraph,events,
    currentWorldRevision:{revision:{id:'studio-agent-test-rev'}},trace:null
  };
  runtime.mutate=async(_label,operation)=>{
    let result;
    await sceneGraph.batch(async()=>{result=await operation();sceneGraph.changed();});
    return result;
  };
  const registry=new SkillRegistry({runtime});
  const add=(name,options,handler)=>registry.register({name,...options,handler});
  registerSpatialSkills(add,runtime);
  registerInteractionSkills(add,runtime);
  runtime.skills=registry;
  const tools=new AgentTools(runtime,{profile:'builder',actor:'agent_01'});
  const verifier=new AssetAgentVerifier({world:runtime,tools,actorId:'agent_01'});
  return {runtime,store,physics,spatial,navigation,locomotion,interactions,sceneGraph,verifier};
}

async function drive(promise,ctx,max=4200){
  let done=false,result,error;
  promise.then((value)=>{done=true;result=value},(failure)=>{done=true;error=failure});
  for(let i=0;i<1000&&!done&&ctx.locomotion.tasks.size===0&&ctx.interactions.settleTasks.size===0;i++) await new Promise((resolve)=>setTimeout(resolve,0));
  for(let i=0;i<max&&!done;i++){
    ctx.locomotion.update(1/60);
    ctx.physics.step(1/60,ctx.store);
    ctx.interactions.update(1/60,{position:[0,0,0],rotation:[0,0,0,1]});
    if(i%24===0) await new Promise((resolve)=>setTimeout(resolve,0)); else await Promise.resolve();
  }
  if(error) throw error;
  if(!done) throw new Error('Studio Agent Asset verification did not settle');
  return result;
}

describe('Studio real Agent Asset verifier',()=>{
  it('runs Navigate → Pickup → Carry → Place and verifies the final ON relation through production systems',async()=>{
    const ctx=await setup();
    try{
      const result=await drive(ctx.verifier.run({targetId:'generated_prop_01',supportId:'table_01',surfaceId:'top',speed:2.5}),ctx);
      expect(result).toMatchObject({status:'verified',targetId:'generated_prop_01',supportId:'table_01',surfaceId:'top'});
      expect(result.steps.map((step)=>[step.id,step.state])).toEqual([
        ['navigate-plan','accepted'],['navigate','verified'],['pickup','verified'],['carry-check','verified'],
        ['carry-plan','accepted'],['carry','verified'],['place','verified'],['verify','accepted']
      ]);
      expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'empty'});
      expect(ctx.spatial.supportStatus('generated_prop_01','table_01',{surfaceId:'top'}).on).toBe(true);
      ctx.sceneGraph.update();
      expect(ctx.sceneGraph.list({subject:'generated_prop_01',predicate:'ON',object:'table_01'})).toEqual([
        expect.objectContaining({subject:'generated_prop_01',predicate:'ON',object:'table_01',meta:expect.objectContaining({surfaceId:'top'})})
      ]);
    } finally {
      ctx.navigation.dispose();
      ctx.physics.dispose();
    }
  },45000);

  it('reports a real Runtime capability failure instead of pretending a generated Asset is pickup-ready',async()=>{
    const ctx=await setup({carryable:false});
    try{
      const result=await drive(ctx.verifier.run({targetId:'generated_prop_01',supportId:'table_01',surfaceId:'top',speed:2.5}),ctx);
      expect(result).toMatchObject({status:'failed',targetId:'generated_prop_01',failedStep:'pickup'});
      expect(result.steps.find((step)=>step.id==='navigate')).toMatchObject({state:'verified',status:'arrived'});
      expect(result.steps.find((step)=>step.id==='pickup')).toMatchObject({state:'error'});
      expect(ctx.interactions.carryStatus('agent_01')).toMatchObject({status:'empty'});
    } finally {
      ctx.navigation.dispose();
      ctx.physics.dispose();
    }
  },45000);
});
