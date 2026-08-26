import { assertFindingRevision, compileValidationFindings, normalizeFinding } from './Finding.js';

export class RepairEngine {
  constructor(runtime) { this.runtime = runtime; }

  async repair(report, { maxRepairs = 20, worldRevisionId = null } = {}) {
    const currentRevisionId=worldRevisionId || this.runtime.currentWorldRevision?.revision?.id || null;
    const findings=(report?.findings?.length?report.findings:compileValidationFindings(report||{},{worldRevisionId:currentRevisionId})).map((item,index)=>normalizeFinding(item,{index}));
    assertFindingRevision(findings,currentRevisionId);
    const hardFindings=findings.filter((finding)=>finding.severity==='hard');
    const beforeCounts=report?.counts || {hard:hardFindings.length,advisory:findings.filter((finding)=>finding.severity==='advisory').length};
    const before = this.runtime.snapshot();
    const applied = [];
    const ignored=[];
    for (const finding of hardFindings.slice(0, maxRepairs)) {
      if (!finding.repair.eligible) { ignored.push({findingId:finding.id,code:finding.code,reason:'NOT_REPAIRABLE'}); continue; }
      const objectId=finding.affectedObjects[0];
      if (finding.repair.strategy === 'lift_to_ground') {
        const record = this.runtime.store.get(objectId);
        const bounds = this.runtime.spatial.getBounds(objectId);
        const p = record.object.position.toArray();
        p[1] += -bounds.min[1] + 0.01;
        this.runtime.interactions.move(objectId, p);
        applied.push({ findingId:finding.id,code: finding.code, object: objectId, action: 'lift_to_ground' });
        continue;
      }
      if (finding.repair.strategy === 'separate_overlap') {
        const record = this.runtime.store.get(objectId);
        const p = record.object.position.toArray();
        let solved = false;
        for (const [dx, dz] of [[0.25,0],[-0.25,0],[0,0.25],[0,-0.25],[0.5,0],[0,0.5]]) {
          this.runtime.interactions.move(objectId, [p[0]+dx, p[1], p[2]+dz]);
          if (!this.runtime.spatial.isColliding(objectId, { margin: 0.015 }).length) { solved = true; break; }
        }
        if (solved) applied.push({ findingId:finding.id,code: finding.code, object: objectId, action: 'separate_overlap' });
        else { this.runtime.interactions.move(objectId, p); ignored.push({findingId:finding.id,code:finding.code,reason:'REPAIR_SEARCH_EXHAUSTED'}); }
        continue;
      }
      ignored.push({findingId:finding.id,code:finding.code,reason:'STRATEGY_UNSUPPORTED'});
    }
    this.runtime.sceneGraph.changed();
    const after = this.runtime.validator.run({worldRevisionId:currentRevisionId});
    if (after.counts.hard > beforeCounts.hard) {
      await this.runtime.restore(before);
      return { status:'repair-failed',accepted: false, reason: 'hard_findings_increased', before: beforeCounts, after: after.counts, applied: [], ignored, findingsConsumed:hardFindings.map((finding)=>finding.id) };
    }
    return { status:'repair-applied',accepted: true, before: beforeCounts, after: after.counts, applied, ignored, findingsConsumed:hardFindings.map((finding)=>finding.id) };
  }
}
