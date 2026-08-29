import { meta, string } from '../skillPrimitives.js';

export function registerVerificationSkills(add,runtime) {
  add('validateWorld', meta('执行确定性的几何、物理与关系校验。', ['world.read', 'physics.read']), () => runtime.validator.run());
  add('repairWorld', { ...meta('修复硬错误，并拒绝使结果更差的修复。', ['world.write', 'physics.read'], [], { report: { type: 'object' }, maxRepairs: { type: 'integer' } }), mutates: true }, (a) => runtime.repair.repair(a.report || runtime.validator.run(), { maxRepairs: a.maxRepairs ?? 20 }));
  add('getTrace', meta('读取近期引擎审计事件。', ['world.read'], [], { type: string, actor: string, sinceSeq: { type: 'integer' }, limit: { type: 'integer' } }), (a) => runtime.trace.list(a));
  add('verifyTrace', meta('验证审计事件链的一致性。', ['world.read']), () => runtime.trace.verify());
}
