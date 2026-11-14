import { describe, expect, it } from 'vitest';
import { SemanticWorldView } from '../../modules/world/runtime/semantic/SemanticWorldView.js';
import { compileWorldAcceptance, evaluateWorldAcceptance } from '../../modules/world/verification/WorldAcceptance.js';

const accepted = (world, criteria) => evaluateWorldAcceptance(world, compileWorldAcceptance(criteria));

describe('SemanticWorldView', () => {
  it('reads Runtime, Code Project and environment state without copying ownership', () => {
    const cup = { state:{heldBy:null,temperature:25} };
    const project = { mode:'idle' };
    const environment = { powered:false };
    const runtime = {
      store:{ has:id=>id==='cup', get:id=>id==='cup'?cup:null },
      projectCapabilities:{ has:id=>id==='cooker', readState:id=>id==='cooker'?project:null },
      affordances:{ get:id=>id==='switch'?{kind:'device',read:()=>environment}:null }
    };
    const facts = new SemanticWorldView(runtime);

    expect(facts.entity('cup')).toEqual({exists:true,source:'runtime'});
    expect(facts.entity('cooker')).toEqual({exists:true,source:'project'});
    expect(facts.entity('switch')).toEqual({exists:true,source:'environment'});
    expect(facts.entity('absent')).toMatchObject({exists:false,reason:'OBJECT_NOT_FOUND'});
    expect(facts.state('cup','temperature')).toMatchObject({status:'known',source:'runtime',value:25});
    expect(facts.state('cooker','mode')).toMatchObject({status:'known',source:'project',value:'idle'});
    expect(facts.state('switch','powered')).toMatchObject({status:'known',source:'environment',value:false});
    expect(accepted(runtime,[
      {id:'cup',kind:'object-exists',targetId:'cup'},
      {id:'device',kind:'object-exists',targetId:'switch'},
      {id:'project',kind:'state-equals',targetId:'cooker',stateKey:'mode',value:'idle'}
    ])).toMatchObject({status:'world-accepted',verifiedCount:3});

    // Neither view construction nor reading captures a stale state snapshot.
    project.mode='cooking'; cup.state.temperature=70; environment.powered=true;
    expect(facts.state('cooker','mode').value).toBe('cooking');
    expect(facts.state('cup','temperature').value).toBe(70);
    expect(facts.state('switch','powered').value).toBe(true);
  });

  it('keeps a missing state distinct from a known mismatch', () => {
    const runtime={store:{has:id=>id==='cup',get:()=>({state:{enabled:false}})}};
    const criteria=[
      {id:'off',kind:'state-equals',targetId:'cup',stateKey:'enabled',value:true},
      {id:'missing',kind:'state-equals',targetId:'cup',stateKey:'missing',value:false},
      {id:'absent',kind:'state-equals',targetId:'absent',stateKey:'enabled',value:false}
    ];
    const result=accepted(runtime,criteria);
    expect(result.checks).toMatchObject([
      {truth:'false',source:'runtime',actual:false,reason:'STATE_MISMATCH'},
      {truth:'unknown',source:'runtime',reason:'STATE_NOT_OBSERVED'},
      {truth:'unknown',source:'none',reason:'OBJECT_NOT_FOUND'}
    ]);
  });

  it('keeps protected text unreadable and fails closed on provider errors', () => {
    const runtime={
      affordances:{get:id=>id==='note'?{kind:'text',read:()=>{throw Error('protected contents');}}:null},
      projectCapabilities:{has:id=>id==='faulty',readState:()=>{throw Error('internal details');}}
    };
    const view=new SemanticWorldView(runtime);
    expect(view.state('note','secret')).toMatchObject({status:'unknown',reason:'ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ'});
    expect(view.state('faulty','mode')).toMatchObject({status:'unknown',reason:'STATE_READ_FAILED'});
    const result=accepted(runtime,[{id:'secret',kind:'state-equals',targetId:'note',stateKey:'secret',value:'private'}]);
    expect(result).toMatchObject({status:'world-incomplete',checks:[{verified:false,truth:'unknown',reason:'ENVIRONMENT_TEXT_REQUIRES_ACTOR_READ'}]});
    expect(JSON.stringify(result)).not.toContain('protected contents'); // text provider was never read
  });

  it('returns spatial evidence and distinguishes unsupported surfaces from missing measurements', () => {
    const edges=[{subject:'rice',predicate:'INSIDE',object:'cooker',meta:{receptacleId:'pot',evidence:'spatial-geometry'}}];
    const runtime={
      sceneGraph:{update:()=>{},list:({subject,predicate,object})=>edges.filter(edge=>edge.subject===subject&&edge.predicate===predicate&&edge.object===object)}
    };
    const view=new SemanticWorldView(runtime);
    expect(view.relation({subject:'rice',predicate:'INSIDE',object:'cooker'})).toMatchObject({
      truth:'true',source:'scene-graph',evidenceKind:'spatial-geometry',evidence:{meta:{receptacleId:'pot'}}
    });
    expect(view.relation({subject:'rice',predicate:'INSIDE',object:'cooker',surfaceId:'other'})).toMatchObject({
      truth:'false',reason:'RELATION_NOT_FOUND'
    });
    expect(view.relation({subject:'rice',predicate:'INSIDE',object:'another'})).toMatchObject({
      truth:'unknown',reason:'RELATION_NOT_OBSERVED'
    });
  });

  it('treats an absent relation between active measured objects as false', () => {
    const records=new Map([
      ['rice',{state:{},active:true}],
      ['cooker',{state:{},active:true}]
    ]);
    let edges=[];
    const runtime={
      store:{has:id=>records.has(id),get:id=>records.get(id)},
      spatial:{snapshot:()=>new Map()},
      sceneGraph:{update:()=>{},list:({subject,predicate,object})=>edges.filter(e=>e.subject===subject&&e.predicate===predicate&&e.object===object)}
    };
    const view=new SemanticWorldView(runtime);
    expect(view.relation({subject:'rice',predicate:'INSIDE',object:'cooker'})).toMatchObject({
      truth:'false',reason:'RELATION_NOT_FOUND'
    });
    edges=[{subject:'rice',predicate:'INSIDE',object:'cooker',meta:{evidence:'spatial-geometry'}}];
    expect(accepted(runtime,[{id:'inside',kind:'relation-exists',subject:'rice',predicate:'INSIDE',object:'cooker'}])).toMatchObject({
      status:'world-accepted',checks:[{truth:'true',source:'scene-graph'}]
    });
    expect(view.relation({subject:'rice',predicate:'INSIDE',objectAnyOf:['missing','cooker']})).toMatchObject({truth:'true'});
    edges=[];
    expect(accepted(runtime,[{id:'inside',kind:'relation-exists',subject:'rice',predicate:'INSIDE',object:'cooker'}])).toMatchObject({
      status:'world-incomplete',checks:[{truth:'false',reason:'RELATION_NOT_FOUND'}]
    });
  });

  it('refuses to infer false when a Code Project object lacks spatial participation', () => {
    const runtime={
      store:{has:id=>id==='cooker',get:()=>({state:{},active:true})},
      projectCapabilities:{has:id=>id==='rice',readState:()=>({})},
      spatial:{snapshot:()=>new Map()},
      sceneGraph:{update:()=>{},list:()=>[]}
    };
    const view=new SemanticWorldView(runtime);
    expect(view.relation({subject:'rice',predicate:'INSIDE',object:'cooker'})).toMatchObject({
      truth:'unknown',reason:'RELATION_NOT_OBSERVED'
    });
    expect(accepted(runtime,[{id:'inside',kind:'relation-exists',subject:'rice',predicate:'INSIDE',object:'cooker'}])).toMatchObject({
      status:'world-incomplete',checks:[{truth:'unknown',reason:'RELATION_NOT_OBSERVED'}]
    });
    expect(view.relation({subject:'cooker',predicate:'INSIDE',objectAnyOf:['rice','missing']})).toMatchObject({
      truth:'unknown',reason:'RELATION_NOT_OBSERVED'
    });
  });

  it('does not convert missing graph or failing geometry into a false spatial fact', () => {
    const noGraph=new SemanticWorldView({});
    expect(noGraph.relation({subject:'a',predicate:'NEAR',object:'b'})).toMatchObject({
      truth:'unknown',reason:'RELATION_GRAPH_UNAVAILABLE'
    });
    const broken=new SemanticWorldView({sceneGraph:{update:()=>{throw Error('bad physics');},list:()=>[]}});
    expect(broken.relation({subject:'a',predicate:'NEAR',object:'b'})).toMatchObject({
      truth:'unknown',reason:'RELATION_READ_FAILED'
    });
  });
});
