// @ts-ignore The runtime shares the exact Three.js instance exposed by CodeProject.
import * as THREE from 'three';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {emptyCodeSnapshot,emptyCodeSubscribe} from './CodeProjectWorkbench';
import './CodeWorldVisualEditor.css';

type VisualObject={id:string;label:string;source:'code'|'editor';properties:string[];transform:{
  position:number[];quaternion:number[];scale:number[];visible?:boolean
}};
const axis=(value:number)=>Number(value.toFixed(3));
function fromTransform(entry:VisualObject) {
  const rotation=new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...entry.transform.quaternion));
  return {
    position:entry.transform.position.map(String),
    rotation:[rotation.x,rotation.y,rotation.z].map(value=>String(axis(THREE.MathUtils.radToDeg(value)))),
    scale:entry.transform.scale.map(String),
    visible:entry.transform.visible!==false
  };
}
const fallback={position:['0','0','0'],rotation:['0','0','0'],scale:['1','1','1'],visible:true};

export function CodeWorldVisualEditor({controller}:{controller:any}){
  const state:any=useSyncExternalStore(controller?.subscribe || emptyCodeSubscribe,
    controller?.snapshot || emptyCodeSnapshot,controller?.snapshot || emptyCodeSnapshot);
  const [objects,setObjects]=useState<VisualObject[]>([]);
  const [missing,setMissing]=useState<string[]>([]);
  const [selected,setSelected]=useState('');
  const [fields,setFields]=useState(fallback);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [revision,setRevision]=useState(0);
  const highlight=useRef<any>(null);
  const selectedObject=objects.find(entry=>entry.id===selected)||null;
  const session=controller?.session;

  const refresh=()=>{
    const active=controller?.session;
    if(!active){setObjects([]);setMissing([]);return;}
    const view=active.scene.observe();
    const native:VisualObject[]=(view.nativeEditables?.objects || []).map((record:any)=>({
      id:record.id,label:record.label,source:'code',
      properties:record.properties,transform:record.transform
    }));
    const managed:VisualObject[]=view.objects.map((record:any)=>({
      id:record.id,label:record.label || record.id,source:'editor',
      properties:['position','quaternion','scale'],transform:{
        position:record.transform.position,quaternion:record.transform.quaternion,
        scale:[record.transform.scale,record.transform.scale,record.transform.scale]
      }
    }));
    setObjects([...native,...managed]);
    setMissing(view.nativeEditables?.unresolved || []);
    setRevision(value=>value+1);
  };

  useEffect(()=>{
    refresh();
    const world=controller?.session?.world;
    if(!world?.events?.on)return;
    const unsubscribe=['native.edit.changed','native.edit.registered','native.edit.unregistered','history.recorded','history.applied','scene.restored']
      .map(event=>world.events.on(event,refresh));
    return ()=>unsubscribe.forEach(stop=>stop?.());
  },[controller,session,state.runningRevision,state.active]);

  useEffect(()=>{
    const entry=objects.find(item=>item.id===selected);
    if(entry)setFields(fromTransform(entry));
    else setFields(fallback);
  },[selected,revision]);

  const getObject=(id:string)=>{
    return controller.visualObject(id);
  };

  useEffect(()=>{
    const native=controller?.session?.scene?.native;
    const canvas=native?.renderer?.domElement as HTMLCanvasElement|undefined;
    const scene=native?.scene as any;
    if(!canvas||!scene||!native.camera)return;
    const raycaster=new THREE.Raycaster(),point=new THREE.Vector2();
    let pointer:[number,number]|null=null;
    const down=(event:PointerEvent)=>{if(event.button===0)pointer=[event.clientX,event.clientY];};
    const up=(event:PointerEvent)=>{
      if(!pointer||Math.hypot(event.clientX-pointer[0],event.clientY-pointer[1])>5){pointer=null;return;}
      pointer=null;
      const rect=canvas.getBoundingClientRect();
      point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(point,native.camera);
      const hit=raycaster.intersectObjects(scene.children,true).find((intersection:any)=>{
        for(let node:any=intersection.object;node;node=node.parent){
          if(node===highlight.current)return false;
          const current=objects.find(item=>getObject(item.id)===node);
          if(current)return true;
        }
        return false;
      });
      if(!hit)return;
      for(let node:any=hit.object;node;node=node.parent){
        const current=objects.find(item=>getObject(item.id)===node);
        if(current){setSelected(current.id);break;}
      }
    };
    canvas.addEventListener('pointerdown',down);
    canvas.addEventListener('pointerup',up);
    return ()=>{canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);};
  },[controller,session,objects]);

  useEffect(()=>{
    const scene=controller?.session?.scene?.native?.scene as any;
    if(highlight.current){highlight.current.removeFromParent();highlight.current.geometry.dispose();highlight.current.material.dispose();highlight.current=null;}
    if(!scene||!selected)return;
    const object=getObject(selected);
    if(!object)return;
    const box=new THREE.Box3().setFromObject(object);
    if(box.isEmpty())return;
    const helper=new THREE.BoxHelper(object,0xffc56b);
    helper.name='AgentScapeVisualSelection';
    scene.add(helper);highlight.current=helper;
    return ()=>{helper.removeFromParent();helper.geometry.dispose();helper.material.dispose();if(highlight.current===helper)highlight.current=null;};
  },[controller,session,selected,revision]);

  const change=(kind:'position'|'rotation'|'scale',axis:number,value:string)=>
    setFields(current=>({...current,[kind]:current[kind].map((item,index)=>index===axis?value:item)}));
  const execute=async(operation:()=>Promise<any>,success:string)=>{
    setBusy(true);setError('');setMessage('');
    try{
      const value=await operation();
      if(value?.status==='failed')throw new Error(value.diagnostics?.[0]?.code||'EDIT_FAILED');
      setMessage(success);refresh();
    }catch(error){setError(error instanceof Error?error.message:String(error));refresh();}
    finally{setBusy(false);}
  };
  const applyChanges=()=>execute(async()=>{
    if(!selectedObject)throw new Error('请先选择对象');
    const numeric=(values:string[])=>values.map(value=>Number(value));
    const position=numeric(fields.position),rotation=numeric(fields.rotation),scale=numeric(fields.scale);
    if([...position,...rotation,...scale].some(value=>!Number.isFinite(value)))throw new Error('请输入有效数值');
    const quaternion=new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(THREE.MathUtils.degToRad) as [number,number,number])).toArray();
    const changes:any={};
    // An unchanged property is still code-owned. Only persist fields explicitly
    // changed by the visual editor, so new code defaults remain authoritative.
    const different=(a:number[],b:number[])=>a.some((value,index)=>Math.abs(value-b[index])>1e-5);
    if(selectedObject.properties.includes('position')&&different(position,selectedObject.transform.position))
      changes.position=position;
    if(selectedObject.properties.includes('quaternion')&&different(quaternion,selectedObject.transform.quaternion))
      changes.quaternion=quaternion;
    if(selectedObject.properties.includes('scale')&&different(scale,selectedObject.transform.scale))
      changes.scale=scale;
    if(selectedObject.properties.includes('visible')&&fields.visible!==selectedObject.transform.visible)
      changes.visible=fields.visible;
    if(selectedObject.source==='code'){
      if(!Object.keys(changes).length)throw new Error('没有发生可保存的属性变化');
      return controller.scene.apply({expectedRevision:controller.scene.observe().revision,
        operations:[{type:'editNative',id:selectedObject.id,changes}]});
    }
    if(scale.some(value=>Math.abs(value-scale[0])>1e-6))throw new Error('资源模型仅支持等比缩放');
    return controller.scene.apply({expectedRevision:controller.scene.observe().revision,operations:[
      {type:'setTransform',id:selectedObject.id,transform:{position,quaternion,scale:scale[0]}}
    ]});
  },'已通过统一 Scene API 应用修改 · 尚未保存世界');
  const addBox=()=>execute(async()=>{
    const id='visual_'+crypto.randomUUID().replaceAll('-','').slice(0,12);
    const result=await controller.scene.addModel({id,asset:{
      schema:'agentscape.asset-recipe',schemaVersion:1,id:'studio/visual_cube',
      parts:[{id:'body',geometry:{type:'box',size:[2,2,2]},material:{color:'#daa55f'}}]
    },level:'visual',position:[0,12,14]});
    setSelected(id);return result;
  },'已向当前代码世界添加方块 · 尚未保存世界');
  const remove=()=>execute(async()=>{
    if(!selectedObject||selectedObject.source!=='editor')throw new Error('代码创建的物体必须由其源码删除');
    const result=await controller.scene.apply({operations:[{type:'remove',id:selectedObject.id}]});
    setSelected('');return result;
  },'已删除可视化添加的对象 · 尚未保存世界');

  return <div className="code-world-visual" aria-label="代码世界可视化编辑">
    <h2>可视化编辑</h2>
    <p>世界由完整 Three.js 代码创建；编辑只通过 Scene API 写入，不改写原始源码。</p>
    {!state.active ? <p role="status">请先运行代码世界，才能编辑场景。</p> : <>
      <div className="code-world-visual-actions">
        <button type="button" onClick={()=>void addBox()} disabled={busy||state.busy}>添加方块</button>
        <button type="button" onClick={refresh} disabled={busy}>刷新对象</button>
        <button type="button" onClick={()=>void execute(()=>controller.save(),'整个代码世界与编辑层已保存到当前浏览器')}
          disabled={busy||state.busy||state.revision!==state.runningRevision}>保存世界</button>
      </div>
      <label>场景对象
        <select aria-label="可视化对象列表" value={selected} onChange={event=>setSelected(event.target.value)}>
          <option value="">请选择或点击场景物体</option>
          {objects.map(item=><option key={item.id} value={item.id}>{item.source==='code'?'代码':'编辑'} · {item.label}</option>)}
        </select>
      </label>
      <small>{objects.length} 个可管理对象；代码对象只允许修改声明开放的属性。</small>
      {selectedObject ? <div className="code-world-visual-fields">
        <strong>{selectedObject.label}</strong>
        <small>{selectedObject.source==='code'?'源码创建 · 按稳定 ID 关联':'编辑器添加 · 独立场景对象'} · {selectedObject.id}</small>
        {(['position','rotation','scale'] as const).map(kind=><fieldset key={kind}>
          <legend>{kind==='position'?'位置':kind==='rotation'?'旋转（度）':'缩放'}</legend>
          <div className="code-world-visual-vector">
            {(['X','Y','Z'] as const).map((axis,index)=><label key={axis}>
              {axis}<input type="number" step="0.1" aria-label={kind+' '+axis} value={fields[kind][index]}
                disabled={busy || (kind==='rotation'?!selectedObject.properties.includes('quaternion'):!selectedObject.properties.includes(kind))}
                onChange={event=>change(kind,index,event.target.value)}/>
            </label>)}
          </div>
        </fieldset>)}
        {selectedObject.properties.includes('visible')?<label className="code-world-visual-check">
          <input type="checkbox" checked={fields.visible} disabled={busy}
            onChange={event=>setFields(current=>({...current,visible:event.target.checked}))}/>显示对象
        </label>:null}
        <button disabled={busy||state.busy} type="button" onClick={()=>void applyChanges()}>应用变换</button>
        {selectedObject.source==='editor'?<button disabled={busy||state.busy} type="button" onClick={()=>void remove()}>删除编辑层物体</button>:null}
      </div>:null}
      {missing.length?<p role="alert">代码对象已变更，以下编辑记录暂时无法匹配：{missing.join('、')}</p>:null}
      <small>编辑结果保存在当前代码世界的独立数据层。修改源码并重新运行后会尝试按对象 ID 恢复。</small>
    </>}
    {message?<output role="status">{message}</output>:null}
    {error?<p role="alert">{error}</p>:null}
  </div>;
}
