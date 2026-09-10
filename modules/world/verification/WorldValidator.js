import { compileValidationFindings } from './Finding.js';

export class WorldValidator {
  constructor(runtime) { this.runtime = runtime; }

  run({ worldRevisionId = null } = {}) {
    const snapshot = this.runtime.spatial.snapshot();
    this.runtime.sceneGraph.update(snapshot);
    const hard = [];
    const advisory = [];
    const objects = this.runtime.listObjects();

    for (const object of objects) {
      const bounds = snapshot.get(object.id).bounds;
      if (bounds.min[1] < -0.08) hard.push({ code: 'G_BELOW_GROUND', object: object.id, message: 'Object penetrates below ground', measure: bounds.min[1] });
      if (bounds.min[1] > 0.12) {
        const relations = this.runtime.sceneGraph.list({ subject: object.id });
        const supported = relations.some((r) => r.predicate === 'ON' || r.predicate === 'INSIDE');
        if (!supported && !this.runtime.interactions.isHeld(object.id)) advisory.push({ code: 'G_FLOATING', object: object.id, message: 'Object appears unsupported', measure: bounds.min[1] });
      }
    }

    const relations = this.runtime.sceneGraph.list();
    const relationKeys = new Set(relations.map((edge) => `${edge.subject}|${edge.predicate}|${edge.object}`));
    for (const [object, other] of this.runtime.spatial.collisionPairs({ margin: 0.015, snapshot })) {
      const expectedCarryOverlap = this.runtime.interactions.heldByAgent?.(object) === other
        || this.runtime.interactions.heldByAgent?.(other) === object;
      if (expectedCarryOverlap) continue;
      const contained = relationKeys.has(`${object}|INSIDE|${other}`)
        ? { subject:object,target:other }
        : relationKeys.has(`${other}|INSIDE|${object}`)
          ? { subject:other,target:object }
          : null;
      if (contained) {
        const record=this.runtime.store?.has?.(contained.subject) ? this.runtime.store.get(contained.subject) : null;
        const position=this.runtime.physics?.getPosition?.(contained.subject);
        const pose=record && position
          ? this.runtime.physics?.manifestPoseClear?.(record.manifest,position,{excludeIds:[contained.subject]})
          : null;
        const penetratesContainer=pose?.checked === true
          && pose.clear === false
          && pose.blockedBy?.some((item)=>item.startsWith(`object:${contained.target}:`));
        if (!penetratesContainer) continue;
      }
      hard.push({ code: 'P_OVERLAP', object, other, message: 'Object bounding volumes overlap' });
    }

    for (const edge of relations) {
      if (edge.predicate === 'ON' && !relationKeys.has(`${edge.object}|SUPPORTS|${edge.subject}`)) {
        hard.push({ code: 'R_ASYMMETRIC', object: edge.subject, other: edge.object, message: 'ON relation missing inverse SUPPORTS relation' });
      }
    }

    const report={
      schema: 1,
      ok: hard.length === 0,
      counts: { hard: hard.length, advisory: advisory.length },
      hard,
      advisory,
      coverage: { objects: objects.length, relations: relations.length }
    };
    report.findings=compileValidationFindings(report,{worldRevisionId:worldRevisionId || this.runtime.currentWorldRevision?.revision?.id || null});
    return report;
  }
}
