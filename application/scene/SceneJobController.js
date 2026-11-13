import { recordInteractionEvidence } from '../../modules/world/verification/InteractionEvidence.js';
import { sceneError, sceneInteractionSchema, diagnostic } from './SceneContracts.js';
import { resolveCapability } from './CapabilityResolver.js';
import { legacyPhysicalRequest } from './SceneInteractionAdapters.js';
import { verifyInteractionResult } from '../../modules/world/runtime/interaction/InteractionContract.js';

/** Manages asynchronous Scene actions through one cancellable Job lifecycle. */
export function createSceneJobController(world, { tools, assertIdle, assertOpen, setBusy, actors, onProjectAction = () => {}, result }) {
  const jobs = new Map();
  // Historical Scene commands remain supported; capability invocation is
  // dispatched by executor, with arbitrary articulated names read from manifests.
  const physicalActions = new Set(['push', 'drag', 'rotate', 'slide', 'rotateJoint']);
  const cancelPending = () => {
    if ([...jobs.values()].some(job => job.status === 'running' && job.cancelled && !job.controller)) {
      world.interactions.cancelPending('SCENE_CANCELLED');
      world.locomotion.cancelAll('SCENE_CANCELLED');
      world.affordances.cancel('SCENE_CANCELLED');
    }
  };

  const controller = {
    interact(input) {
      const args = sceneInteractionSchema.parse(input);
      assertIdle();
      if (args.action === 'custom') return startProjectAction(args);
      if (args.action === 'invoke') return startInvocation(args);
      return startLegacyAction(args);
    },
    getJob(key) {
      assertOpen();
      const job = getJob(key);
      return structuredClone({ id: job.id, status: job.status, result: job.result });
    },
    async waitJob(key) {
      assertOpen();
      const job = getJob(key);
      await job.promise;
      return controller.getJob(key);
    },
    cancelJob(key) {
      assertOpen();
      const job = getJob(key);
      if (job.status === 'running') {
        job.cancelled = true;
        job.controller?.abort();
        if (!job.controller) cancelPending();
      }
      return { id: job.id, status: job.status, cancellationRequested: Boolean(job.cancelled) };
    }
  };

  // The historical intent-based API continues to use its existing runtime
  // commands, actor checks, policy and verification semantics unchanged.
  function startLegacyAction(args) {
    const nativeAction = args.action === 'activate';
    if (nativeAction && !actors().agents.some(agent => agent.id === args.actor)) throw sceneError('ACTOR_NOT_AGENT');
    if (nativeAction && !world.environment?.interactions?.some(item =>
      item.id === args.target && typeof item.activate === 'function')) throw sceneError('INTERACTION_UNAVAILABLE');
    const contract = 'target' in args ? world.affordances?.get?.(args.target) : null;
    const worldAction = Boolean(contract) && !nativeAction;
    if (worldAction && !contract.actions.includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');
    if (!contract && ['turn_on', 'turn_off', 'pull_out', 'return', 'write'].includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');

    const [skill, params] = args.action === 'navigate' ? ['navigateTo', { id:args.actor, end:args.position }]
      : args.action === 'pickup' ? ['approachAndPickup', { actorId:args.actor, targetId:args.target }]
      : args.action === 'place' ? ['approachAndPlace', { actorId:args.actor, supportId:args.target, surfaceId:args.surfaceId }]
      : ['approachAndInteract', { actorId:args.actor, targetId:args.target, action:args.action, partName:args.partName }];
    const physical = physicalActions.has(args.action);

    return startJob({
      immediate: true, // Keep legacy tools.call synchronous for existing integrations.
      execute: job => nativeAction ? world.mutate('scene:native-activate', () =>
        world.commands.activateEnvironmentInteraction(args.target, { actorId:args.actor, requireReach:true }))
        : worldAction ? world.mutate('scene:world-action:' + args.action, () =>
          world.commands.executeAffordance({
            targetId:args.target, actorId:args.actor, action:args.action, args:args.args || {}
          }, { approach:true }))
        : physical ? world.mutate('scene:' + args.action, async () => {
          const value = await world.interactions.manipulate(args.actor, args.target, args.action, args.args);
          recordInteractionEvidence(world, {
            targetId:args.target, capability:args.action.toUpperCase(), verified:value.verified,
            source:'scene-api', commandId:job.id, result:value
          });
          return value;
        }) : tools.call(skill, params),
      settle: (value, job) => {
        const activated = nativeAction && value.status === 'environment-interaction-activated';
        const outcome = nativeAction
          ? { state:value.verified === true ? 'verified' : activated ? 'unverified' : 'failed', verified:value.verified === true, physicsVerified:false }
          : worldAction
          ? { state:value.status === 'world-action-completed' && value.verified === true ? 'verified' : 'failed', verified:value.status === 'world-action-completed' && value.verified === true, physicsVerified:false }
          : physical ? { state:value.verified ? 'verified' : 'failed', verified:value.verified === true }
          : tools.executionPolicy(skill, value).outcome;
        return {
          status:outcome.verified || activated ? 'succeeded' : 'failed',
          verification:{ status:!job.cancelled && outcome.verified ? 'verified' : 'unverified', evidence:value },
          outcome
        };
      }
    });
  }

  // Each capability declares an executor; only the legacy adapter translates
  // historical action names. New Code Project, environment and joint names
  // never need a new branch in the Scene dispatcher.
  const invocationExecutors = new Map([
    ['project-action', request => startProjectAction(request)],
    ['world-action', request => {
      if (!request.actor) throw sceneError('ACTOR_REQUIRED');
      return startRuntimeCapability({ ...request, source:'environment' }, () =>
        world.commands.executeAffordance({
          targetId:request.target, actorId:request.actor, action:request.name, args:request.args
        }, { approach:true }),
        value => value?.status === 'world-action-completed' && value.verified === true);
    }],
    ['interaction', (request, capability) => startPhysicalCapability(request, capability)]
  ]);

  function startInvocation(request) {
    const { capability } = resolveCapability(world, request);
    const executor = invocationExecutors.get(capability.executor);
    if (!executor) throw sceneError('ACTION_EXECUTOR_UNAVAILABLE');
    return executor(request, capability);
  }

  function startPhysicalCapability(request, capability) {
    const { target, name, actor, args = {} } = request;
    if (!actor) throw sceneError('ACTOR_REQUIRED');
    const record = world.store.get(target);
    // Contract membership, not the verb, identifies a physically articulated
    // action. This includes open/close and previously unknown semantic verbs.
    const contract = capability.partName && world.interactions.interactionContracts(record).contracts.find(item =>
      item.action === name && item.target.partName === capability.partName);
    if (!contract) return controller.interact(legacyPhysicalRequest(request));
    if (Object.keys(args).length) throw sceneError('ACTION_ARGUMENTS_UNSUPPORTED');
    return startRuntimeCapability({ ...request, source:'asset' }, async () => {
      const value = await world.commands.approachAndInteract(actor, target, name, { partName:capability.partName });
      const verified = verifyInteractionResult(contract, { ...value, part:value.partName }).verified;
      return { ...value, verified, physicsVerified:verified, evidenceKind:'joint-motor' };
    }, value => value?.verified === true);
  }

  function startRuntimeCapability({ target, name, source }, execute, verify) {
    return startJob({
      execute: () => world.mutate('scene:invoke:' + name, execute),
      settle: (value, job) => {
        const verified = !job.cancelled && verify(value) === true;
        if (verified) recordInteractionEvidence(world, {
          targetId:target, capability:name.toUpperCase(), verified:true,
          source: source === 'asset' ? 'physical-articulation' : 'environment',
          commandId:job.id, result:value
        });
        return {
          status:verified ? 'succeeded' : 'failed',
          verification:{ status:verified ? 'verified' : 'unverified', evidence:value },
          outcome:{ state:verified ? 'verified' : 'failed', verified,
            physicsVerified:source === 'asset' && verified && value.physicsVerified === true }
        };
      }
    });
  }

  function startProjectAction(args) {
    return startJob({
      abortable:true,
      timeoutMs:world.projectCapabilities.timeoutFor(args.target, args.name),
      execute:job => world.projectCapabilities.execute(args, { signal:job.controller.signal }),
      settle:(value, job) => {
        const verified = !job.cancelled && value.verified;
        if (verified) recordInteractionEvidence(world, {
          targetId:args.target, capability:args.name.toUpperCase(), verified:true,
          source:'project-defined', commandId:job.id, result:value
        });
        onProjectAction();
        return {
          status:'succeeded',
          verification:{ status:verified ? 'verified' : 'unverified', evidence:value.evidence },
          outcome:{ state:job.cancelled ? 'unverified' : verified ? 'verified' : value.verificationRequested ? 'unverified' : 'accepted',
            verified, physicsVerified:false }
        };
      }
    });
  }

  function startJob({ execute, settle, timeoutMs = 60_000, abortable = false, immediate = false }) {
    if (jobs.size >= 128) {
      const terminal = [...jobs].find(([, item]) => item.status !== 'running');
      if (terminal) jobs.delete(terminal[0]);
      else throw sceneError('JOB_LIMIT');
    }
    const job = { id:'job_' + crypto.randomUUID(), status:'running', result:null };
    if (abortable) job.controller = new AbortController();
    jobs.set(job.id, job);
    setBusy(true);
    let pending;
    try {
      pending = immediate ? Promise.resolve(execute(job)) : Promise.resolve().then(() => execute(job));
    } catch (error) {
      pending = Promise.reject(error);
    }
    job.promise = pending.then(value => {
      const completion = settle(value, job);
      job.status = job.cancelled ? 'cancelled' : completion.status;
      job.result = result('interact', value, { ...completion, status:job.status });
    }).catch(error => {
      job.status = job.cancelled ? 'cancelled' : 'failed';
      job.result = result('interact', null, {
        status:job.status,
        ...(abortable ? { verification:{ status:'unverified', evidence:null } } : {}),
        diagnostics:[diagnostic(error)]
      });
    }).finally(() => {
      clearTimeout(job.timer);
      setBusy(false);
    });
    if (timeoutMs != null) {
      job.timer = setTimeout(() => controller.cancelJob(job.id), timeoutMs);
      job.timer.unref?.();
    }
    return { id:job.id, status:job.status };
  }

  function getJob(key) {
    const job = jobs.get(key);
    if (!job) throw sceneError('JOB_NOT_FOUND');
    return job;
  }
  return { ...controller, cancelPending };
}
