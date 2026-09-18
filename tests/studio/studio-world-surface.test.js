import { describe, expect, it, vi } from 'vitest';
import { StudioWorldSurface } from '../../apps/studio/ui/StudioWorldSurface.js';

function handle(name) {
  return { name, dispose:vi.fn() };
}

function harness({
  mountInteraction = vi.fn(() => handle('interaction')),
  createHumanView = vi.fn(() => ({
    ...handle('human'),
    resetForEnvironment:vi.fn(),
    update:vi.fn(),
    viewPose:vi.fn(() => null)
  })),
  mountContext = vi.fn(() => handle('context'))
} = {}) {
  const viewport = {};
  const world = {
    environment:{id:'monument-hall'},
    rendering:{
      viewport:()=>viewport,
      viewPose:vi.fn(() => ({position:[1,2,3],rotation:[0,0,0,1]}))
    },
    commands:{setHumanViewPose:vi.fn()}
  };
  const ui = {
    viewport:{},
    setWorldPresentation:vi.fn()
  };
  const tools = { call:vi.fn() };
  const editor = {
    selectedId:null,
    transform:{axis:null},
    select:vi.fn((id) => { editor.selectedId=id; }),
    setSelectionOnRelease:vi.fn(),
    dispose:vi.fn()
  };
  const environmentMaterializer = {
    hostFor:vi.fn((environment) => environment?.id === 'woodland-workshop' ? {id:'editor-host'} : null)
  };
  const onPresentationChange = vi.fn();
  const onSurfaceError = vi.fn();
  const createEditor = vi.fn(() => editor);
  const surface = new StudioWorldSurface({
    world,
    ui,
    tools,
    environmentMaterializer,
    onPresentationChange,
    onSurfaceError,
    createEditor,
    mountInteraction,
    createHumanView,
    mountContext
  });
  return {
    surface,world,ui,tools,editor,environmentMaterializer,onPresentationChange,onSurfaceError,
    createEditor,mountInteraction,createHumanView,mountContext
  };
}

