import { EditorController } from '../editor/EditorController.js';
import { HumanViewController } from './HumanViewController.js';
import { mountWorldContext } from './WorldContext.js';
import { mountWorldInteraction } from './WorldInteraction.js';

const disposeQuietly = (value, onError) => {
  if (!value?.dispose) return;
  try { value.dispose(); }
  catch (error) { onError?.(error); }
};

// Owns Studio UI that must follow the active Runtime Environment.
// WorldSession remains the transaction owner; this object only prepares/swaps UI surfaces.
export class StudioWorldSurface {
  constructor({
    world,
    ui,
    tools,
    environmentMaterializer = null,
    onPresentationChange = () => {},
    onSurfaceError = () => {},
    createEditor = (runtime) => new EditorController(runtime),
    mountInteraction = mountWorldInteraction,
    createHumanView = (options) => new HumanViewController(options),
    mountContext = mountWorldContext
  } = {}) {
    if (!world?.rendering?.viewport?.()) throw new TypeError('StudioWorldSurface requires an initialized WorldRuntime');
    if (!ui?.viewport) throw new TypeError('StudioWorldSurface requires Studio UI');
    if (!tools?.call) throw new TypeError('StudioWorldSurface requires AgentTools');
    if (typeof createEditor !== 'function') throw new TypeError('StudioWorldSurface requires createEditor');

    Object.assign(this,{
      world,ui,tools,environmentMaterializer,onPresentationChange,onSurfaceError,
      mountInteraction,createHumanView,mountContext
    });
    this.editor=createEditor(world);
    if (!this.editor?.select || !this.editor?.setSelectionOnRelease || !this.editor?.dispose) {
      throw new TypeError('StudioWorldSurface editor contract is incomplete');
    }

    this.identity=null;
    this.boundWorldFirst=false;
    this.interaction=null;
    this.humanView=null;
    this.context=null;
    this.disposed=false;
  }

  setIdentity(identity) {
    this.#assertReady();
    const next=identity || null;
    this.onPresentationChange(next);
    this.ui.setWorldPresentation?.(next);
    this.editor.select(null);
    this.identity=next;
    return next;
  }

  bindEnvironment({ identity = this.identity } = {}) {
    this.#assertReady();
    const worldFirst=Boolean(identity?.worldFirst);
    const previousInteraction=this.interaction;
    const previousHumanView=this.humanView;
    const previousContext=this.context;
    const previousWorldFirst=this.boundWorldFirst;

    let nextInteraction=null;
    let nextHumanView=worldFirst ? previousHumanView : null;
    let nextContext=worldFirst ? previousContext : null;
    let createdHumanView=false;
    let createdContext=false;

    try {
      nextInteraction=this.mountInteraction({
        world:this.world,
        ui:this.ui,
        editor:this.editor,
        host:this.environmentMaterializer?.hostFor?.(this.world.environment) || null
      });

      if (worldFirst && !nextHumanView) {
        nextHumanView=this.createHumanView({
          world:this.world,
          ui:this.ui,
          blockLook:()=>Boolean(this.editor?.transform?.axis)
        });
        createdHumanView=true;
      }

      if (worldFirst && !nextContext) {
        nextContext=this.mountContext({
          world:this.world,
          editor:this.editor,
          tools:this.tools,
          ui:this.ui
        });
        createdContext=true;
      }

      this.editor.setSelectionOnRelease(worldFirst);
      nextHumanView?.resetForEnvironment?.();
      this.editor.select(null);
    } catch (error) {
      disposeQuietly(nextInteraction,this.onSurfaceError);
      if (createdHumanView) disposeQuietly(nextHumanView,this.onSurfaceError);
      if (createdContext) disposeQuietly(nextContext,this.onSurfaceError);
      try { this.editor.setSelectionOnRelease(previousWorldFirst); }
      catch (restoreError) { this.onSurfaceError?.(restoreError); }
      throw error;
    }

    this.interaction=nextInteraction;
    this.humanView=nextHumanView;
    this.context=nextContext;
    this.boundWorldFirst=worldFirst;

    disposeQuietly(previousInteraction,this.onSurfaceError);
    if (previousHumanView && previousHumanView!==nextHumanView) disposeQuietly(previousHumanView,this.onSurfaceError);
    if (previousContext && previousContext!==nextContext) disposeQuietly(previousContext,this.onSurfaceError);

    return {
      identity,
      worldFirst,
      interaction:Boolean(nextInteraction),
      humanView:Boolean(nextHumanView),
      context:Boolean(nextContext)
    };
  }

  syncInput(frameTime) {
    this.#assertReady();
    this.humanView?.update?.(frameTime);
    const pose=this.humanView?.viewPose?.() || this.world.rendering?.viewPose?.() || null;
    this.world.commands?.setHumanViewPose?.(pose);
    return pose;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed=true;
    disposeQuietly(this.interaction,this.onSurfaceError);
    disposeQuietly(this.context,this.onSurfaceError);
    disposeQuietly(this.humanView,this.onSurfaceError);
    disposeQuietly(this.editor,this.onSurfaceError);
    this.interaction=null;
    this.context=null;
    this.humanView=null;
  }

  #assertReady() {
    if (!this.disposed) return;
    const error=new Error('StudioWorldSurface has been disposed');
    error.code='STUDIO_WORLD_SURFACE_DISPOSED';
    throw error;
  }
}
