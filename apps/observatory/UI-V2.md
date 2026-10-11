# Observatory UI v2

The Observatory at `/observatory/` uses the same Lab/Scenario runtime and HTML element IDs as before. The v2 presentation prioritizes the viewport with a compact top bar, 240px scenario list, 320px inspector, and a persistent simulation dock.

## Controls

- **Physics / Navigation**: switch the existing Lab via the same `lab-select` change handler.
- **Rendering diagnostics**: expose the Inspector and GPU Probe controls for the current renderer. It does not create a new rendering Lab or switch the active scene.
- **Debug layers**: grouped into Physics, Navigation/Spatial, Interaction/Agent, and Common. Only supported layers are shown per Lab.
- **Layer presets**: `Default` restores Lab-defined defaults; `All on` and `All off` dispatch the same change event as manual layer toggles. They are display-only controls; no physics or navigation state mutation.
- **Simulation**: Run/Pause, Step, +10 frames, Reset, Checkpoint/Replay use the existing handlers.

GPU probes remain experimental. The rendering controls require a compatible renderer and feature support; unavailable probes must remain disabled by the existing capability checks. The quick navigation is hidden at narrower widths while the Lab selector remains accessible.

## Checks

`npm run test:observatory`, `npm run build`, and `npm run check` provide regression gates. Browser interactions and viewport screenshots should be tested separately before declaring visual acceptance.
