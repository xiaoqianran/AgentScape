import { center } from '@gltf-transform/functions';

export class NormalizeTransformPass {
  async run(context) {
    if (context.authoringIntent || !context.structure.policy.centerBelow) return { ...context, normalization: { applied: [], preservedOrigin:Boolean(context.authoringIntent) } };
    await context.document.transform(center({ pivot: 'below' }));
    return {
      ...context,
      normalization: {
        applied: ['center-below'],
        preservedHierarchy: true,
        axisRotation: 'unchanged'
      }
    };
  }
}
