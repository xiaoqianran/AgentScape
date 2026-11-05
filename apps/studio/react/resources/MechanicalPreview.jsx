import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

function createVisual(node, selected) {
  if (node.shape === 'group') return new THREE.Group();
  const geometry = node.shape === 'box' ? new THREE.BoxGeometry(...node.size)
    : node.shape === 'sphere' ? new THREE.SphereGeometry(node.size[0]/2,20,14)
    : new THREE.CylinderGeometry(node.size[0]/2,node.size[0]/2,node.size[1],20);
  const material = new THREE.MeshStandardMaterial({
    color:node.color,metalness:.58,roughness:.44,
    emissive:selected?'#193d4a':'#000000',emissiveIntensity:selected?.55:0
  });
  const mesh = new THREE.Mesh(geometry,material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function disposeTree(node) {
  node.traverse(item=>{
    if (item.isMesh) {
      item.geometry?.dispose();
      if (Array.isArray(item.material)) item.material.forEach(material=>material.dispose());
      else item.material?.dispose();
    }
  });
}

export function MechanicalPreview({ components, selected }) {
  const canvas=useRef(null);
  const root=useRef(null);
  const invalidate=useRef(null);
  const [error,setError]=useState('');

  useEffect(()=>{
    if (!canvas.current) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({canvas:canvas.current,alpha:true,antialias:true}); }
    catch { setError('3D 预览不可用，仍可编辑并编译资产。'); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,2));
    renderer.shadowMap.enabled=true;
    const scene=new THREE.Scene();
    const camera=new THREE.PerspectiveCamera(38,1,.05,80);
    camera.position.set(4.1,3.5,5.8);
    scene.add(new THREE.AmbientLight('#ffffff',1.6));
    const light=new THREE.DirectionalLight('#ffffff',2.8);
    light.position.set(4,8,5);
    light.castShadow=true;
    light.shadow.mapSize.set(512,512);
    scene.add(light);
    const floor=new THREE.GridHelper(8,16,'#627f90','#34414b');
    floor.position.y=-.01;
    scene.add(floor);
    const controls=new OrbitControls(camera,renderer.domElement);
    controls.target.set(0,1.05,0);
    controls.minDistance=2;
    controls.maxDistance=16;
    controls.update();
    const update=()=>{
      const width=Math.max(1,canvas.current?.clientWidth||520);
      const height=Math.max(1,canvas.current?.clientHeight||320);
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      camera.updateProjectionMatrix();
      renderer.render(scene,camera);
    };
    const redraw=()=>renderer.render(scene,camera);
    controls.addEventListener('change',redraw);
    const observer=new ResizeObserver(update);
    observer.observe(canvas.current);
    root.current=new THREE.Group();
    scene.add(root.current);
    invalidate.current=redraw;
    update();
    return ()=>{
      invalidate.current=null;
      controls.dispose();
      observer.disconnect();
      if(root.current) {
        disposeTree(root.current);
        scene.remove(root.current);
        root.current=null;
      }
      floor.geometry.dispose();
      floor.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
  },[]);

  useEffect(()=>{
    const group=root.current;
    if(!group) return;
    for(const child of [...group.children]) {
      disposeTree(child);
      group.remove(child);
    }
    const objects=new Map();
    for(const node of components) {
      const mesh=createVisual(node,node.id===selected);
      mesh.name=node.id;
      mesh.position.set(...node.position);
      objects.set(node.id,mesh);
    }
    for(const node of components) {
      const object=objects.get(node.id);
      ((node.parent && objects.get(node.parent)) || group).add(object);
    }
    invalidate.current?.();
  },[components,selected]);

  return <div className="mechanical-preview-shell">
    <canvas ref={canvas} aria-label="机械资产可旋转预览" />
    {error ? <p role="status">{error}</p>
      : <span>拖动旋转 · 滚轮缩放 · 预览仅代表视觉模型</span>}
  </div>;
}
