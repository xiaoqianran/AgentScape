import { describe, expect, it, vi } from 'vitest';
import { ProjectStateMachine } from '../../modules/world/runtime/behavior/ProjectStateMachine.js';
import { ProjectCapabilities } from '../../modules/world/runtime/ProjectCapabilities.js';

const pageDefinition = (options={}) => ({
  initialState:{page:0,pages:3,cover:'closed'},
  ranges:{page:{min:0,max:3}},
  transitions:[
    {name:'open',when:[{field:'cover',op:'eq',value:'closed'}],effects:[{field:'cover',op:'set',value:'open'}]},
    {name:'close',when:[{field:'cover',op:'eq',value:'open'}],effects:[{field:'cover',op:'set',value:'closed'}]},
    {name:'next',when:[{field:'cover',op:'eq',value:'open'},{field:'page',op:'lt',other:'pages'}],
      effects:[{field:'page',op:'add',value:1}]},
    {name:'previous',when:[{field:'cover',op:'eq',value:'open'},{field:'page',op:'gt',value:0}],
      effects:[{field:'page',op:'add',value:-1}]}
  ],...options
});

describe('declarative project state machines',()=>{
  it('rejects invalid schema/guards, and gives a read-only snapshot',()=>{
    expect(()=>new ProjectStateMachine(pageDefinition({transitions:[{name:'next',effects:[{field:'page',op:'add',value:'wrong'}]}]}))).toThrow('PROJECT_MACHINE_DEFINITION_INVALID');
    const machine=new ProjectStateMachine(pageDefinition());
    expect(machine.available('next')).toBe(false);
    machine.execute('open');
    expect(machine.available('next')).toBe(true);
    const changed=machine.execute('next');
    expect(changed).toMatchObject({changed:true,transition:'next',state:{page:1,pages:3,cover:'open'}});
    const external=machine.read();external.page=999;
    expect(machine.read().page).toBe(1);
    expect(()=>machine.restore({page:99,pages:3,cover:'open'})).toThrow('PROJECT_MACHINE_STATE_INVALID');
    expect(()=>machine.restore({page:1,pages:3,cover:'unrecognized'})).toThrow('PROJECT_MACHINE_STATE_INVALID');
    machine.execute('next');machine.execute('next');
    expect(machine.available('next')).toBe(false);
    expect(()=>machine.execute('next')).toThrow('PROJECT_MACHINE_GUARD_FAILED');
    machine.execute('previous');
    expect(machine.read().page).toBe(2);
    machine.execute('close');
    expect(machine.available('next')).toBe(false);
  });

  it('makes multiple effects atomic, and rolls back failed visual updates',()=>{
    const visuals={lid:'closed',lamp:'off'};
    const machine=new ProjectStateMachine({
      initialState:{lid:'closed',lamp:'off'},
      transitions:[{name:'start',effects:[{field:'lid',op:'set',value:'open'},{field:'lamp',op:'set',value:'on'}]}],
      onChange(next){visuals.lid=next.lid;visuals.lamp=next.lamp;},
      verifyVisual:()=>visuals.lamp==='off'
    });
    expect(()=>machine.execute('start')).toThrow('PROJECT_MACHINE_VISUAL_UNVERIFIED');
    expect(machine.read()).toEqual({lid:'closed',lamp:'off'});
    expect(visuals).toEqual({lid:'closed',lamp:'off'});
  });

  it('advances a timed workflow, autocompletes only its hidden transition, and restores the clock',()=>{
    const machine=new ProjectStateMachine({
      initialState:{mode:'idle',elapsed:0,contents:'empty'},
      ranges:{elapsed:{min:0,max:3}},
      transitions:[
        {name:'load',when:[{field:'mode',op:'eq',value:'idle'}],effects:[{field:'contents',op:'set',value:'rice'}]},
        {name:'start',when:[{field:'contents',op:'eq',value:'rice'},{field:'mode',op:'eq',value:'idle'}],
          effects:[{field:'mode',op:'set',value:'cooking'},{field:'elapsed',op:'set',value:0}]},
        {name:'done',expose:false,when:[{field:'elapsed',op:'gte',value:3},{field:'mode',op:'eq',value:'cooking'}],
          effects:[{field:'mode',op:'set',value:'done'}]}
      ],
      timers:[{field:'elapsed',rate:1,max:3,when:[{field:'mode',op:'eq',value:'cooking'}],onComplete:'done'}]
    });
    expect(machine.listedActions().map(x=>x.name)).toEqual(['load','start']);
    expect(machine.advance(3).state.elapsed).toBe(0);
    machine.execute('load');machine.execute('start');
    const half=machine.advance(1.25);
    expect(half.state).toMatchObject({mode:'cooking',elapsed:1.25});
    machine.restore(half.state);
    const finish=machine.advance(1.75);
    expect(finish).toMatchObject({completed:['done'],state:{mode:'done',elapsed:3,contents:'rice'}});
    expect(machine.advance(1).changed).toBe(false);
    expect(()=>machine.advance(-1)).toThrow('PROJECT_MACHINE_CLOCK_INVALID');
    expect(()=>machine.execute('done')).toThrow('PROJECT_MACHINE_ACTION_UNAVAILABLE');
  });

  it('registers exposed actions and atomically restores all project machine snapshots',async()=>{
    const events={emit:vi.fn()};
    const runtime={store:{has:()=>false},affordances:{get:()=>null},events};
    const api=new ProjectCapabilities(runtime);
    const first=api.registerStateMachine({id:'book',...pageDefinition()});
    const second=api.registerStateMachine({id:'journal',...pageDefinition()});
    expect(api.inspect('book').actions.find(x=>x.name==='next').available).toBe(false);
    await api.execute({target:'book',name:'open'});
    const outcome=await api.execute({target:'book',name:'next'});
    expect(outcome).toMatchObject({verified:true,physicsVerified:false,evidence:{verified:true,kind:'state-machine-transition'}});
    const saved=api.exportStateMachines();
    expect(saved.entities.book.page).toBe(1);
    first.advance(0); await api.execute({target:'journal',name:'open'});
    api.restoreStateMachines(saved);
    expect(api.readState('journal').cover).toBe('closed');
    expect(api.readState('book').page).toBe(1);
    const corrupt=structuredClone(saved);
    corrupt.entities.journal.cover='invalid';
    expect(()=>api.restoreStateMachines(corrupt)).toThrow('PROJECT_MACHINE_STATE_INVALID');
    expect(api.readState('book').page).toBe(1);
    expect(api.readState('journal').cover).toBe('closed');
    const missing=structuredClone(saved);delete missing.entities.journal;
    expect(()=>api.restoreStateMachines(missing)).toThrow('PROJECT_MACHINE_SNAPSHOT_INVALID');
    first.dispose();
    expect(api.has('book')).toBe(false);
    second.dispose();
    expect(api.exportStateMachines()).toBeNull();
    api.dispose();
  });
});
