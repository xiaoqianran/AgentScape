const revoluteWords = ['door','lid','hinge','flap','门','盖'];
const prismaticWords = ['drawer','slider','slide','抽屉'];

export class ArticulationCandidatePass {
  async run(context) {
    const candidates = [];
    for (const node of context.inspection.nodes) {
      const name = (node.name || '').toLowerCase();
      if (!name) continue;
      if (revoluteWords.some((word) => name.includes(word))) candidates.push({ node: node.name, jointType: 'revolute', confidence: name.includes('hinge') ? 0.75 : 0.5, requiresReview: true });
      else if (prismaticWords.some((word) => name.includes(word))) candidates.push({ node: node.name, jointType: 'prismatic', confidence: 0.55, requiresReview: true });
    }
    return { ...context, articulation: { candidates, source: 'node-name-heuristic' } };
  }
}
