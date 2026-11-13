import * as THREE from 'three';
import { validateAssetManifest } from '../../model/schema.js';

// A purely temporary mechanical rig. The original GLB, asset registry and
// WorldRuntime are never changed; the verifier owns and disposes each instance.
const vec3 = values => new THREE.Vector3(...values);
const reason = code => Object.assign(new Error(code), { code });

function colliderBoxes(object, owner, shouldInclude) {
  object.updateMatrixWorld(true);
  const ownerInverse = owner.matrixWorld.clone().invert();
  const colliders = [];
  object.traverse(mesh => {
    if (!mesh.isMesh || !shouldInclude(mesh)) return;
    if (mesh.isSkinnedMesh || mesh.morphTargetInfluences?.length) throw reason('HYPOTHESIS_DEFORMING_MESH_UNSUPPORTED');
    if (colliders.length >= 32) throw reason('HYPOTHESIS_COLLIDER_BUDGET');
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    const box = geometry.boundingBox.clone().applyMatrix4(ownerInverse.clone().multiply(mesh.matrixWorld));
    const size = new THREE.Vector3(), center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    if (![size.x, size.y, size.z].every(Number.isFinite)) throw reason('HYPOTHESIS_INVALID_GEOMETRY');
    colliders.push({
      shape:'box',
      halfExtents:size.toArray().map(value => Math.max(0.005, value / 2)),
      translation:center.toArray()
    });
  });
  return colliders;
}

function buildProbeRig(object, hypothesis, { mass = 1, friction = 0.5, requestedTarget = null } = {}) {
  if (!['prismatic', 'revolute'].includes(hypothesis.jointType)) throw reason('HYPOTHESIS_JOINT_UNSUPPORTED');
  const axisWorld = vec3(hypothesis.axisWorld);
  if (![axisWorld.x, axisWorld.y, axisWorld.z].every(Number.isFinite) || axisWorld.lengthSq() < .99
    || axisWorld.lengthSq() > 1.01) throw reason('HYPOTHESIS_AXIS_INVALID');
  if (!Array.isArray(hypothesis.pivotWorld) || hypothesis.pivotWorld.length !== 3
    || !hypothesis.pivotWorld.every(Number.isFinite)) throw reason('HYPOTHESIS_PIVOT_INVALID');
  if (!hypothesis.node) throw reason('HYPOTHESIS_NODE_UNNAMED');

  const matches = [];
  object.traverse(node => { if (node.name === hypothesis.node) matches.push(node); });
  if (matches.length !== 1 || matches[0] === object) throw reason('HYPOTHESIS_NODE_UNRESOLVED');
  const node = matches[0];
  if (!node.parent || !node.getObjectByProperty('isMesh', true) && !node.isMesh) throw reason('HYPOTHESIS_PART_EMPTY');
  object.updateMatrixWorld(true);
  const baseScale = new THREE.Vector3();
  object.getWorldScale(baseScale);
  if (Math.max(...baseScale.toArray().map(value => Math.abs(value - 1))) > 1e-5) throw reason('HYPOTHESIS_ROOT_SCALE_UNSUPPORTED');
  if (node.parent === object && node.isBone) throw reason('HYPOTHESIS_BONE_UNSUPPORTED');

  const nodeWorldPos = new THREE.Vector3();
  node.getWorldPosition(nodeWorldPos);
  const pivotWorld = vec3(hypothesis.pivotWorld);
  if (hypothesis.source === 'gltf-animation' && nodeWorldPos.distanceTo(pivotWorld) > .005)
    throw reason('HYPOTHESIS_REST_FRAME_MISMATCH');

  const pivot = new THREE.Object3D();
  pivot.name = '__agent_scape_kinematic_probe_pivot__';
  if (object.getObjectByName(pivot.name)) throw reason('HYPOTHESIS_PIVOT_NAME_CONFLICT');
  object.add(pivot);
  pivot.position.copy(object.worldToLocal(pivotWorld.clone()));
  object.updateMatrixWorld(true);
  pivot.attach(node);
  object.updateMatrixWorld(true);

  const isUnderPivot = mesh => {
    for (let parent = mesh; parent; parent = parent.parent) if (parent === pivot) return true;
    return false;
  };
  const partColliders = colliderBoxes(object, pivot, isUnderPivot);
  const rootColliders = colliderBoxes(object, object, mesh => !isUnderPivot(mesh));
  if (!partColliders.length) throw reason('HYPOTHESIS_PART_COLLIDER_MISSING');
  if (!rootColliders.length) throw reason('HYPOTHESIS_ROOT_COLLIDER_MISSING');

  const axis = axisWorld.clone().transformDirection(object.matrixWorld.clone().invert()).normalize().toArray();
  // Missing limits are *not* inferred. Limited signed sandbox probes are
  // simulation assumptions only, never reviewed or publishable joint limits.
  const observed = hypothesis.limits?.length === 2 && hypothesis.limits.every(Number.isFinite);
  // Keep each unobserved direction inside a *separate one-sided* sandbox joint.
  // A symmetric interval permits return-motor overshoot into the opposite,
  // already-colliding direction and would produce a false negative.
  const bounds = observed ? hypothesis.limits : requestedTarget < 0 ? [-.5, 0] : [0, .5];
  const target = requestedTarget ?? bounds.reduce((best, value) => Math.abs(value) > Math.abs(best) ? value : best, 0);
  if (!Number.isFinite(target) || Math.abs(target) < .1 || Math.abs(target) > Math.PI * .95
    || bounds[0] > 0 || bounds[1] < 0 || bounds[0] >= bounds[1]) throw reason('HYPOTHESIS_TARGET_UNSUPPORTED');
  const safeTarget = Math.sign(target) * Math.min(Math.abs(target), hypothesis.jointType === 'revolute' ? .6 : .45);

  const manifest = {
    id:'candidate_probe',
    type:'object',
    label:'Isolated mechanical hypothesis',
    actions:['probe','return'],
    source:{kind:'compiled',key:'unpublished-sandbox'},
    physics:{body:'fixed',mass:1,friction,colliders:rootColliders},
    parts:{
      probe:{
        node:pivot.name,parent:'$root',actions:['probe','return'],targets:{probe:safeTarget,return:0},
        physics:{body:'dynamic',mass,friction,colliders:partColliders},
        joint:{type:hypothesis.jointType,axis,parentAnchor:pivot.position.toArray(),childAnchor:[0,0,0],
          limits:[Math.min(0,...bounds),Math.max(0,...bounds)],motor:{stiffness:80,damping:12}}
      }
    }
  };
  validateAssetManifest(manifest);
  return { object, manifest, assumptions:{
    rootBody:'fixed',partMass:mass,friction,colliders:'local-mesh-AABB',
    jointLimits:observed?'observed-animation':'assumed-one-sided-directional-probe',
    probeTarget:safeTarget
  }};
}

