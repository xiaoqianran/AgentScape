/** Stateless geometry metrics and counterfactual sampling/convergence algorithms. */
export function shapeBoundingRadius(shape) {
  if (!shape) return null;
  if (shape.halfExtents) {
    const h=shape.halfExtents;
    const border=Number(shape.borderRadius) || 0;
    return Math.hypot(h.x+border,h.y+border,h.z+border);
  }
  if (Number.isFinite(shape.halfHeight) && Number.isFinite(shape.radius)) {
    const border=Number(shape.borderRadius) || 0;
    return Math.hypot(shape.radius+border,shape.halfHeight+shape.radius+border);
  }
  if (Number.isFinite(shape.radius)) return shape.radius;
  if (shape.vertices?.length) {
    let radius=0;
    for(let i=0;i+2<shape.vertices.length;i+=3) radius=Math.max(radius,Math.hypot(shape.vertices[i],shape.vertices[i+1],shape.vertices[i+2]));
    return radius || null;
  }
  if (shape.a && shape.b) return Math.max(Math.hypot(shape.a.x,shape.a.y,shape.a.z),Math.hypot(shape.b.x,shape.b.y,shape.b.z));
  return null;
}

export function estimateArticulationSampleCount({jointType,current,target,minRadius,maxLever,covered,minSamples=5,maxSamples=33}) {
  const delta=Math.abs(target-current);
  if(delta<1e-9) return {checked:true,count:minSamples,delta,maxTravel:0,resolution:.08};
  if(!covered || !Number.isFinite(minRadius)) return {checked:false,reason:'COLLIDER_EXTENT_UNAVAILABLE'};
  const maxTravel=jointType==='revolute' ? delta*maxLever : delta;
  const resolution=Math.min(.08,Math.max(.02,minRadius*.35));
  const count=Math.min(maxSamples,Math.max(minSamples,Math.ceil(maxTravel/resolution)+1));
  return {checked:true,count,delta,maxTravel,resolution,colliders:covered,minRadius,maxLever:jointType==='revolute'?maxLever:null};
}

export function denseCounterfactualSamples(samples,multiplier=2) {
  const denserCount=(count)=>Math.min(33,Math.max(count+2,Math.ceil(count*Math.max(1.25,multiplier))));
  return {original:denserCount(samples.original),blocker:denserCount(samples.blocker)};
}

export function summarizeCounterfactualConvergence(base,dense) {
  const ratio=(value,total)=>total>0?value/total:0;
  const baseRatios={
    current:ratio(base.current.conflictSamples,base.samples.original),
    target:ratio(base.target.conflictSamples,base.samples.original),
    action:ratio(base.action.conflictSamplePairs,base.samples.original*base.samples.blocker)
  };
  const denseRatios={
    current:ratio(dense.current.conflictSamples,dense.samples.original),
    target:ratio(dense.target.conflictSamples,dense.samples.original),
    action:ratio(dense.action.conflictSamplePairs,dense.samples.original*dense.samples.blocker)
  };
  const drift={
    current:Math.abs(baseRatios.current-denseRatios.current),
    target:Math.abs(baseRatios.target-denseRatios.target),
    action:Math.abs(baseRatios.action-denseRatios.action)
  };
  const qualitative={
    targetSweepClear:base.targetSweepClear===dense.targetSweepClear,
    clearanceGain:(base.conflictReduction>0)===(dense.conflictReduction>0)
  };
  return {
    checked:true,causal:false,status:qualitative.targetSweepClear&&qualitative.clearanceGain?'stable':'unstable',
    base,dense,
    qualitative,
    ratios:{base:baseRatios,dense:denseRatios,drift},
    maxRatioDrift:Math.max(drift.current,drift.target,drift.action)
  };
}
