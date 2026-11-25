import * as THREE from 'three';

/** A bounded raster still rendered in an isolated WebGL context, not a
 * viewport screenshot. The scene's authoritative camera and shadow maps stay
 * owned by the live renderer. This is not a path tracer. */
export async function captureStill({scene,camera,decoration,exposure=1,longEdge=1920}){
  if(![1920,3840].includes(longEdge)||!camera?.isPerspectiveCamera)throw new Error('STILL_OPTIONS_INVALID');
  const aspect=camera.aspect;
  if(!Number.isFinite(aspect)||aspect<=0||aspect>10)throw new Error('STILL_CAMERA_ASPECT_INVALID');
  const width=Math.max(1,Math.round(aspect>=1?longEdge:longEdge*aspect));
  const height=Math.max(1,Math.round(aspect>=1?longEdge/aspect:longEdge));
  if(width*height>16_000_000)throw new Error('STILL_PIXEL_LIMIT');
  const shadows=[];
  scene.traverse(node=>{
    if([].concat(node.material||[]).some(material=>material?.isNodeMaterial))throw new Error('STILL_NODE_MATERIAL_UNSUPPORTED');
    if(node.isLight&&node.shadow)shadows.push([node,node.shadow]);
  });
  // Limit shadow atlas allocations, particularly point lights with six faces.
  const shadowWeight=shadows.reduce((sum,[light])=>sum+(light.castShadow?(light.isPointLight?8:1):0),0);
  const shadowSize=shadowWeight>8?512:shadowWeight>2?1024:2048;
  const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
  const shot=camera.clone();shot.aspect=width/height;shot.updateProjectionMatrix();
  const visible=decoration?.visible;
  let restoreNeeded=false;
  const restore=()=>{
    if(!restoreNeeded)return;
    restoreNeeded=false;
    if(decoration)decoration.visible=visible;
    for(const [light,shadow] of shadows){if(light.shadow!==shadow)light.shadow.dispose();light.shadow=shadow;}
  };
  try{
    renderer.setPixelRatio(1);renderer.setSize(width,height,false);
    renderer.outputColorSpace=THREE.SRGBColorSpace;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=exposure;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    if(width>renderer.capabilities.maxTextureSize||height>renderer.capabilities.maxTextureSize)throw new Error('STILL_GPU_LIMIT');
    restoreNeeded=true;
    if(decoration)decoration.visible=false;
    for(const [light,shadow] of shadows){
      light.shadow=shadow.clone();
      if(light.castShadow){const size=light.isPointLight?Math.min(512,shadowSize):shadowSize;light.shadow.mapSize.set(size,size);}
    }
    try{renderer.render(scene,shot);}
    finally{restore();}
    const blob=await new Promise((resolve,reject)=>renderer.domElement.toBlob(value=>value?resolve(value):reject(new Error('STILL_ENCODE_FAILED')),'image/png'));
    return {blob,width,height};
  }finally{
    restore();
    renderer.dispose();renderer.forceContextLoss();
  }
}
