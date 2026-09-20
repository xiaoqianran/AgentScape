import { SkillRegistry } from '../../application/skills/SkillRegistry.js';
import { PolicyEngine } from '../../foundation/PolicyEngine.js';
import { registerCoreSkills } from '../../application/skills/registerCoreSkills.js';
import { WorldQueries } from '../../modules/world/runtime/WorldQueries.js';
import { WorldCommands } from '../../modules/world/runtime/WorldCommands.js';
import { ToolCallingAgent } from '../../modules/agent/ToolCallingAgent.js';
import { HttpLLMGateway } from '../../modules/agent/gateway/HttpLLMGateway.js';
import { AgentTools } from '../../application/AgentTools.js';
import { loadEnvFile } from '../../apps/server/openai-compatible-agent-gateway.mjs';

loadEnvFile();

const yaw0Quat = [0, 0, 0, 1];

function createProbeRuntime() {
  const storeItems = new Map([
    ['agent_01', {
      id: 'agent_01',
      assetId: 'agent',
      manifest: { id: 'agent', type: 'agent', label: 'Embodied Agent', actions: ['navigate'], physics: { body: 'kinematic' } },
      object: { position: { toArray: () => [0, 0, 4] }, rotation: { toArray: () => [0, 0, 0] }, name: 'agent_01' },
      state: { navigation: { status: 'idle' } }
    }],
    ['cup_01', {
      id: 'cup_01',
      assetId: 'cup',
      manifest: { id: 'cup', type: 'cup', label: 'Cup', actions: ['pickup', 'drop', 'place', 'move'] },
      object: { position: { toArray: () => [1.2, 0, 3.4] }, rotation: { toArray: () => [0, 0, 0] } },
      state: {}
    }],
    ['table_01', {
      id: 'table_01',
      assetId: 'table',
      manifest: {
        id: 'table',
        type: 'table',
        label: 'Table',
        actions: ['move'],
        surfaces: [{ id: 'top' }]
      },
      object: { position: { toArray: () => [2.5, 0, 2.0] }, rotation: { toArray: () => [0, 0, 0] } },
      state: {}
    }],
    ['cabinet_01', {
      id: 'cabinet_01',
      assetId: 'cabinet',
      manifest: {
        id: 'cabinet',
        type: 'cabinet',
        label: 'Cabinet',
        actions: ['move'],
        parts: {
          door: {
            node: 'doorHinge',
            actions: ['open', 'close'],
            targets: { open: -1.2, close: 0 },
            joint: { type: 'revolute', axis: [0, 1, 0] },
            physics: { body: 'dynamic' }
          }
        }
      },
      object: { position: { toArray: () => [-1.5, 0, 2.8] }, rotation: { toArray: () => [0, 0, 0] } },
      state: {}
    }]
  ]);

  const positions = {
    agent_01: [0, 0, 4],
    cup_01: [1.2, 0, 3.4],
    table_01: [2.5, 0, 2.0],
    cabinet_01: [-1.5, 0, 2.8]
  };

  const runtime = {
    ready: true,
    version: 'probe',
    events: { emit() {}, on() { return () => {}; }, clear() {} },
    policy: new PolicyEngine(),
    trace: { emit() {} },
    mutate: async (_label, operation) => operation(),
    exclusiveMutation: async (_label, operation) => operation(),
    store: {
      has: (id) => storeItems.has(id),
      get: (id) => {
        if (!storeItems.has(id)) throw new Error(`Object not found: ${id}`);
        return storeItems.get(id);
      },
      list: () => [...storeItems.entries()]
    },
    physics: {
      getPosition: (id) => positions[id] ? [...positions[id]] : null,
      getRotation: () => [...yaw0Quat]
    },
    spatial: {
      findNearby(id, radius = 3) {
        const from = positions[id];
        if (!from) return [];
        return [...storeItems.entries()]
          .filter(([key]) => key !== id)
          .map(([key, record]) => {
            const p = positions[key];
            const distance = p ? Math.hypot(p[0] - from[0], p[1] - from[1], p[2] - from[2]) : 99;
            return { id: key, asset: record.assetId, distance: Number(distance.toFixed(3)) };
          })
          .filter((entry) => entry.distance <= radius)
          .sort((a, b) => a.distance - b.distance);
      }
    },
    affordances: {
      list({ actorId } = {}) {
        return {
          schema: 'agentscape.affordances.v1',
          total: 1,
          entities: [{
            id: 'cabin:front-door',
            label: 'Front Door',
            kind: 'door',
            position: [-1.2, 1.0, 2.9],
            evidenceKind: 'animated-transform',
            physicsVerified: false,
            actions: [{
              action: 'open',
              available: true,
              distance: 2.3
            }]
          }]
        };
      }
    },
    locomotion: {
      navigate: async (id, end) => {
        if (!positions[id]) throw new Error(`Object not found: ${id}`);
        positions[id] = [...end];
        storeItems.get(id).object.position.toArray = () => [...end];
        storeItems.get(id).state.navigation = { status: 'arrived', target: [...end] };
        return { status: 'arrived', id, target: [...end], position: positions[id].map((v) => Number(v.toFixed(3))) };
      }
    },
    observation: null
  };

  runtime.queries = new WorldQueries(runtime);
  runtime.commands = new WorldCommands(runtime);
  runtime.observation = {
    hasObject: (id) => runtime.store.has(id),
    object: (id) => {
      if (!runtime.store.has(id)) return null;
      const record = runtime.store.get(id);
      return { id, asset: record.assetId, type: record.manifest.type, position: positions[id] };
    },
    relations: () => [],
    actor: (id) => ({
      id,
      position: positions[id],
      navigation: runtime.store.get(id)?.state?.navigation || null,
      carry: null
    }),
    affordances: () => null,
    articulation: () => null
  };

  const registry = registerCoreSkills(new SkillRegistry({
    policy: runtime.policy,
    trace: runtime.trace,
    runtime
  }), runtime);
  runtime.skills = registry;
  return runtime;
}

const goals = [
  '让 agent_01 往前走一点。',
  '你旁边可交互的物体有哪些？'
];

const gateway = new HttpLLMGateway({
  endpoint: 'http://127.0.0.1:8788/agent',
  timeoutMs: 60000
});

if (!gateway.isConfigured()) {
  console.error('Gateway not configured');
  process.exit(1);
}

const runtime = createProbeRuntime();
const tools = new AgentTools(runtime, { profile: 'builder', actor: 'agent_01', source: 'probe' });
const agent = new ToolCallingAgent({
  tools,
  gateway,
  maxSteps: 6,
  log: (text, kind) => console.log(`[${kind}] ${text}`)
});

for (const goal of goals) {
  console.log('\n======== GOAL ========');
  console.log(goal);
  try {
    const result = await agent.run(goal);
    console.log('--- RESULT ---');
    console.log(JSON.stringify({
      taskStatus: result.taskStatus,
      message: result.message,
      steps: result.steps,
      tools: result.execution?.map((e) => ({ tool: e.tool, executed: e.executed, outcome: e.outcome, reason: e.reason })),
      lastMutation: result.lastMutation,
      unresolved: result.unresolvedMutations
    }, null, 2));
  } catch (error) {
    console.log('--- ERROR ---');
    console.log(error.message);
    console.log(JSON.stringify(agent.lastTaskObservation || runtime.lastTaskObservation || null, null, 2));
  }
  console.log('agent position now:', runtime.physics.getPosition('agent_01'));
}
