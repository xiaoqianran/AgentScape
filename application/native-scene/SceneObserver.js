import { createInspectionCamera, frameNativeView, inspectNativeScene, resolveNode } from './NativeSceneInspection.js';
import { sampleNativeVisibility, withNativeIsolation } from './NativeSceneReview.js';
import { inspectNativeSceneBatch, searchNativeScene, suggestNativeViews } from './NativeSceneQuery.js';

import { isUsableVisualCaptureSize } from './VisualCapturePolicy.js';

const fail=code=>Object.assign(new Error(code),{code});

/** Read and capture a host-owned Three.js scene without creating a Runtime or advancing time. */
export function createSceneObserver(native,{renderCurrent}={}){
  if(!native?.scene?.isScene)throw fail('NATIVE_INSPECT_UNAVAILABLE');
  const redraw=renderCurrent??(()=>native.renderer.render(native.scene,native.camera));
  const aspect=()=>{
    const canvas=native.renderer?.domElement;
    return canvas?.width&&canvas?.height?canvas.width/canvas.height:native.camera?.aspect||1;
  };
  function inspect({nodePath='',objectUuid,visibility=false,view,...options}={}){
    const resolvedView=view&&Object.hasOwn(view,'nodePath')?frameNativeView(native,view,aspect()):view;
    const observedNative=resolvedView?{...native,camera:createInspectionCamera(native.camera,resolvedView,aspect())}:native;
    const evidence=inspectNativeScene(observedNative,{...options,nodePath,objectUuid});
    return {status:'inspected',...evidence,...(resolvedView?{view:resolvedView}:{}),
      ...(visibility?{visibility:sampleNativeVisibility(observedNative,{nodePath,objectUuid,measured:evidence})}:{})};
  }
  function capture({maxWidth=768,maxHeight=432,view,isolateNodePath,isolateObjectUuid}={}){
    if (!Number.isSafeInteger(maxWidth) || maxWidth < 128 || maxWidth > 1024 ||
        !Number.isSafeInteger(maxHeight) || maxHeight < 128 || maxHeight > 1024)
      throw fail('VISUAL_CAPTURE_DIMENSIONS_INVALID');
    const renderer=native.renderer,canvas=renderer?.domElement;
    if (!canvas || typeof document==='undefined')throw fail('VISUAL_CANVAS_UNAVAILABLE');
    // A newly mounted or hidden project may have only a 1px backing buffer.
    // Such a frame is not usable visual evidence, even after a synchronous redraw.
    if (!isUsableVisualCaptureSize(canvas.width,canvas.height))throw fail('VISUAL_CANVAS_NOT_READY');
    const aspect=canvas.width/canvas.height;
    if(isolateObjectUuid!==undefined&&isolateNodePath===undefined)throw fail('NATIVE_INSPECT_PATH_INVALID');
    const isolationUuid=isolateObjectUuid??(view?.nodePath===isolateNodePath?view?.objectUuid:undefined);
    if(isolateNodePath!==undefined)resolveNode(native.scene,isolateNodePath,isolationUuid);
    const requestedView=view??(isolateNodePath!==undefined?{nodePath:isolateNodePath,objectUuid:isolationUuid}:null);
    const resolvedView=requestedView&&Object.hasOwn(requestedView,'nodePath')?frameNativeView(native,requestedView,aspect):requestedView;
    const camera=resolvedView?createInspectionCamera(native.camera,resolvedView,aspect):null;
    let previousTarget,previousFace,previousLevel,restore=false,isolation=null,shadowAutoUpdate,shadowNeedsUpdate;
    try {
      // Redraw without stepping. Detached views use direct WebGL rendering.
      if(camera){
        if(!renderer.isWebGLRenderer||typeof renderer.getRenderTarget!=='function')throw fail('VISUAL_VIEW_UNSUPPORTED');
        previousTarget=renderer.getRenderTarget();previousFace=renderer.getActiveCubeFace();previousLevel=renderer.getActiveMipmapLevel();
        restore=true;renderer.setRenderTarget(null);
        if(isolateNodePath!==undefined){
          shadowAutoUpdate=renderer.shadowMap.autoUpdate;shadowNeedsUpdate=renderer.shadowMap.needsUpdate;
          withNativeIsolation(native.scene,isolateNodePath,evidence=>{
            isolation=evidence;
            renderer.shadowMap.needsUpdate=true;
            // The canvas retains this isolated frame for the synchronous copy below.
            // Layer masks are restored before returning from the isolation helper.
            renderer.render(native.scene,camera);
          },isolationUuid);
        }else renderer.render(native.scene,camera);
      }else redraw();
      const ratio=Math.min(1,maxWidth/canvas.width,maxHeight/canvas.height);
      const width=Math.max(1,Math.round(canvas.width*ratio));
      const height=Math.max(1,Math.round(canvas.height*ratio));
      if(!isUsableVisualCaptureSize(width,height))throw fail('VISUAL_CAPTURE_DIMENSIONS_INVALID');
      const target=document.createElement('canvas');
      target.width=width;target.height=height;
      const context=target.getContext('2d');
      if(!context)throw fail('VISUAL_CAPTURE_UNAVAILABLE');
      context.drawImage(canvas,0,0,width,height);
      const imageBase64=target.toDataURL('image/jpeg',0.72).split(',')[1];
      if(!imageBase64 || imageBase64.length>240000)throw fail('VISUAL_CAPTURE_TOO_LARGE');
      return {status:'captured',width,height,mime:'image/jpeg',imageBase64,
        ...(camera?{view:{...resolvedView,position:[...resolvedView.position],target:[...resolvedView.target],fov:camera.fov},renderMode:'direct'}:{}),
        ...(isolation?{isolation}:{})};
    } catch(error) {
      if(error?.code)throw error;
      throw fail('VISUAL_CAPTURE_FAILED');
    } finally {
      if(restore){
        renderer.setRenderTarget(previousTarget,previousFace,previousLevel);
        if(isolateNodePath!==undefined&&shadowAutoUpdate!==undefined)renderer.shadowMap.needsUpdate=true;
        try{redraw();}finally{
          if(isolateNodePath!==undefined&&shadowAutoUpdate!==undefined){
            renderer.shadowMap.autoUpdate=shadowAutoUpdate;
            renderer.shadowMap.needsUpdate=shadowNeedsUpdate;
          }
        }
      }
    }
  }
  const physicsCandidate=({nodePath,objectUuid}={})=>{
    if(typeof nodePath!=='string'||!nodePath||!objectUuid)throw fail('NATIVE_PHYSICS_CANDIDATE_ID_REQUIRED');
    if(!native.analyzePhysics)throw fail('NATIVE_PHYSICS_CANDIDATE_UNAVAILABLE');
    const {node}=resolveNode(native.scene,nodePath,objectUuid);
    return {...native.analyzePhysics(node),nodePath};
  };
  return Object.freeze({inspect,physicsCandidate,search:options=>searchNativeScene(native,options),
    inspectBatch:options=>inspectNativeSceneBatch(native,options),
    suggestViews:options=>suggestNativeViews(native,options,aspect()),capture});
}
