import { describe, expect, it, vi } from 'vitest';
import { PromptHybridWorldOrchestrator } from '../../application/generation/PromptHybridWorldOrchestrator.js';

const proposal = () => ({
  intent: { name: 'Generated Garden', task: 'put a pickup-able cup near the bench' },
  entities: [{ id: 'cup_01', asset: { assetId: 'cup' }, capabilityIntent: ['PICKUP'] }],
  spatial: { relations: [{ subject: 'cup_01', predicate: 'NEAR', anchor: { kind: 'observation', label: 'bench' } }] },
  interactions: [], rules: [], acceptance: []
});

const generationResult = () => ({
  status: 'world-artifacts-ready', prompt: 'a compact garden',
  route: { kind: 'text-image-world', image: { provider: 'modal-2d' }, world: { provider: 'modal-world' } },
  jobs: { image: 'job_image', world: 'job_world' }, sourceArtifact: null,
  artifacts: {}
});

function runtimeFixture(previousEnvironment) {
  const runtime = {
    environment: previousEnvironment,
    currentWorldRevision: { revision: { id: 'rev_old' }, provenance: { source: 'curated-pack' } },
    currentBehaviorBundle: { ruleGraph: [{ id: 'rule_old', kind: 'keep' }] },
    currentPhysicsRequirements: { requirements: ['gravity'] },
    lastAcceptanceBundle: { checks: ['accept_old'] },
    restoredAcceptanceEvidence: { kind: 'restored', ref: 'evidence_old' },
    interactionEvidence: new Map([['cup_01', { kind: 'contact', count: 2 }]]),
    loadRuleGraph: vi.fn(),
    exclusiveMutation: vi.fn(async (_label, fn) => fn()),
    snapshot: vi.fn(() => ({ scene: 'before-snapshot' })),
    restoreSnapshot: vi.fn(async () => {}),
    clearObjects: vi.fn(async () => {}),
    replaceEnvironment: vi.fn(async (environment) => { runtime.environment = environment; }),
    queries: { listObjects: () => [] }
  };
  return runtime;
}

const rejectedBuild = (runtime) => async () => {
  runtime.currentWorldRevision = { revision: { id: 'rev_new' } };
  runtime.currentBehaviorBundle = null;
  runtime.currentPhysicsRequirements = null;
  runtime.lastAcceptanceBundle = null;
  runtime.restoredAcceptanceEvidence = null;
  runtime.interactionEvidence = new Map();
  return { status: 'world-rejected', reason: 'WORLD_REJECTED', admission: { status: 'rejected', reasons: ['WORLD_REJECTED'] }, attempts: [{ status: 'rejected' }] };
};
const acceptedBuild = async () => ({ status: 'world-built', admission: { status: 'accepted', reasons: [] }, attempts: [{ status: 'accepted' }] });

function orchestratorFixture(runtime, worldBuilder, nextEnvironment, generateWorldArtifacts) {
  return new PromptHybridWorldOrchestrator(runtime, {
    worldBuilder,
    generateWorldArtifacts: generateWorldArtifacts || (async () => generationResult()),
    materializeEnvironment: async () => nextEnvironment,
    revisionIdFactory: () => 'world-repair-unit'
  });
}

