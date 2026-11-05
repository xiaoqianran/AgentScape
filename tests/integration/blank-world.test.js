import { describe, expect, it } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { AgentTools } from '../../application/AgentTools.js';
import { bootstrapWorld } from '../../modules/agent/bootstrapWorld.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { ENVIRONMENTS } from '../../modules/world/content/environments.js';

describe('空白实验世界', () => {
  it('基础环境仅包含地面和照明，地面带真实物理碰撞体', () => {
    const environment = createBlankWorld();
    expect(environment.root.children.filter(child => child.isMesh)).toEqual([environment.floor]);
    expect(environment.colliders).toEqual([
      { shape:'box', halfExtents:[12,0.12,12], translation:[0,-0.12,0] }
    ]);
    expect(environment.layout.groundY).toBe(0);
  });

  it('新建住宅世界时，从没有家具的物理空地生成有碰撞的完整房屋资产',async()=>{
    const definition=ENVIRONMENTS.find(value=>value.id==='house-world');
    const session=createSession(null,{environmentFactory:()=>createBlankWorld({id:'house-world'})});
    await session.world.init();
    try {
      expect(session.world.queries.listObjects()).toHaveLength(0);
      await bootstrapWorld(new AgentTools(session.world,{profile:'builder',actor:'agent_01',source:'test'}),definition.bootstrap);
      expect(session.world.queries.listObjects().map(object=>object.id).sort()).toEqual(['agent_01','cup_01','house_01','table_01']);
      const item=session.world.store.get('house_01');
      expect(item).toBeDefined();
      expect(session.world.assetModule.getManifest(item.assetId)?.physics?.body).toBe('fixed');
      expect(session.world.physics.getPosition('house_01')).toBeDefined();
    }finally {session.scene.close();session.world.dispose();}
  });
  it('使用通用资产接口在独立环境中创建桌子、杯子和智能体', async () => {
    const definition = ENVIRONMENTS.find(value => value.id === 'blank-world');
    expect(definition).toBeDefined();
    const session = createSession(null, { environmentFactory:createBlankWorld });
    await session.world.init();
    try {
      expect(session.world.queries.listObjects()).toHaveLength(0);
      await bootstrapWorld(new AgentTools(session.world, { profile:'builder', actor:'agent_01', source:'test' }), definition.bootstrap);
      expect(session.world.queries.listObjects().map(object => object.id).sort()).toEqual(['agent_01','cup_01','table_01']);
      expect(session.world.physics.getPosition('agent_01')).toBeDefined();
      expect(session.world.physics.getPosition('cup_01')).toBeDefined();


    } finally { session.scene.close(); session.world.dispose(); }
  });
});