function summarize(report) {
  const part = report.parts?.[0];
  const actions = (part?.actions || []).map(entry => ({
    name:entry.action,target:entry.target,ok:entry.ok,moved:entry.moved,
    targetReached:entry.targetReached,settled:entry.settled,
    failures:entry.failures
  }));
  const feasible = report.ok === true && report.physicsRegistered === true
    && report.tested === 1 && actions.some(action => action.name === 'probe' && action.moved === true)
    && part?.reversibility?.ok === true && part?.reversibility?.checked === true;
  return { feasible, evidence:{
    physicsRegistered:report.physicsRegistered, tested:report.tested,
    actions, reversibility:part?.reversibility || null, failures:part?.failures || [],
    baselinePenetrations:part?.baselinePenetrations || []
  }};
}

/**
 * Run bounded physical experiments against source-bound, compiler-discovered
 * hypotheses. This does not review a part, register an asset, grant a runtime
 * capability or establish semantic function.
 */
export async function screenKinematicHypotheses({ bytes, proposal, ids, loader, verifier }) {
  if (!loader?.loadBytes || !verifier?.verify) throw reason('HYPOTHESIS_SCREEN_UNAVAILABLE');
  const hypothesisById = new Map((proposal.kinematics?.hypotheses || []).map(item => [item.id, item]));
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4
    || new Set(ids).size !== ids.length) throw reason('HYPOTHESIS_SELECTION_INVALID');
  for (const id of ids) if (!hypothesisById.has(id)) throw reason('HYPOTHESIS_NOT_FOUND');
  const results = [];
  for (const id of ids) {
    const hypothesis = hypothesisById.get(id);
    // A static GLB does not indicate the permitted opening direction.
    // Testing only one sign would incorrectly reject possible hinges.
    const targets = hypothesis.limits == null ? [-.5, .5] : [null];
    const trials = [];
    for (const target of targets) {
      let object;
      try {
        object = await loader.loadBytes(bytes);
        const rig = buildProbeRig(object, hypothesis, { requestedTarget:target });
        const report = await verifier.verify('candidate_probe',{
          manifest:rig.manifest,
          requireRegistration:true,
          requireSettled:true,
          instantiate:async () => ({object:rig.object})
        });
        object = null; // The verifier owns disposal after instantiate.
        const evaluated = summarize(report);
        trials.push({
          target:rig.assumptions.probeTarget,
          status:evaluated.feasible ? 'simulation-passed' : 'simulation-failed',
          mechanicalFeasible:evaluated.feasible,
          assumptions:rig.assumptions,
          evidence:evaluated.evidence
        });
      } catch (error) {
        // One rejected direction must not prevent trying the opposite one.
        trials.push({target,status:'blocked',mechanicalFeasible:false,
          diagnostics:[{code:error.code || 'HYPOTHESIS_SIMULATION_ERROR'}]});
      } finally {
        if (object) {
          const {disposeObject3D} = await import('../../../rendering/disposeObject3D.js');
          disposeObject3D(object);
        }
      }
    }
    const feasible=trials.some(item=>item.mechanicalFeasible);
    const allBlocked=trials.every(item=>item.status==='blocked');
    results.push({id,source:hypothesis.source,jointType:hypothesis.jointType,
      status:feasible?'simulation-passed':allBlocked?'blocked':'simulation-failed',
      mechanicalFeasible:feasible,physicsVerified:false,functionVerified:false,
      admission:'not-granted',trials,
      assumptions:trials.find(item=>item.assumptions)?.assumptions || null});
  }
  return {
    schema:'agentscape.kinematic-screen',
    schemaVersion:1,
    proposalId:proposal.proposalId,
    sourceHash:proposal.sourceHash,
    results,
    admission:'not-granted',
    interpretation:'simulation-only; no semantic authorization or real-world mechanism proof'
  };
}
