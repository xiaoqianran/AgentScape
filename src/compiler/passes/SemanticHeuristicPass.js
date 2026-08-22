const RULES = [
  { type: 'cabinet', words: ['cabinet','cupboard','wardrobe','柜','橱'], actions: ['move','open','close'], tags: ['storage','furniture'] },
  { type: 'drawer', words: ['drawer','抽屉'], actions: ['move','open','close'], tags: ['storage'] },
  { type: 'door', words: ['door','门'], actions: ['move','open','close'], tags: ['door'] },
  { type: 'cup', words: ['cup','mug','杯'], actions: ['move','pickup','drop','place'], tags: ['drinkware'] },
  { type: 'chair', words: ['chair','seat','椅'], actions: ['move'], tags: ['furniture','seat'] },
  { type: 'table', words: ['table','desk','桌'], actions: ['move'], tags: ['furniture','surface'] }
];

export class SemanticHeuristicPass {
  async run(context) {
    const text = [context.sourceName, ...context.geometry.namedNodes].join(' ').toLowerCase();
    const hits = RULES.map((rule) => ({ rule, score: rule.words.filter((word) => text.includes(word)).length })).filter((x) => x.score > 0).sort((a,b) => b.score-a.score);
    const best = hits[0];
    return {
      ...context,
      semantics: best ? {
        type: best.rule.type,
        label: context.label || context.sourceName.replace(/\.(glb|gltf)$/i, ''),
        tags: best.rule.tags,
        actions: best.rule.actions,
        confidence: Math.min(0.85, 0.45 + best.score * 0.2),
        source: 'heuristic'
      } : {
        type: 'object', label: context.label || context.sourceName.replace(/\.(glb|gltf)$/i, ''), tags: [], actions: ['move'], confidence: 0.2, source: 'heuristic'
      }
    };
  }
}
