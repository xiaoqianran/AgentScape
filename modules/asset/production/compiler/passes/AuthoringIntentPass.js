// Explicit authored intent is configuration, never evidence of runtime success.
export class AuthoringIntentPass {
  async run(context) {
    const intent = context.authoringIntent;
    if (!intent) return context;
    if (!['static', 'movable', 'interactive'].includes(intent.usage)) throw new TypeError('Invalid authoring usage');
    if (intent.usage === 'interactive') return context;
    const movable = intent.usage === 'movable';
    return {
      ...context,
      semantics:{ ...context.semantics, actions:movable ? ['move', 'pickup', 'drop', 'place'] : ['move'] },
      physics:{ ...context.physics, body:movable ? 'dynamic' : 'fixed' }
    };
  }
}
