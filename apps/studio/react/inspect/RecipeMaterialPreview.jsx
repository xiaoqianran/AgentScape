import {useEffect,useRef,useState} from 'react';
import * as THREE from 'three';
import {createRecipeMaterialSample} from '../../../../modules/asset/AssetModule.js';

// Use the actual compiler and glTF loader, not a parallel interpretation of
// PBR parameters. Preview owns all resources and never enters WorldRuntime.
function disposeObject(root){
  const resources=new Set();
  root?.traverse(node=>{
    if(!node.isMesh)return;
    resources.add(node.geometry);
    for(const material of [].concat(node.material)){
      resources.add(material);
      for(const value of Object.values(material))if(value?.isTexture)resources.add(value);
    }
  });
  for(const resource of resources)resource?.dispose?.();
  const images=new Set([...resources].filter(resource=>resource?.isTexture).map(texture=>texture.image));
  for(const image of images)image?.close?.();
}

export function RecipeMaterialPreview({material}){
  const canvas=useRef(null),context=useRef(null);
  const [status,setStatus]=useState('loading');
  useEffect(()=>{
    let renderer;
    try{renderer=new THREE.WebGLRenderer({canvas:canvas.current,alpha:true,antialias:true});}
    catch{setStatus('unavailable');return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(36,1,.1,20);
    camera.position.set(0,0,3.5);
    // Reflections and transmission need an environment and a visible backing.
    const environmentScene=new THREE.Scene();
    environmentScene.background=new THREE.Color('#777777');
    const cards=[];
    for(const [x,y,z,color] of [[-3,3,2,'#ffffff'],[3,1,-2,'#a4c6ff'],[0,-3,1,'#8b7862']]){
      const card=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));
      card.position.set(x,y,z);card.lookAt(0,0,0);environmentScene.add(card);cards.push(card);
    }
    const pmrem=new THREE.PMREMGenerator(renderer);
    const environment=pmrem.fromScene(environmentScene,.04,.1,20,{size:128});
    scene.environment=environment.texture;
    const ambient=new THREE.HemisphereLight('#ffffff','#64748b',1.4),key=new THREE.DirectionalLight('#ffffff',2.6);
    key.position.set(-3,4,3);scene.add(ambient,key);
    const state={renderer,scene,camera,object:null};
    context.current=state;
    const draw=()=>{
      if(context.current!==state)return;
      const w=Math.max(1,canvas.current.clientWidth),h=Math.max(1,canvas.current.clientHeight);
      renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
      renderer.render(scene,camera);
    };
    state.draw=draw;
    const observer=new ResizeObserver(draw);observer.observe(canvas.current);draw();
    return ()=>{
      context.current=null;observer.disconnect();
      disposeObject(state.object);
      environment.dispose();pmrem.dispose();
      cards.forEach(card=>{card.geometry.dispose();card.material.dispose();});
      renderer.dispose();renderer.forceContextLoss();
    };
  },[]);
  useEffect(()=>{
    const state=context.current;
    if(!state)return;
    let cancelled=false;
    setStatus('loading');
    const timer=setTimeout(async()=>{
      try{
        const object=await createRecipeMaterialSample(material);
        if(cancelled||context.current!==state){disposeObject(object);return;}
        if(state.object){state.scene.remove(state.object);disposeObject(state.object);}
        state.object=object;state.scene.add(object);state.draw();
        setStatus('ready');
      }catch{if(!cancelled)setStatus('unavailable');}
    },100);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[material]);
  return <div className="recipe-material-preview" data-preview-state={status}>
    <canvas ref={canvas} aria-label="PBR 材质球实时预览"/>
    <span role="status">{status==='ready'?'材质球预览 · 不修改世界':status==='loading'?'生成材质预览…':'预览不可用，仍可应用材质'}</span>
  </div>;
}
