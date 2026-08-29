# AgentScape Design System

The canonical visual specification for both **Studio** and **Observatory** is [`../DESIGN.md`](../DESIGN.md).

All frontend work in `studio/` and `observatory/` should treat that file as the source of truth for:

- color tokens and tonal hierarchy;
- Inter / JetBrains Mono typography;
- 8px spacing rhythm and responsive margins/gutters;
- glassmorphism and tonal elevation;
- rounded component geometry;
- buttons, inputs, cards, chips, badges, and list states.

When implementation constraints conflict with expensive effects (for example large-area backdrop blur beside WebGL), preserve the visual hierarchy and token system while choosing the lower-cost rendering technique.

## Language

- visible product UI copy is Simplified Chinese by default; stable technical identifiers such as API names, backend names, object IDs, file formats, and code symbols may retain their canonical spelling.
