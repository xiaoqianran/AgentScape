import {it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {startServer} from '../../apps/mcp-server/main.mjs';

const thermal=(initialTemperatureK=301)=>({
  schema:'agentscape.simulation-profile',schemaVersion:2,model:'thermal-network-v1',
  nodes:[{id:'root',partName:'$root',material:{
    name:'MCP test material',densityKgM3:1000,specificHeatJkgK:1000,provenance:'authored'
  },thermal:{mass:{mode:'explicit',massKg:1},initialTemperatureK,
    heatPowerW:0,ambientTemperatureK:293.15,
    ambientConductanceWPerK:0,contactConductanceWPerK:0}}],
  links:[]
});
const draft=()=>({
  schema:'agentscape.mechanical-draft',schemaVersion:1,
  name:'MCP 热学方块',type:'mcp_thermal',
  components:[{id:'Body',shape:'box',parent:null,position:[0,.25,0],
    size:[.5,.5,.5],color:'#e2a25a',collision:true}],
  motions:[],body:'fixed',simulation:thermal()
});

it('exposes authorized thermal experiments over real MCP HTTP and reuses request IDs',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'agentscape-thermal-mcp-'));
  const token=randomBytes(32).toString('hex');
  const app=await startServer({tokens:[{identity:'forge-test',token}],port:0,root});
  const client=new Client({name:'forge-thermal-test',version:'1'});
  const raw=async(name,args)=>{
    const reply=await client.callTool({name,arguments:args});
    return {isError:!!reply.isError,data:JSON.parse(reply.content[0].text)};
  };
  const call=async(name,args)=>{
    const r=await raw(name,args);
    expect(r.isError,JSON.stringify(r.data)).toBe(false);
    return r.data;
  };
  try{
    await client.connect(new StreamableHTTPClientTransport(
      new URL('http://127.0.0.1:'+app.port+'/mcp'),
      {requestInit:{headers:{Authorization:'Bearer '+token}}}
    ));
    const session=await call('session_create',{});
    const base={worldSessionId:session.worldSessionId};
    expect((await call('scene_thermal',{...base,operation:'list'})).value).toEqual([]);
    const host=app.manager.sessions.get(session.worldSessionId).host;
    const built=await host.world.assetModule.importMechanicalDraft(draft());
    await host.scene.addModel({id:'forge_block',asset:'asset://sha256/'+built.manifest.id.slice(6),position:[0,0,-3]});
    const list=(await call('scene_thermal',{...base,operation:'list'})).value;
    expect(list).toEqual([expect.objectContaining({id:'forge_block',nodeCount:1})]);
    const observed=(await call('scene_thermal',{...base,operation:'inspect',targetId:'forge_block'})).value;
    expect(observed).toMatchObject({model:'thermal-network-v1',state:{temperatureK:301}});

    const denied=await raw('scene_thermal',{...base,operation:'run',durationSec:1});
    expect(denied.isError).toBe(true);
    expect(denied.data.code).toBe('REQUEST_ID_REQUIRED');
    const heat=await call('scene_thermal',{...base,operation:'setPower',
      targetId:'forge_block',nodeId:'root',powerW:200,requestId:randomUUID()});
    expect(heat.value.heatPowerW).toBe(200);
    const requestId=randomUUID();
    const first=await call('scene_thermal',{...base,operation:'run',durationSec:1,requestId});
    const same=await call('scene_thermal',{...base,operation:'run',durationSec:1,requestId});
    expect(same).toEqual(first);
    expect(first.value).toMatchObject({frames:60,elapsedSec:1});
    expect(host.world.simulation.tick).toBeGreaterThanOrEqual(60);
    const series=(await call('scene_thermal',{...base,operation:'series',targetId:'forge_block'})).value;
    expect(series.samples.at(-1).timeSec).toBeCloseTo(1);
    expect(series.samples.at(-1).nodes.root.temperatureK).toBeCloseTo(301.2,6);
    expect((await call('scene_observe',{...base,target:'forge_block'})).simulation.state.temperatureK).toBeCloseTo(301.2,6);
  }finally{
    await client.close();
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
},90000);