describe('StudioWorldSurface', () => {
  it('owns world presentation and editor selection identity updates', () => {
    const h=harness();
    const identity={id:'monument-hall',title:'纪念大厅',worldFirst:false};

    expect(h.surface.setIdentity(identity)).toBe(identity);
    expect(h.onPresentationChange).toHaveBeenCalledWith(identity);
    expect(h.ui.setWorldPresentation).toHaveBeenCalledWith(identity);
    expect(h.editor.select).toHaveBeenCalledWith(null);
  });

  it('binds world-first UI and reuses HumanView/WorldContext across world-first environments', () => {
    const firstInteraction=handle('first-interaction');
    const secondInteraction=handle('second-interaction');
    const human={
      ...handle('human'),
      resetForEnvironment:vi.fn(),
      update:vi.fn(),
      viewPose:vi.fn(() => null)
    };
    const context=handle('context');
    const h=harness({
      mountInteraction:vi.fn()
        .mockReturnValueOnce(firstInteraction)
        .mockReturnValueOnce(secondInteraction),
      createHumanView:vi.fn(() => human),
      mountContext:vi.fn(() => context)
    });

    h.world.environment={id:'woodland-workshop'};
    const first={id:'woodland-workshop',worldFirst:true};
    h.surface.setIdentity(first);
    expect(h.surface.bindEnvironment({identity:first})).toMatchObject({
      worldFirst:true,interaction:true,humanView:true,context:true
    });
    expect(h.environmentMaterializer.hostFor).toHaveBeenCalledWith(h.world.environment);
    expect(h.mountInteraction).toHaveBeenCalledWith(expect.objectContaining({host:{id:'editor-host'}}));
    expect(h.editor.setSelectionOnRelease).toHaveBeenLastCalledWith(true);
    expect(human.resetForEnvironment).toHaveBeenCalledTimes(1);

    h.world.environment={id:'magic-cabin'};
    const second={id:'magic-cabin',worldFirst:true};
    h.surface.setIdentity(second);
    h.surface.bindEnvironment({identity:second});

    expect(h.createHumanView).toHaveBeenCalledTimes(1);
    expect(h.mountContext).toHaveBeenCalledTimes(1);
    expect(human.resetForEnvironment).toHaveBeenCalledTimes(2);
    expect(firstInteraction.dispose).toHaveBeenCalledOnce();
    expect(human.dispose).not.toHaveBeenCalled();
    expect(context.dispose).not.toHaveBeenCalled();
  });

  it('tears down world-first-only UI when returning to a standard world', () => {
    const human={
      ...handle('human'),
      resetForEnvironment:vi.fn(),
      update:vi.fn(),
      viewPose:vi.fn(() => null)
    };
    const context=handle('context');
    const firstInteraction=handle('first');
    const secondInteraction=handle('second');
    const h=harness({
      mountInteraction:vi.fn().mockReturnValueOnce(firstInteraction).mockReturnValueOnce(secondInteraction),
      createHumanView:vi.fn(() => human),
      mountContext:vi.fn(() => context)
    });

    h.surface.bindEnvironment({identity:{id:'woodland-workshop',worldFirst:true}});
    h.surface.bindEnvironment({identity:{id:'monument-hall',worldFirst:false}});

    expect(h.editor.setSelectionOnRelease).toHaveBeenLastCalledWith(false);
    expect(firstInteraction.dispose).toHaveBeenCalledOnce();
    expect(human.dispose).toHaveBeenCalledOnce();
    expect(context.dispose).toHaveBeenCalledOnce();
    expect(h.surface.humanView).toBeNull();
    expect(h.surface.context).toBeNull();
  });

  it('keeps the previous surface alive when candidate binding fails', () => {
    const previousInteraction=handle('previous');
    const candidateInteraction=handle('candidate');
    const candidateHuman={
      ...handle('candidate-human'),
      resetForEnvironment:vi.fn(() => { throw new Error('human reset failed'); }),
      update:vi.fn(),
      viewPose:vi.fn(() => null)
    };
    const candidateContext=handle('candidate-context');
    const mountInteraction=vi.fn()
      .mockReturnValueOnce(previousInteraction)
      .mockReturnValueOnce(candidateInteraction);
    const h=harness({
      mountInteraction,
      createHumanView:vi.fn(() => candidateHuman),
      mountContext:vi.fn(() => candidateContext)
    });

    h.surface.bindEnvironment({identity:{id:'monument-hall',worldFirst:false}});
    expect(() => h.surface.bindEnvironment({identity:{id:'woodland-workshop',worldFirst:true}}))
      .toThrow('human reset failed');

    expect(previousInteraction.dispose).not.toHaveBeenCalled();
    expect(candidateInteraction.dispose).toHaveBeenCalledOnce();
    expect(candidateHuman.dispose).toHaveBeenCalledOnce();
    expect(candidateContext.dispose).toHaveBeenCalledOnce();
    expect(h.surface.interaction).toBe(previousInteraction);
    expect(h.surface.humanView).toBeNull();
    expect(h.surface.context).toBeNull();
    expect(h.editor.setSelectionOnRelease).toHaveBeenLastCalledWith(false);
  });

  it('synchronizes HumanView input and owns final disposal', () => {
    const interaction=handle('interaction');
    const context=handle('context');
    const pose={position:[4,5,6],rotation:[0,0.5,0,0.866]};
    const human={
      ...handle('human'),
      resetForEnvironment:vi.fn(),
      update:vi.fn(),
      viewPose:vi.fn(() => pose)
    };
    const h=harness({
      mountInteraction:vi.fn(() => interaction),
      createHumanView:vi.fn(() => human),
      mountContext:vi.fn(() => context)
    });

    h.surface.bindEnvironment({identity:{id:'woodland-workshop',worldFirst:true}});
    expect(h.surface.syncInput(1234)).toEqual(pose);
    expect(human.update).toHaveBeenCalledWith(1234);
    expect(h.world.commands.setHumanViewPose).toHaveBeenCalledWith(pose);

    h.surface.dispose();
    h.surface.dispose();
    expect(interaction.dispose).toHaveBeenCalledOnce();
    expect(context.dispose).toHaveBeenCalledOnce();
    expect(human.dispose).toHaveBeenCalledOnce();
    expect(h.editor.dispose).toHaveBeenCalledOnce();
    expect(() => h.surface.syncInput(1400)).toThrow('StudioWorldSurface has been disposed');
  });
});
