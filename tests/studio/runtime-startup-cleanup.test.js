import { beforeEach, describe, expect, it, vi } from 'vitest';

const state=vi.hoisted(()=>({
  releases:[], failAt:null, marks:[], world:null, session:null, ui:null
}));
const release=name=>{state.releases.push(name);};
const fail=name=>{if(state.failAt===name) throw new Error('FAIL_'+name);};

vi.mock('../../application/createSession.js',()=>({createSession:()=>state.session}));
vi.mock('../../application/scene/SceneAgentTools.js',()=>({SceneAgentTools:class{constructor(){fail('tools');}call(){} }}));
vi.mock('../../apps/studio/ui/StudioEnvironmentMaterializer.js',()=>({StudioEnvironmentMaterializer:class{constructor(){} }}));
vi.mock('../../apps/studio/bridge/StudioLiveBridgeClient.js',()=>({
  defaultAutoMcpEnabled:()=>false,
  StudioLiveBridgeClient:class {constructor(){fail('bridge');}setAutoEnabled(){}dispose(){release('bridge');}}
}));
vi.mock('../../apps/studio/authoring/AuthoringWorldController.js',()=>({AuthoringWorldController:class {constructor(){fail('authoringWorlds');this.tools=null;}}}));
vi.mock('../../application/world-authoring/AuthoringModelResolver.js',()=>({createAuthoringModelResolver:()=>()=>null}));
vi.mock('../../apps/studio/agent/AssetAgentVerifier.js',()=>({AssetAgentVerifier:class {run(){}}}));
vi.mock('../../apps/studio/ui/StudioWorldSurface.js',()=>({
  StudioWorldSurface:class{
    constructor(){fail('surface');this.editor={setInteractionMode:()=>fail('mode')};}
    applyInteractionMode(){fail('surfaceMode');}
    syncInput(){}
    dispose(){release('surface');}
  }
}));
vi.mock('../../apps/studio/runtime/RuntimeDriver.js',()=>({
  RuntimeDriver:class {constructor(){fail('driver');}start(){fail('driverStart');return this;}dispose(){release('driver');}}
}));
vi.mock('../../apps/studio/code-project/StudioCodeProjects.js',()=>({
  StudioCodeProjects:class {
    constructor(){fail('projects');}
    wrapTools(tools){return tools;}
    dispose(){release('projects');}
  }
}));

import {createStudioRuntime} from '../../apps/studio/bootstrap/createStudioRuntime.js';

function fixture(){
  const handlers=new Map();
  const world={
    events:{on:(name)=>{const stop=vi.fn(()=>release('event:'+name));handlers.set(name,stop);return stop;}},
    init:vi.fn(async()=>fail('worldInit')),
    dispose:vi.fn(()=>release('world')),
    assetModule:{loader:{}},
    simulation:{},rendering:{},
  };
  const generation={initialize:vi.fn(async()=>{fail('generation');return {};})};
  state.session={world,generation,scene:{},authoring:{dispose:()=>release('authoring')},promotion:{dispose:()=>release('promotion')}};
  const host={remove:vi.fn(()=>release('host'))};
  const ui={
    viewport:{appendChild:vi.fn(()=>{fail('hostAttach');})},shell:{},
    attachLiveBridge:vi.fn(value=>{if(value)fail('bridgeAttach');}),
    attachCodeProjects:vi.fn(value=>{if(value)fail('projectsAttach');}),
    getInteractionMode:()=> 'explore',
    subscribeInteractionMode:vi.fn(()=>()=>release('interactionSubscription')),
    isWorldVisible:()=>true,
  };
  state.ui=ui;state.world=world;
  const doc={createElement:vi.fn(()=>({className:'',hidden:false,remove:host.remove}))};
  vi.stubGlobal('document',doc);
  return {world,ui,host,options:{ui,environmentDefinition:{id:'test'},params:new URLSearchParams(),capabilityStatus:{assetCompile:{available:false}}}};
}

beforeEach(()=>{state.failAt=null;state.releases=[];state.marks=[];vi.unstubAllGlobals();vi.clearAllMocks();});

describe('createStudioRuntime partial initialization cleanup',()=>{
  for(const failAt of ['generation','worldInit','bridge','bridgeAttach','authoringWorlds','tools','surface','mode','surfaceMode','driver','driverStart','hostAttach','projects','projectsAttach']){
    it(`releases all previously acquired resources after ${failAt} fails`,async()=>{
      const {world,ui,options}=fixture();state.failAt=failAt;
      await expect(createStudioRuntime(options)).rejects.toThrow('FAIL_'+failAt);
      expect(world.dispose).toHaveBeenCalledOnce();
      expect(state.releases).toContain('authoring');
      expect(state.releases).toContain('promotion');
      expect(state.releases).toContain('event:runtime.init.phase');
      expect(state.releases).toContain('event:renderer.first-frame');
      if(!['generation','worldInit','bridge'].includes(failAt))expect(state.releases).toContain('bridge');
      if(['driverStart','hostAttach','projects','projectsAttach'].includes(failAt))expect(state.releases).toContain('driver');
      if(['hostAttach','projects','projectsAttach'].includes(failAt))expect(state.releases).toContain('surface');
      if(failAt==='projectsAttach')expect(ui.attachCodeProjects).toHaveBeenLastCalledWith(null);
      if(failAt==='bridgeAttach')expect(ui.attachLiveBridge).toHaveBeenLastCalledWith(null);
    });
  }

  it('disposes a successfully built runtime once, in dependency order',async()=>{
    const {world,ui,options}=fixture();
    const runtime=await createStudioRuntime(options);
    runtime.dispose();runtime.dispose();
    expect(world.dispose).toHaveBeenCalledOnce();
    expect(state.releases.filter(x=>x==='projects')).toHaveLength(1);
    expect(state.releases.filter(x=>x==='driver')).toHaveLength(1);
    expect(state.releases.filter(x=>x==='bridge')).toHaveLength(1);
    expect(ui.attachLiveBridge).toHaveBeenLastCalledWith(null);
    expect(ui.attachCodeProjects).toHaveBeenLastCalledWith(null);
    expect(state.releases.indexOf('driver')).toBeLessThan(state.releases.indexOf('world'));
  });
});
