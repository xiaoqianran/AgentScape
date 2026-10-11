# Observatory UI v2

The Observatory at `/observatory/` uses the same Lab/Scenario runtime and HTML element IDs as before. The v2 presentation prioritizes the viewport with a compact top bar, 240px scenario list, 320px inspector, and a persistent simulation dock.

## Controls

- **Physics / Navigation**: switch the existing Lab via the same `lab-select` change handler.
- **Rendering diagnostics**: the standalone RenderingLab owns its own test scene and exposes RendererProbe / feature-gated WebGPU diagnostics, independently of Physics Studio (see `IA-V3.md`).
- **Debug layers**: grouped into Physics, Navigation/Spatial, Interaction/Agent, and Common. Only supported layers are shown per Lab.
- **Layer presets**: `Default` restores Lab-defined defaults; `All on` and `All off` dispatch the same change event as manual layer toggles. They are display-only controls; no physics or navigation state mutation.
- **Simulation**: Run/Pause, Step, +10 frames, Reset, Checkpoint/Replay use the existing handlers.

GPU probes remain experimental. The rendering controls require a compatible renderer and feature support; unavailable probes must remain disabled by the existing capability checks. The quick navigation is hidden at narrower widths while the Lab selector remains accessible.

## Checks

`npm run test:observatory`, `npm run build`, and `npm run check` provide regression gates. Browser interactions and viewport screenshots should be tested separately before declaring visual acceptance.

The Inspector uses per-Lab presentation profiles in `ui/inspector/InspectorProfiles.js` and the versioned, read-only `core/DiagnosticsContract.js`. A Lab's production Runtime remains the source of truth. Presentation-only debug layer grouping is in `ui/debugging/DebugLayerGroups.js`.
