import { describe, expect, it } from 'vitest';
import { SemanticHeuristicPass } from '../../modules/asset/production/compiler/passes/SemanticHeuristicPass.js';

describe('SemanticHeuristicPass', () => {
  it('classifies a vase without granting physical pickup from its name', async () => {
    const result = await new SemanticHeuristicPass().run({
      label:'Red Ceramic Vase', sourceName:'generated_red_ceramic_vase.glb', geometry:{namedNodes:[]}
    });
    expect(result.semantics).toMatchObject({
      type:'vase', tags:expect.arrayContaining(['graspable']),
      actions:['move']
    });
  });
});
