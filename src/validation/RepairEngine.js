export class RepairEngine {
  constructor(runtime) { this.runtime = runtime; }

  async repair(report, { maxRepairs = 20 } = {}) {
    const before = this.runtime.snapshot();
    const applied = [];
    for (const finding of report.hard.slice(0, maxRepairs)) {
      if (finding.code === 'G_BELOW_GROUND') {
        const record = this.runtime.store.get(finding.object);
        const bounds = this.runtime.spatial.getBounds(finding.object);
        const p = record.object.position.toArray();
        p[1] += -bounds.min[1] + 0.01;
        this.runtime.interactions.move(finding.object, p);
        applied.push({ code: finding.code, object: finding.object, action: 'lift_to_ground' });
      }
      if (finding.code === 'P_OVERLAP') {
        const record = this.runtime.store.get(finding.object);
        const p = record.object.position.toArray();
        let solved = false;
        for (const [dx, dz] of [[0.25,0],[-0.25,0],[0,0.25],[0,-0.25],[0.5,0],[0,0.5]]) {
          this.runtime.interactions.move(finding.object, [p[0]+dx, p[1], p[2]+dz]);
          if (!this.runtime.spatial.isColliding(finding.object, { margin: 0.015 }).length) { solved = true; break; }
        }
        if (solved) applied.push({ code: finding.code, object: finding.object, action: 'separate_overlap' });
        else this.runtime.interactions.move(finding.object, p);
      }
    }
    this.runtime.sceneGraph.update();
    const after = this.runtime.validator.run();
    if (after.counts.hard > report.counts.hard) {
      await this.runtime.restore(before);
      return { accepted: false, reason: 'hard_findings_increased', before: report.counts, after: after.counts, applied: [] };
    }
    return { accepted: true, before: report.counts, after: after.counts, applied };
  }
}
