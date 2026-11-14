import * as z from 'zod/v4';

// Expose bounded, structured physics evidence without leaking internal exception stacks.
export function publicMcpError(error) {
  const code=error instanceof z.ZodError ? 'INVALID_ARGUMENTS'
    : /^[A-Z_]+$/.test(error?.code || '') ? error.code
    : /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'RUNTIME_ERROR';
  if (code !== 'ASSET_PHYSICS_VERIFICATION_FAILED' || !Array.isArray(error?.details?.parts)) {
    return {state:'failed',code};
  }
  const parts=error.details.parts.slice(0,8).map(part=>({
    part:String(part.part || '').slice(0,64),
    actions:(part.actions || []).slice(0,8).filter(action=>action.ok === false).map(action=>({
      name:String(action.action || '').slice(0,64),
      failures:(action.failures || []).slice(0,5).map(failure=>({
        code:/^[A-Z_]+$/.test(failure.code || '') ? failure.code : 'PHYSICS_CHECK_FAILED',
        stage:/^[A-Z_]+$/.test(failure.stage || '') ? failure.stage : 'VERIFICATION',
        collisions:(failure.collisions || []).slice(0,4).map(hit=>({
          sourcePart:String(hit.sourcePart || '').slice(0,64),
          targetPart:String(hit.targetPart || '').slice(0,64),
          depth:Number.isFinite(hit.depth) ? Number(hit.depth.toFixed(4)) : null
        }))
      }))
    }))
  }));
  return {state:'failed',code,diagnostics:{tested:error.details.tested,parts}};
}
