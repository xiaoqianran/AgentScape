import { recordInteractionEvidence } from '../../modules/world/verification/InteractionEvidence.js';
import { sceneError, sceneInteractionSchema, diagnostic } from './SceneContracts.js';

/** Manages asynchronous Scene actions and their cancellable Job evidence. */
export function createSceneJobController(world, { tools, assertIdle, assertOpen, setBusy, actors, onProjectAction = () => {}, result }) {
  const jobs = new Map();
  const physicalActions = new Set(['push', 'drag', 'rotate', 'slide', 'rotateJoint']);
  const cancelPending = () => {
    if ([...jobs.values()].some(job => job.status === 'running' && job.cancelled && !job.controller)) {
      world.interactions.cancelPending('SCENE_CANCELLED'); world.locomotion.cancelAll('SCENE_CANCELLED');world.affordances.cancel('SCENE_CANCELLED');
    }
  };
  const controller = {
    interact(input) {
      const args = sceneInteractionSchema.parse(input); assertIdle();
      if (args.action === 'custom') return startProjectAction(args);
      const nativeAction = args.action === 'activate';
      if (nativeAction && !actors().agents.some(agent=>agent.id===args.actor)) throw sceneError('ACTOR_NOT_AGENT');
      if (nativeAction && !world.environment?.interactions?.some(item=>item.id===args.target && typeof item.activate==='function')) {
        throw sceneError('INTERACTION_UNAVAILABLE');
      }
      const contract = 'target' in args ? world.affordances?.get?.(args.target) : null;
      const worldAction = Boolean(contract) && !nativeAction;
      if (worldAction && !contract.actions.includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');
      if (!contract && ['turn_on', 'turn_off', 'pull_out', 'return', 'write'].includes(args.action)) throw sceneError('ACTION_UNSUPPORTED');
      if (jobs.size >= 128) { const terminal = [...jobs].find(([, job]) => job.status !== 'running'); if (terminal) jobs.delete(terminal[0]); else throw sceneError('JOB_LIMIT'); }
      const job = { id: `job_${crypto.randomUUID()}`, status: 'running', result: null };
      jobs.set(job.id, job); setBusy(true);
      const [skill, params] = args.action === 'navigate' ? ['navigateTo', { id: args.actor, end: args.position }]
        : args.action === 'pickup' ? ['approachAndPickup', { actorId: args.actor, targetId: args.target }]
        : args.action === 'place' ? ['approachAndPlace', { actorId: args.actor, supportId: args.target, surfaceId: args.surfaceId }]
        : ['approachAndInteract', { actorId: args.actor, targetId: args.target, action: args.action, partName: args.partName }];
      const physical = physicalActions.has(args.action);
      const operation = nativeAction ? world.mutate('scene:native-activate', () => world.commands.activateEnvironmentInteraction(args.target,{
        actorId:args.actor,requireReach:true
      })) : worldAction ? world.mutate(`scene:world-action:${args.action}`, () => world.commands.executeAffordance({
        targetId: args.target, actorId: args.actor, action: args.action, args: args.args || {}
      },{approach:true})) : physical ? world.mutate(`scene:${args.action}`, async () => {
        const value = await world.interactions.manipulate(args.actor, args.target, args.action, args.args);
        recordInteractionEvidence(world, { targetId:args.target, capability:args.action.toUpperCase(), verified:value.verified,
          source:'scene-api', commandId:job.id, result:value });
        return value;
      }) : tools.call(skill, params);
      job.promise = operation.then(value => {
        const activated = nativeAction && value.status === 'environment-interaction-activated';
        const outcome = nativeAction
          ? {state:value.verified === true ? 'verified' : activated ? 'unverified' : 'failed',verified:value.verified === true,physicsVerified:false}
          : worldAction
          ? { state:value.status === 'world-action-completed' && value.verified === true ? 'verified' : 'failed', verified:value.status === 'world-action-completed' && value.verified === true, physicsVerified:false }
          : physical ? { state:value.verified ? 'verified' : 'failed', verified:value.verified === true } : tools.executionPolicy(skill, value).outcome;
        job.status = job.cancelled ? 'cancelled' : (outcome.verified || activated) ? 'succeeded' : 'failed';
        job.result = result('interact', value, { status: job.status, verification: { status: !job.cancelled && outcome.verified ? 'verified' : 'unverified', evidence: value }, outcome });
      }).catch(error => { job.status = job.cancelled ? 'cancelled' : 'failed'; job.result = result('interact', null, { status: job.status, diagnostics: [diagnostic(error)] }); })
        .finally(() => { clearTimeout(job.timer); setBusy(false); });
      job.timer = setTimeout(() => controller.cancelJob(job.id), 60_000); job.timer.unref?.();
      return { id: job.id, status: job.status };
    },
    getJob(key) { assertOpen(); const job = getJob(key); return structuredClone({ id: job.id, status: job.status, result: job.result }); },
    async waitJob(key) { assertOpen(); const job = getJob(key); await job.promise; return controller.getJob(key); },
    cancelJob(key) { assertOpen(); const job = getJob(key); if (job.status === 'running') { job.cancelled = true; job.controller?.abort(); if (!job.controller) cancelPending(); } return { id: job.id, status: job.status, cancellationRequested: Boolean(job.cancelled) }; },
  };
  function startProjectAction(args) {
    if (jobs.size >= 128) { const terminal = [...jobs].find(([, job]) => job.status !== 'running'); if (terminal) jobs.delete(terminal[0]); else throw sceneError('JOB_LIMIT'); }
    const job = { id: `job_${crypto.randomUUID()}`, status: 'running', result: null, controller: new AbortController() };
    jobs.set(job.id, job); setBusy(true);
    // Project closures are not serializable Runtime history. Their callbacks own
    // their state; never claim automatic rollback/undo of arbitrary code.
    job.promise = Promise.resolve().then(() => world.projectCapabilities.execute(args, { signal: job.controller.signal }))
      .then(value => {
        job.status = job.cancelled ? 'cancelled' : 'succeeded';
        const verified = !job.cancelled && value.verified;
        onProjectAction();
        job.result = result('interact', value, { status: job.status,
          verification: { status: verified ? 'verified' : 'unverified', evidence: value.evidence },
          outcome: { state: job.cancelled ? 'unverified' : verified ? 'verified' : value.verificationRequested ? 'unverified' : 'accepted', verified, physicsVerified: false } });
      }).catch(error => { job.status = job.cancelled ? 'cancelled' : 'failed'; job.result = result('interact', null, { status: job.status, verification: { status: 'unverified', evidence: null }, diagnostics: [diagnostic(error)] }); })
      .finally(() => { clearTimeout(job.timer); setBusy(false); });
    const timeoutMs = world.projectCapabilities.timeoutFor(args.target, args.name);
    if (timeoutMs != null) { job.timer = setTimeout(() => controller.cancelJob(job.id), timeoutMs); job.timer.unref?.(); }
    return { id: job.id, status: job.status };
  }
  function getJob(key) { const job = jobs.get(key); if (!job) throw sceneError('JOB_NOT_FOUND'); return job; }
  return { ...controller, cancelPending };
}
