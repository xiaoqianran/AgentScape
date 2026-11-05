const revoluteWords = ['door','lid','hinge','flap','valve','wheel','门','盖','阀','轮'];
const prismaticWords = ['drawer','slider','slide','抽屉'];

export class ArticulationCandidatePass {
  async run(context) {
    const candidates = [];
    for (const node of context.inspection.nodes) {
      const name = (node.name || '').replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
      if (!name) continue;
      const tokens=name.match(/[a-z]+/g) || [];
      const matches=word=>/^[a-z]+$/.test(word) ? tokens.includes(word) : name.includes(word);
      if (revoluteWords.some(matches)) candidates.push({ node: node.name, jointType: 'revolute', confidence: name.includes('hinge') ? 0.75 : 0.5, requiresReview: true });
      else if (prismaticWords.some(matches)) candidates.push({ node: node.name, jointType: 'prismatic', confidence: 0.55, requiresReview: true });
    }
    const partProposal = context.partProposal || (context.interactionProposal && candidates.length ? {
      version:1,source:'node-name-heuristic',parts:candidates.map((candidate,index)=>({
        id:`part_${index+1}`,node:candidate.node,joint:{type:candidate.jointType},confidence:candidate.confidence,requiresReview:true
      }))
    } : null);
    return { ...context, ...(partProposal ? {partProposal} : {}), articulation: { candidates, source: 'node-name-heuristic' } };
  }
}
