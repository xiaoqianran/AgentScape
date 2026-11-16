import { it, expect } from 'vitest';
import { createSession } from '../../application/createSession.js';
import { createMonumentHall } from '../../modules/world/content/monumentHall.js';
import { createBlankWorld } from '../../modules/world/content/blankWorld.js';
import { createAssetModule } from '../../modules/asset/AssetModule.js';
import { createHeadlessGLTFLoader } from '../../apps/mcp-server/HeadlessGLTFLoader.js';
import { installHeadlessAssetIO } from '../../apps/mcp-server/HeadlessAssetIO.js';
import { PromptHybridWorldOrchestrator } from '../../application/generation/PromptHybridWorldOrchestrator.js';
import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { AgentTools } from '../../application/AgentTools.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';

// APP-PROMPT-002: the agent-facing repair loop. A world-rejected result from
// buildGeneratedHybridWorld carries its admission diagnostics back into the
// next model turn (the world has already rolled back), so the planner can
// revise the proposal and call again instead of failing the whole request.
it('lets the agent repair a rejected world proposal from the diagnostics it receives', async () => {
  installHeadlessAssetIO();
  const session = createSession(null, { assetModule: createAssetModule({ gltfLoader: createHeadlessGLTFLoader() }), environmentFactory: () => createMonumentHall({ loadAssets: false }) });
  await session.world.init();
  const world = session.world;
  try {
    let builderCalls = 0;
    const worldBuilder = { run: async (ir) => {
      builderCalls++;
      if (JSON.stringify(ir).includes('cupp')) {
        return { status: 'world-rejected', reason: 'ASSET_NOT_FOUND: cupp', admission: { status: 'rejected', reasons: ['ASSET_NOT_FOUND: cupp'] }, attempts: [{ status: 'rejected' }] };
      }
      return { status: 'world-built', admission: { status: 'accepted', reasons: [] }, attempts: [{ status: 'accepted' }] };
    } };
    const orchestrator = new PromptHybridWorldOrchestrator(world, {
      worldBuilder,
      generateWorldArtifacts: async () => ({ status: 'world-artifacts-ready', prompt: 'a compact garden', jobs: { image: 'j1', world: 'j2' }, artifacts: {} }),
      materializeEnvironment: async () => createBlankWorld({ id: 'generated-garden' }),
      revisionIdFactory: () => 'world-agent-repair'
    });
    world.skills = registerCoreSkills(new SkillRegistry({ policy: world.policy, trace: world.trace, runtime: world }), world, { promptHybridWorldOrchestrator: orchestrator });
    const tools = new AgentTools(world);
    const proposal = (assetId) => ({ intent: { name: 'Generated Garden', task: 'put a pickup-able cup near the bench' },
      entities: [{ id: 'cup_01', asset: { assetId }, capabilityIntent: ['PICKUP'] }],
      spatial: { relations: [{ subject: 'cup_01', predicate: 'NEAR', anchor: { kind: 'observation', label: 'bench' } }] },
      interactions: [], rules: [], acceptance: [] });
    const seen = [];
    const responses = [
      { message: '', toolCalls: [{ id: 'w1', name: 'buildGeneratedHybridWorld', args: { request: { environmentPrompt: 'a compact garden', proposal: proposal('cupp') } } }] },
      { message: '', toolCalls: [{ id: 'w2', name: 'buildGeneratedHybridWorld', args: { request: { environmentPrompt: 'a compact garden', proposal: proposal('cup') } } }] },
      { message: '世界已建好。', toolCalls: [] }
    ];
    const gateway = { isConfigured: () => true, complete: async (request) => { seen.push(JSON.stringify(request)); return responses.shift() || { message: '', toolCalls: [] }; } };
    const agent = new ToolCallingAgent({ tools, gateway, maxSteps: 6 });
    const result = await agent.run('在花园里放一个可以拿起的杯子');

    expect(result.taskStatus).toBe('completed');
    expect(builderCalls).toBe(2);
    // The rejection diagnostics must be visible to the planner on its next turn.
    expect(seen[1]).toContain('ASSET_NOT_FOUND');
    expect(result.execution.filter(step => step.tool === 'buildGeneratedHybridWorld' && step.executed)).toHaveLength(2);
  } finally {
    session.scene.close();
    world.dispose();
  }
}, 60000);
