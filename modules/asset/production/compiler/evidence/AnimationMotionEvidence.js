import { Quaternion, Vector3 } from 'three';

// Experimental GLB motion-evidence extractor. This reports hypotheses only;
// it never authorizes or registers a physical interaction.
const round = value => Number(value.toFixed(6));
const vec = vector => vector.toArray().map(round);
const sqDistance = (a, b) => a.reduce((sum, x, i) => sum + (x - b[i]) ** 2, 0);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = value => Math.hypot(...value);
const sub = (a, b) => a.map((value, index) => value - b[index]);
const mul = (v, scalar) => v.map(value => value * scalar);
const hasMesh = node => Boolean(node.getMesh()) || node.listChildren().some(hasMesh);
const issue = (code, node, clip) => ({ code, node, clip });

function readSamples(channel) {
  const sampler = channel.getSampler();
  const path = channel.getTargetPath();
  if (!sampler || sampler.getInterpolation() !== 'LINEAR') return { error:'INTERPOLATION_UNSUPPORTED' };
  const input = sampler.getInput()?.getArray();
  const output = sampler.getOutput()?.getArray();
  const width = path === 'rotation' ? 4 : 3;
  if (!input || !output || input.length < 2 || output.length !== input.length * width
    || [...input, ...output].some(number => !Number.isFinite(number))
    || Array.from(input).some((value, index) => index && value <= input[index - 1])) {
    return { error:'ANIMATION_TRACK_INVALID' };
  }
  const samples = Array.from(input, (_, index) =>
    Array.from(output.slice(index * width, (index + 1) * width)));
  return { samples };
}

function translationMotion(node, samples) {
  const rest = node.getTranslation();
  if (sqDistance(rest, samples[0]) > 1e-6) return { error:'ANIMATION_REST_POSE_MISMATCH' };
  const deltas = samples.map(sample => sub(sample, samples[0]));
  const longest = deltas.reduce((best, value) => norm(value) > norm(best) ? value : best, [0, 0, 0]);
  const span = norm(longest);
  if (span < .03) return null;
  const axis = mul(longest, 1 / span);
  const residual = Math.max(...deltas.map(delta => norm(sub(delta, mul(axis, dot(delta, axis))))));
  if (residual > Math.max(.005, span * .02)) return { error:'TRANSLATION_NONLINEAR' };
  const values = deltas.map(delta => dot(delta, axis));
  return { type:'prismatic', axis:axis.map(round), limits:[round(Math.min(0, ...values)), round(Math.max(0, ...values))],
    residual:round(residual) };
}

function rotationMotion(node, samples) {
  const start = new Quaternion().fromArray(samples[0]).normalize();
  const rest = new Quaternion().fromArray(node.getRotation()).normalize();
  if (Math.abs(start.dot(rest)) < .9999) return { error:'ANIMATION_REST_POSE_MISMATCH' };
  const inverse = start.clone().invert();
  const deltas = samples.map(sample => {
    const delta = new Quaternion().fromArray(sample).normalize().multiply(inverse);
    if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    const sinHalf = Math.hypot(delta.x, delta.y, delta.z);
    return { angle:2 * Math.atan2(sinHalf, delta.w),
      axis:sinHalf > 1e-8 ? new Vector3(delta.x / sinHalf, delta.y / sinHalf, delta.z / sinHalf) : null };
  });
  const largest = deltas.reduce((best, value) => value.angle > best.angle ? value : best, deltas[0]);
  if (largest.angle < .1) return null;
  if (largest.angle > Math.PI - .01) return { error:'ROTATION_RANGE_AMBIGUOUS' };
  const axis = largest.axis;
  const signed = [];
  for (const delta of deltas) {
    if (delta.angle < 1e-5) { signed.push(0); continue; }
    const alignment = delta.axis.dot(axis);
    if (Math.abs(alignment) < .995) return { error:'ROTATION_MULTIPLE_AXES' };
    signed.push(delta.angle * Math.sign(alignment));
  }
  const jumps = signed.slice(1).map((value, index) => Math.abs(value - signed[index]));
  if (Math.max(...jumps) > Math.PI - .01) return { error:'ROTATION_UNWRAP_AMBIGUOUS' };
  return { type:'revolute', axis:vec(axis), limits:[round(Math.min(0, ...signed)), round(Math.max(0, ...signed))],
    residual:round(Math.max(...deltas.map(delta => delta.angle < 1e-5 ? 0 : 1 - Math.abs(delta.axis.dot(axis))))) };
}

export function inferAnimationMotion(document) {
  const candidates = [], issues = [];
  const nodes = document.getRoot().listNodes();
  for (const animation of document.getRoot().listAnimations()) {
    const clip = animation.getName() || '(unnamed)';
    const tracks = new Map();
    for (const channel of animation.listChannels()) {
      const node = channel.getTargetNode();
      const path = channel.getTargetPath();
      if (!node || !['translation', 'rotation', 'scale'].includes(path)) continue;
      if (!tracks.has(node)) tracks.set(node, {});
      const group = tracks.get(node);
      if (group[path]) { issues.push(issue('ANIMATION_DUPLICATE_CHANNEL', node.getName(), clip)); group.error = true; continue; }
      group[path] = path === 'scale' ? { error:'SCALE_ANIMATION_UNSUPPORTED' } : readSamples(channel);
    }
    for (const [node, group] of tracks) {
      if (group.error || !hasMesh(node)) continue;
      if (group.scale) { issues.push(issue('SCALE_ANIMATION_UNSUPPORTED', node.getName(), clip)); continue; }
      const translation = group.translation?.error ? group.translation
        : group.translation ? translationMotion(node, group.translation.samples) : null;
      const rotation = group.rotation?.error ? group.rotation
        : group.rotation ? rotationMotion(node, group.rotation.samples) : null;
      const error = translation?.error || rotation?.error
        || (translation && rotation ? 'COMPOUND_MOTION_UNSUPPORTED' : null);
      if (error) { issues.push(issue(error, node.getName(), clip)); continue; }
      const motion = rotation || translation;
      if (!motion) continue;
      candidates.push({
        node:node.getName() || null, nodeIndex:nodes.indexOf(node),
        parent:node.getParentNode()?.getName() || '$root',
        hypothesis:{ type:motion.type, axis:motion.axis,
          parentAnchor:node.getTranslation().map(round), childAnchor:[0,0,0],
          limits:motion.limits },
        evidence:{ type:'gltf-animation', clip, sampleCount:(group.rotation || group.translation).samples.length,
          axisResidual:motion.residual, scope:'observed-local-motion-not-mechanical-truth' },
        status:'candidate', executable:false, physicsVerified:false,
        missing:['geometry-contact-analysis','mass-and-colliders','isolated-physics-verification','task-verification']
      });
    }
  }
  // Multiple animation clips may depict different motions; no automatic merge
  // without a coherence check, even if one axis looks plausible.
  const count = new Map();
  for (const candidate of candidates) count.set(candidate.nodeIndex, (count.get(candidate.nodeIndex) || 0) + 1);
  for (const [nodeIndex, amount] of count) if (amount > 1)
    issues.push({ code:'MULTIPLE_CLIPS_REQUIRE_REVIEW', node:nodes[nodeIndex].getName() });
  return { schema:'agentscape.motion-evidence-experiment', schemaVersion:1,
    candidates:candidates.filter(candidate => count.get(candidate.nodeIndex) === 1), issues };
}
