const RULES = [
  { type: 'cabinet', words: ['cabinet','cupboard','wardrobe','柜','橱'], tags: ['storage','furniture'] },
  { type: 'drawer', words: ['drawer','抽屉'], tags: ['storage'] },
  { type: 'door', words: ['door','门'], tags: ['door'] },
  { type: 'cup', words: ['cup','mug','杯'], tags: ['drinkware','graspable'], actions: ['move','pickup','drop','place'] },
  { type: 'apple', words: ['apple','苹果'], tags: ['fruit','food','round','graspable'], actions: ['move','pickup','drop','place'] },
  { type: 'vase', words: ['vase','flower vase','花瓶'], tags: ['decor','container','graspable'], actions: ['move','pickup','drop','place'] },
  { type: 'chair', words: ['chair','seat','椅'], tags: ['furniture','seat'] },
  { type: 'table', words: ['table','desk','桌'], tags: ['furniture','surface'] }
];

export class SemanticHeuristicPass {
  async run(context) {
    const text = [context.label, context.sourceName, ...context.geometry.namedNodes].filter(Boolean).join(' ').toLowerCase();
    const hits = RULES
      .map((rule) => ({ rule, score: rule.words.filter((word) => text.includes(word)).length }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
    const best = hits[0];
    const base = best?.rule || { type: 'object', tags: [] };
    return {
      ...context,
      semantics: {
        type: base.type,
        label: context.label || context.sourceName.replace(/\.(glb|gltf)$/i, ''),
        tags: base.tags,
        actions: base.actions || ['move'],
        confidence: best ? Math.min(0.85, 0.45 + best.score * 0.2) : 0.2,
        source: 'heuristic'
      }
    };
  }
}
