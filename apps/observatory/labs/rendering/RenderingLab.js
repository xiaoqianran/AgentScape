import * as THREE from 'three';
import { SimulationClock } from '../../core/SimulationClock.js';
import { createObservatoryGrid, disposeObservatoryGrid } from '../../visual/ObservatoryGrid.js';
import { createObservatoryRenderSurface } from '../../visual/ObservatoryRenderSurface.js';
import { resizeObservatoryRenderer } from '../../visual/RendererQuality.js';

/** Independent renderer diagnostic fixture. No PhysicsSystem or world mutation. */
export class RenderingLab {
  constructor({viewport,onTelemetry,rendererMode='auto',rendererTiming=false,onRendererFailure=null}) {
    this.viewport=viewport;this.onTelemetry=onTelemetry;this.rendererMode=rendererMode;
    this.rendererTiming=rendererTiming;this.onRendererFailure=onRendererFailure;
    this.clock=new SimulationClock();this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(48,1,.05,200);
    this.camera.position.set(6,4,7);
    this.grid=createObservatoryGrid({size:20});this.scene.add(this.grid);
    this.objects=new THREE.Group();this.scene.add(this.objects);
  }
  async init(){
    Object.assign(this,await createObservatoryRenderSurface({viewport:this.viewport,scene:this.scene,camera:this.camera,
      rendererMode:this.rendererMode,rendererTiming:this.rendererTiming,onRendererFailure:this.onRendererFailure,controlsTarget:[0,1,0]}));
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.viewport);
    this.resize();this.animation=requestAnimationFrame(t=>this.frame(t));return this;
  }
  async load(scenario){
    this.scenario=scenario;this.clock.reset();this.clearObjects();
    const shape=new THREE.SphereGeometry(.65,24,16);
    const material=new THREE.MeshStandardMaterial({color:0x67b7df,roughness:.4,metalness:.18});
    const sphere=new THREE.Mesh(shape,material);sphere.position.y=1;this.objects.add(sphere);
    const box=new THREE.Mesh(new THREE.BoxGeometry(1.25,1.25,1.25),new THREE.MeshStandardMaterial({color:0xe5c890,roughness:.55}));
    box.position.set(2,.7,0);this.objects.add(box);
    this.focusScenario();this.emitTelemetry();
  }
  clearObjects(){
    for(const object of [...this.objects.children]){
      this.objects.remove(object);object.geometry?.dispose?.();object.material?.dispose?.();
    }
  }
  telemetry(){
    const info=this.rendererProbe?.snapshot?.() || {};
    return {scenario:this.scenario,clock:this.clock,checkpointFrame:null,
      inspector:{title:'Rendering Diagnostics',kind:'renderer',values:{backend:info.backend||'—',mode:info.requestedMode||'auto',health:info.health||'—'}},
      assertions:[{label:'Renderer 已创建',pass:!!this.renderer},{label:'测试场景可渲染',pass:!!this.scene&&this.objects.children.length>0}],
      metrics:{backend:info.backend||'—',renderer:info.renderer||'—',"gpu timing":info.gpuTiming??false}};
  }
  emitTelemetry(){if(this.scenario)this.onTelemetry?.(this.telemetry());}
  frame(time){
    if(this.rendererState?.failed)return;
    this.controls.update();this.renderer.render(this.scene,this.camera);this.rendererProbe?.afterRender(time);
    if(!this.lastTelemetryAt||time-this.lastTelemetryAt>500){this.lastTelemetryAt=time;this.emitTelemetry();}
    this.animation=requestAnimationFrame(next=>this.frame(next));
  }
  focusScenario(){this.cameraRig?.moveTo([6,4,7],[.5,.9,0]);}
  setGridVisible(value){this.grid.visible=Boolean(value);}
  toggleRunning(){return false;}step(){}async reset(){return this.load(this.scenario);}
  captureCheckpoint(){return null;}restoreCheckpoint(){return null;}
  resize(){this.renderQuality=resizeObservatoryRenderer({renderer:this.renderer,camera:this.camera,viewport:this.viewport});}
  async dispose(){cancelAnimationFrame(this.animation);this.resizeObserver?.disconnect?.();this.clearObjects();this.controls?.dispose?.();
    disposeObservatoryGrid(this.grid);this.renderer?.dispose?.();this.renderer?.domElement?.remove?.();}
}