describe('PromptHybridWorldOrchestrator proposal repair', () => {
  it('repairs a rejected proposal with diagnostics feedback and builds on the second attempt', async () => {
    const previousEnvironment = { id: 'old-world', dispose: vi.fn() };
    const runtime = runtimeFixture(previousEnvironment);
    const nextEnvironment = { id: 'generated-garden', semantics: null, layout: null, generated: {}, dispose: vi.fn() };
    const worldBuilder = { run: vi.fn().mockImplementationOnce(rejectedBuild(runtime)).mockImplementationOnce(acceptedBuild) };
    const feedbackSeen = [];
    const propose = vi.fn(async ({ attempt, feedback }) => { feedbackSeen.push({ attempt, feedback }); return proposal(); });
    const orchestrator = orchestratorFixture(runtime, worldBuilder, nextEnvironment);

    const result = await orchestrator.run({ environmentPrompt: 'a compact garden', propose, maxProposalAttempts: 3 });

    expect(result).toMatchObject({ status: 'world-built', proposalAttempts: 2 });
    expect(propose).toHaveBeenCalledTimes(2);
    expect(feedbackSeen[0]).toEqual({ attempt: 1, feedback: null });
    expect(feedbackSeen[1].attempt).toBe(2);
    expect(feedbackSeen[1].feedback).toMatchObject({ reason: 'WORLD_REJECTED', admission: { status: 'rejected' } });
    expect(worldBuilder.run).toHaveBeenCalledTimes(2);
    expect(runtime.environment).toBe(nextEnvironment);
    expect(nextEnvironment.dispose).not.toHaveBeenCalled();
    expect(previousEnvironment.dispose).toHaveBeenCalledOnce();
  });

  it('stops after maxProposalAttempts rejections and rolls back', async () => {
    const previousEnvironment = { id: 'old-world', dispose: vi.fn() };
    const runtime = runtimeFixture(previousEnvironment);
    const nextEnvironment = { id: 'generated-garden', semantics: null, layout: null, generated: {}, dispose: vi.fn() };
    const worldBuilder = { run: vi.fn(rejectedBuild(runtime)) };
    const propose = vi.fn(async () => proposal());
    const orchestrator = orchestratorFixture(runtime, worldBuilder, nextEnvironment);

    const result = await orchestrator.run({ environmentPrompt: 'a compact garden', propose, maxProposalAttempts: 3 });

    expect(result).toMatchObject({ status: 'world-rejected', reason: 'WORLD_REJECTED', rolledBack: true, proposalAttempts: 3 });
    expect(propose).toHaveBeenCalledTimes(3);
    expect(worldBuilder.run).toHaveBeenCalledTimes(3);
    expect(runtime.environment).toBe(previousEnvironment);
    expect(nextEnvironment.dispose).toHaveBeenCalledOnce();
    expect(previousEnvironment.dispose).not.toHaveBeenCalled();
  });

  it('keeps static proposal calls single-attempt even when maxProposalAttempts is set', async () => {
    const previousEnvironment = { id: 'old-world', dispose: vi.fn() };
    const runtime = runtimeFixture(previousEnvironment);
    const nextEnvironment = { id: 'generated-garden', semantics: null, layout: null, generated: {}, dispose: vi.fn() };
    const worldBuilder = { run: vi.fn(rejectedBuild(runtime)) };
    const orchestrator = orchestratorFixture(runtime, worldBuilder, nextEnvironment);

    const result = await orchestrator.run({ environmentPrompt: 'a compact garden', proposal: proposal(), maxProposalAttempts: 3 });

    expect(result).toMatchObject({ status: 'world-rejected', proposalAttempts: 1 });
    expect(worldBuilder.run).toHaveBeenCalledTimes(1);
  });

  it('rejects ambiguous or invalid repair configuration before generation', async () => {
    const previousEnvironment = { id: 'old-world', dispose: vi.fn() };
    const runtime = runtimeFixture(previousEnvironment);
    const nextEnvironment = { id: 'generated-garden', semantics: null, layout: null, generated: {}, dispose: vi.fn() };
    const generateWorldArtifacts = vi.fn(async () => generationResult());
    const orchestrator = orchestratorFixture(runtime, { run: vi.fn() }, nextEnvironment, generateWorldArtifacts);

    await expect(orchestrator.run({ environmentPrompt: 'a compact garden', proposal: proposal(), propose: async () => proposal() }))
      .rejects.toMatchObject({ code: 'WORLD_PROPOSAL_SOURCE_AMBIGUOUS' });
    await expect(orchestrator.run({ environmentPrompt: 'a compact garden', propose: async () => proposal(), maxProposalAttempts: 4 }))
      .rejects.toMatchObject({ code: 'WORLD_PROPOSAL_ATTEMPTS_INVALID' });
    expect(generateWorldArtifacts).not.toHaveBeenCalled();
  });
});
