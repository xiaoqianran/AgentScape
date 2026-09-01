# Observatory

Observatory keeps its original shell, viewport, telemetry, and lab navigation. Two resource-oriented labs are now the primary entries:

1. list and preview the complete `AssetCatalog`, and compile uploaded GLB files through the production `AssetCompiler` before registration;
2. accept Gaussian Splat PLY or SPZ files, transcode PLY to the Runtime SPZ format, and preview the result through the production SPZ loader.

The former Physics, Spatial, Navigation, Interaction, Generation, Agent, and Agent Trace labs remain accessible in the same Lab selector and retain regression coverage, but are labeled Deprecated as product-facing modules.
