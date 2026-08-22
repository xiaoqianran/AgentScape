export class WorldValidator {
  constructor(runtime) { this.runtime = runtime; }

  run() {
    this.runtime.sceneGraph.update();
    const hard = [];
    const advisory = [];
    const objects = this.runtime.listObjects();

    for (const object of objects) {
      const bounds = this.runtime.spatial.getBounds(object.id);
      if (bounds.min[1] < -0.08) hard.push({ code: 'G_BELOW_GROUND', object: object.id, message: 'Object penetrates below ground', measure: bounds.min[1] });

      const collisions = this.runtime.spatial.isColliding(object.id, { margin: 0.015 });
      for (const other of collisions) {
        if (object.id < other) hard.push({ code: 'P_OVERLAP', object: object.id, other, message: 'Object bounding volumes overlap' });
      }

      if (bounds.min[1] > 0.12) {
        const relations = this.runtime.sceneGraph.list({ subject: object.id });
        const supported = relations.some((r) => r.predicate === 'ON' || r.predicate === 'INSIDE');
        if (!supported && this.runtime.interactions.heldId !== object.id) advisory.push({ code: 'G_FLOATING', object: object.id, message: 'Object appears unsupported', measure: bounds.min[1] });
      }
    }

    for (const edge of this.runtime.sceneGraph.list({ predicate: 'ON' })) {
      const support = this.runtime.sceneGraph.list({ subject: edge.object, predicate: 'SUPPORTS', object: edge.subject });
      if (!support.length) hard.push({ code: 'R_ASYMMETRIC', object: edge.subject, other: edge.object, message: 'ON relation missing inverse SUPPORTS relation' });
    }

    return {
      schema: 1,
      ok: hard.length === 0,
      counts: { hard: hard.length, advisory: advisory.length },
      hard,
      advisory,
      coverage: { objects: objects.length, relations: this.runtime.sceneGraph.list().length }
    };
  }
}
