const revoluteWords = ['door','lid','hinge','flap','valve','wheel','page','leaf','cover','knob','dial','门','盖','阀','轮','页','旋钮'];
const prismaticWords = ['drawer','slider','slide','抽屉','滑轨'];
const tokenize = name => String(name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
const includesWord = (name, word) => /^[a-z]+$/.test(word)
  ? (name.match(/[a-z]+/g) || []).includes(word) : name.includes(word);

function suggestActions(name, jointType) {
  if (jointType === 'prismatic') return ['slide'];
  if (['page','leaf','页'].some(word => includesWord(name, word))) return ['turnPage'];
  if (['lid','cover','door','hinge','flap','门','盖'].some(word => includesWord(name, word))) return ['open','close'];
  if (['knob','dial','旋钮'].some(word => includesWord(name, word))) return ['adjust'];
  return ['rotateJoint'];
}

/** Name/URDF hints may propose a joint, but never grant an executable action. */
export class ArticulationCandidatePass {
  async run(context) {
    const candidates = [];
    const proposals = new Map((context.partProposal?.parts || [])
      .filter(part => part.node && ['revolute','prismatic'].includes(part.joint?.type))
      .map(part => [part.node, part]));
    for (const node of context.inspection.nodes) {
      const name = tokenize(node.name);
      if (!name) continue;
      const provider = proposals.get(node.name);
      const revolute = revoluteWords.some(word => includesWord(name, word));
      const prismatic = prismaticWords.some(word => includesWord(name, word));
      const jointType = provider?.joint.type || (revolute ? 'revolute' : prismatic ? 'prismatic' : null);
      if (!jointType) continue;
      candidates.push({
        node:node.name, jointType, ...(provider ? {partId:provider.id} : {}),
        source:provider ? 'joint-metadata' : 'node-name-heuristic',
        confidence:provider ? Math.min(1, Math.max(0, Number(provider.confidence) || 0.75))
          : name.includes('hinge') ? .75 : jointType === 'prismatic' ? .55 : .5,
        suggestedActions:suggestActions(name, jointType),
        executable:false, physicsVerified:false, requiresReview:true
      });
    }
    const partProposal = context.partProposal || (context.interactionProposal && candidates.length ? {
      version:1,source:'node-name-heuristic',parts:candidates.map((candidate,index)=>({
        id:'part_' + (index+1),node:candidate.node,joint:{type:candidate.jointType},
        confidence:candidate.confidence,requiresReview:true
      }))
    } : null);
    return { ...context, ...(partProposal ? {partProposal} : {}),
      articulation: { candidates, source:'structural-candidate-analysis' } };
  }
}
