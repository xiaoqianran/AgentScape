import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  eventsDispose:vi.fn(), sceneDispose:vi.fn(), authoringDispose:vi.fn(), debugDispose:vi.fn(),
  bindScene:vi.fn(), bindDebug:vi.fn(), bindEvents:vi.fn(), bindAuthoring:vi.fn()
}));
vi.mock('../../apps/studio/ui/bindRuntimeEvents.js', () => ({ bindRuntimeEvents:state.bindEvents }));
vi.mock('../../apps/studio/ui/bindSceneControls.js', () => ({ bindSceneControls:state.bindScene }));
vi.mock('../../apps/studio/debug/bindDebugLayers.js', () => ({ bindDebugLayers:state.bindDebug }));
vi.mock('../../apps/studio/authoring/bindAuthoringWorldControls.js', () => ({ bindAuthoringWorldControls:state.bindAuthoring }));
import { activateStudioWorld } from '../../apps/studio/bootstrap/activateStudioWorld.js';

function setup({ failOpen = false, failInspector = false } = {}) {
  const ui = { attachSceneControls:vi.fn(), attachAuthoring:vi.fn(), setRuntimeStatus:vi.fn() };
  const inspector = { render:vi.fn(() => { if (failInspector) throw new Error('inspector failed'); }) };
  const world = {
    history:{ clear:vi.fn() }, queries:{ listObjects:vi.fn(() => []) },
    rendering:{ diagnostics:vi.fn(() => ({ backend:'webgl2' })) }
  };
  const lifecycle = {
    autosave:{}, sceneStore:{}, worldSession:{current:{id:'test'}},
    worldOpener:{open:vi.fn(async () => {if (failOpen) throw new Error('world open failed');})}
  };
  const worldSurface = { bindEnvironment:vi.fn() };
  const taskPanel = {log:vi.fn(),setState:vi.fn()};
  return {
    ui,world,lifecycle,worldSurface,inspector,taskPanel,
    args:{ui,world,lifecycle,worldSurface,inspector,taskPanel,authoringWorlds:{},editor:{},scene:{}}
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.bindEvents.mockImplementation(() => ({dispose:state.eventsDispose}));
  state.bindScene.mockImplementation(() => ({dispose:state.sceneDispose}));
  state.bindAuthoring.mockImplementation(() => ({dispose:state.authoringDispose}));
  state.bindDebug.mockImplementation(() => ({dispose:state.debugDispose}));
});

describe('activateStudioWorld partial initialization', () => {
  it('releases runtime events when world opening fails', async () => {
    const h = setup({failOpen:true});
    await expect(activateStudioWorld(h.args)).rejects.toThrow('world open failed');
    expect(state.eventsDispose).toHaveBeenCalledOnce();
    expect(state.bindScene).not.toHaveBeenCalled();
  });

  it('unwinds mounted controls and events when inspector initialization fails', async () => {
    const h = setup({failInspector:true});
    await expect(activateStudioWorld(h.args)).rejects.toThrow('inspector failed');
    expect(state.eventsDispose).toHaveBeenCalledOnce();
    expect(state.sceneDispose).toHaveBeenCalledOnce();
    expect(state.authoringDispose).toHaveBeenCalledOnce();
    expect(state.debugDispose).toHaveBeenCalledOnce();
    expect(h.ui.attachSceneControls).toHaveBeenLastCalledWith(null);
    expect(h.ui.attachAuthoring).toHaveBeenLastCalledWith(null);
    expect(h.ui.setRuntimeStatus).not.toHaveBeenCalled();
  });

  it('releases event subscriptions when scene controls binding throws', async () => {
    state.bindScene.mockImplementation(() => {throw new Error('scene controls failed');});
    const h = setup();
    await expect(activateStudioWorld(h.args)).rejects.toThrow('scene controls failed');
    expect(state.eventsDispose).toHaveBeenCalledOnce();
    expect(state.authoringDispose).not.toHaveBeenCalled();
  });

  it('releases scene controls even if UI attachment throws', async () => {
    const h = setup();
    h.ui.attachSceneControls.mockImplementation(value => {
      if (value) throw new Error('UI attach failed');
    });
    await expect(activateStudioWorld(h.args)).rejects.toThrow('UI attach failed');
    expect(state.eventsDispose).toHaveBeenCalledOnce();
    expect(state.sceneDispose).toHaveBeenCalledOnce();
    expect(h.ui.attachSceneControls).toHaveBeenLastCalledWith(null);
  });

  it('releases earlier bindings when debug overlay creation throws', async () => {
    state.bindDebug.mockImplementation(() => {throw new Error('debug failed');});
    const h = setup();
    await expect(activateStudioWorld(h.args)).rejects.toThrow('debug failed');
    expect(state.eventsDispose).toHaveBeenCalledOnce();
    expect(state.sceneDispose).toHaveBeenCalledOnce();
    expect(state.authoringDispose).toHaveBeenCalledOnce();
    expect(h.ui.attachSceneControls).toHaveBeenLastCalledWith(null);
    expect(h.ui.attachAuthoring).toHaveBeenLastCalledWith(null);
  });

  it('releases all bindings just once after successful activation', async () => {
    const h = setup();
    const activation = await activateStudioWorld(h.args);
    expect(h.ui.setRuntimeStatus).toHaveBeenCalledWith('ready','就绪 · WebGL2');
    activation.dispose(); activation.dispose();
    for (const dispose of [state.eventsDispose,state.sceneDispose,state.authoringDispose,state.debugDispose]) {
      expect(dispose).toHaveBeenCalledOnce();
    }
    expect(h.ui.attachSceneControls).toHaveBeenLastCalledWith(null);
    expect(h.ui.attachAuthoring).toHaveBeenLastCalledWith(null);
  });
});
