// @ts-ignore The runtime shares the exact Three.js instance exposed by CodeProject.
import * as THREE from 'three';
import {useEffect,useRef,useState,useSyncExternalStore} from 'react';
import {emptyCodeSnapshot,emptyCodeSubscribe} from './CodeProjectWorkbench';
import {CodeWorldTransformGizmo} from '../../editor/CodeWorldTransformGizmo.js';
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
  const [history,setHistory]=useState({undo:0,redo:0,canUndo:false,canRedo:false});
  const [selected,setSelected]=useState('');
  const [fields,setFields]=useState(fallback);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [nativeQuery,setNativeQuery]=useState('');
  const [nativeResults,setNativeResults]=useState<any[]>([]);
  const [nativeMeta,setNativeMeta]=useState<any>(null);
  const [nativeUuid,setNativeUuid]=useState('');
  const [nativeBatch,setNativeBatch]=useState<any>(null);
  const [nativeViews,setNativeViews]=useState<any>(null);
  const [nativePreview,setNativePreview]=useState('');
  const [revision,setRevision]=useState(0);
  const gizmoRef=useRef<any>(null);
  const refreshRef=useRef<()=>void>(()=>{});
  const [gizmoMode,setGizmoMode]=useState<'translate'|'rotate'|'scale'>('translate');
  const [hoverAxis,setHoverAxis]=useState('');
  const selectedObject=objects.find(entry=>entry.id===selected)||null;
  const session=controller?.session;
  const nativeSelected=nativeResults.find(item=>item.objectUuid===nativeUuid);
  useEffect(()=>{
    setNativeResults([]);setNativeMeta(null);setNativeUuid('');setNativeBatch(null);setNativeViews(null);setNativePreview('');
  },[controller,state.runtimeId]);

  const refresh=()=>{
    const active=controller?.session;
    if(!active){setObjects([]);setMissing([]);setHistory({undo:0,redo:0,canUndo:false,canRedo:false});return;}
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
    setHistory(view.history || {undo:0,redo:0,canUndo:false,canRedo:false});
    setRevision(value=>value+1);
  };
  refreshRef.current=refresh;

  useEffect(()=>{
    refresh();
    const world=controller?.session?.world;
    if(!world?.events?.on)return;
    const unsubscribe=['native.edit.changed','native.edit.registered','native.edit.unregistered','history.changed','history.recorded','history.applied','scene.restored']
      .map(event=>world.events.on(event,refresh));
    return ()=>unsubscribe.forEach(stop=>stop?.());
  },[controller,session,state.runningRevision,state.active]);

  useEffect(()=>{
    const entry=objects.find(item=>item.id===selected);
    if(entry)setFields(fromTransform(entry));
    else setFields(fallback);
  },[selected,revision]);

  const getObject=(id:string)=>controller.visualObject(id);

  // Bind Three's gizmo to THIS code project's renderer, camera, and scene.
  // Dragging is a proxy-only preview; commit goes through SceneFacade.apply,
  // exactly like GUI numeric fields and MCP scene_apply.
  useEffect(()=>{
    const active=controller?.session;
    const native=active?.scene?.native;
    const element=native?.renderer?.domElement;
    if(!active||!native?.scene||!native.camera||!element)return;
    const gizmo=new CodeWorldTransformGizmo({
      scene:native.scene,camera:native.camera,element,
      getObject:(id:string)=>controller.visualObject(id),
      getRevision:()=>active.scene.observe().revision,
      onCommit:async({operation,expectedRevision}:any)=>{
        if(controller.session!==active)throw new Error('CODE_GIZMO_WORLD_CHANGED');
        const response=await active.scene.apply({expectedRevision,operations:[operation]});
        if(response.status!=='succeeded')throw new Error(response.diagnostics?.[0]?.code||'CODE_GIZMO_EDIT_FAILED');
      },
      onPreview:({phase,transform}:any)=>{
        if(phase==='start'){setBusy(true);setError('');setMessage('拖拽预览中 · 松开鼠标后通过 Scene API 提交');}
        if(phase==='move'&&transform){
          setFields(fromTransform({transform} as VisualObject));
        }
        if(phase==='invalid')setMessage('当前父级变换不支持此预览');
      },
      onFinish:({committed,cancelled,error}:any)=>{
        setBusy(false);
        if(error){setError(error.message||String(error));setMessage('拖拽未提交 · 原始场景未被更改');}
        else if(committed){setError('');setMessage('已通过统一 Scene API 提交拖拽 · 尚未保存世界');}
        else if(cancelled)setMessage('已取消拖拽');
        refreshRef.current();
      },
      onMode:(mode:'translate'|'rotate'|'scale')=>setGizmoMode(mode),
      onAxis:(axis:string)=>setHoverAxis(axis)
    });
    gizmoRef.current=gizmo;
    return ()=>{
      gizmoRef.current=null;
      gizmo.dispose();
      setHoverAxis('');
    };
  },[controller,session]);

  useEffect(()=>{
    const selectedObject=objects.find(item=>item.id===selected)||null;
    gizmoRef.current?.select(selectedObject);
  },[session,selected,objects]);

  useEffect(()=>{
    const native=controller?.session?.scene?.native;
    const canvas=native?.renderer?.domElement as HTMLCanvasElement|undefined;
    const scene=native?.scene as any;
    if(!canvas||!scene||!native.camera)return;
    const raycaster=new THREE.Raycaster(),point=new THREE.Vector2();
    let pointer:[number,number]|null=null;
    const down=(event:PointerEvent)=>{if(event.button===0)pointer=[event.clientX,event.clientY];};
    const up=(event:PointerEvent)=>{
      const suppressed=gizmoRef.current?.consumePickSuppression();
      if(!pointer||Math.hypot(event.clientX-pointer[0],event.clientY-pointer[1])>5){pointer=null;return;}
      pointer=null;
      if(suppressed)return;
      const rect=canvas.getBoundingClientRect();
      point.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      raycaster.setFromCamera(point,native.camera);
      const hit=raycaster.intersectObjects(scene.children,true).find((intersection:any)=>{
        for(let node:any=intersection.object;node;node=node.parent){
          if(node.name==='AgentScapeCodeWorldGizmo'||node.name==='AgentScapeCodeWorldEditOutline')return false;
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
  const nativeRequest=()=>({expectedRevision:state.revision,expectedRuntimeId:state.runtimeId,
    expectedSceneRevision:controller.scene.observe({limit:1}).revision});
  const boundNativeRequest=()=>{
    if(!nativeMeta||nativeMeta.runtimeId!==state.runtimeId||nativeMeta.revision!==state.revision)
      throw new Error('NATIVE_INSPECT_SCENE_CONFLICT');
    return {expectedRevision:nativeMeta.revision,expectedRuntimeId:nativeMeta.runtimeId,expectedSceneRevision:nativeMeta.sceneRevision};
  };
  const searchNative=(offset=0,append=false)=>execute(async()=>{
    const result=controller.search({...append?boundNativeRequest():nativeRequest(),query:append?nativeMeta.query:nativeQuery,visibleOnly:true,offset,limit:32});
    setNativeResults(current=>append?[...current,...result.items]:result.items);
    setNativeMeta(result);
    if(!append){setNativeUuid(result.items[0]?.objectUuid||'');setNativeBatch(null);setNativeViews(null);setNativePreview('');}
    return result;
  },'已搜索原生 Three.js 对象');
  const inspectNativeBatch=()=>execute(async()=>{
    if(!nativeResults.length)throw new Error('请先搜索对象');
    const targets=nativeResults.slice(0,8);
    const result=controller.inspectBatch({...boundNativeRequest(),nodePaths:targets.map(item=>item.nodePath),objectUuids:targets.map(item=>item.objectUuid),includeMaterials:true,includeLights:true,visibility:targets.length<=4});
    setNativeBatch(result);return result;
  },'已批量观察搜索结果');
  const previewNative=()=>execute(async()=>{
    if(!nativeSelected)throw new Error('请先选择一个原生对象');
    const request=boundNativeRequest();
    const {nodePath,objectUuid}=nativeSelected;
    const views=controller.suggestViews({...request,nodePath,objectUuid,candidateLimit:4,grid:3});
    setNativeViews(views);
    if(!views.best)throw new Error('当前对象无法获得可靠的候选视角');
    const capture=await controller.captureWhenReady({...request,maxWidth:640,maxHeight:480,view:views.best.view,isolateNodePath:nodePath,isolateObjectUuid:objectUuid});
    setNativePreview('data:image/jpeg;base64,'+capture.imageBase64);
    return views;
  },'已选择采样可见性最佳的机位并生成局部预览');
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
      {state.playback ? <section className="native-world-time" aria-label="世界时间控制">
        <strong>{state.playback.paused?'世界时间已暂停':'世界时间运行中'}</strong>
        <div className="code-world-visual-actions">
          <button type="button" disabled={busy||state.busy} onClick={()=>void execute(()=>controller.timeline({
            expectedRevision:state.revision,expectedRuntimeId:state.runtimeId,command:state.playback.paused?'resume':'pause'
          }),state.playback.paused?'世界时间已恢复':'世界时间已暂停')}>{state.playback.paused?'恢复世界时间':'暂停世界时间'}</button>
          <button type="button" disabled={busy||state.busy||!state.playback.paused} onClick={()=>void execute(()=>controller.timeline({
            expectedRevision:state.revision,expectedRuntimeId:state.runtimeId,command:'step',steps:1
          }),'已推进一个固定时间步')}>单步推进</button>
        </div>
        {state.playback.paused?<small>项目时间 {Number(state.playback.elapsedSeconds).toFixed(3)} 秒 · 仿真 tick {state.playback.simulation.tick}</small>:null}
      </section>:null}
      <section className="native-world-inspector" aria-label="原生 Three 对象搜索">
        <strong>原生场景搜索与观察</strong>
        <p>搜索完整 Three.js 场景树，不要求对象预先注册语义 ID。</p>
        <div className="native-world-search">
          <input aria-label="原生对象搜索" value={nativeQuery} placeholder="名称、Mesh 类型或材质名称"
            onChange={event=>setNativeQuery(event.target.value)} disabled={busy||state.busy}
            onKeyDown={event=>{if(event.key==='Enter')void searchNative();}}/>
          <button type="button" disabled={busy||state.busy||!nativeQuery.trim()} onClick={()=>void searchNative()}>搜索</button>
        </div>
        {nativeMeta?<small>扫描 {nativeMeta.scannedNodes} 个节点 · 命中 {nativeMeta.totalMatches} 个 · {nativeMeta.truncated?'结果受扫描预算限制':'扫描完成'}</small>:null}
        {nativeResults.length?<div className="native-world-results">
          {nativeResults.map(item=><button type="button" key={item.objectUuid} className={nativeUuid===item.objectUuid?'selected':''}
            onClick={()=>{setNativeUuid(item.objectUuid);setNativePreview('');setNativeViews(null);}} disabled={busy||state.busy}>
            <span>{item.name||'(未命名对象)'}</span><small>{item.type} · {item.nodePath||'root'} · {item.visible?'可见':'隐藏'}</small>
          </button>)}
        </div>:nativeMeta?<small>没有匹配对象</small>:null}
        <div className="code-world-visual-actions">
          <button type="button" disabled={busy||state.busy||!nativeMeta?.nextOffset} onClick={()=>void searchNative(nativeMeta.nextOffset,true)}>加载更多</button>
          <button type="button" disabled={busy||state.busy||!nativeResults.length} onClick={()=>void inspectNativeBatch()}>批量检查前 8 个</button>
          <button type="button" disabled={busy||state.busy||!nativeSelected} onClick={()=>void previewNative()}>自动找最佳机位</button>
        </div>
        {nativeViews?.best?<small>最佳采样可见率 {(nativeViews.best.visibility.visibleFraction*100).toFixed(1)}% · {nativeViews.candidates.length} 个候选机位</small>:null}
        {nativeBatch?<small>批量检查 {nativeBatch.count} 个对象 · {nativeBatch.totals.nodes} 个节点 · {nativeBatch.totals.estimatedTriangles.toLocaleString()} 个估算三角形</small>:null}
        {nativePreview?<img className="native-world-preview" src={nativePreview} alt="自动机位隔离观察预览"/>:null}
      </section>
      <div className="code-world-visual-actions">
        <button type="button" onClick={()=>void addBox()} disabled={busy||state.busy}>添加方块</button>
        <button type="button" disabled={!history.canUndo||busy||state.busy}
          onClick={()=>void execute(()=>controller.scene.history({
            operation:'undo',expectedRevision:controller.scene.observe().revision
          }),'撤销已通过统一 Scene 历史提交 · 尚未保存世界')}>撤销</button>
        <button type="button" disabled={!history.canRedo||busy||state.busy}
          onClick={()=>void execute(()=>controller.scene.history({
            operation:'redo',expectedRevision:controller.scene.observe().revision
          }),'重做已通过统一 Scene 历史提交 · 尚未保存世界')}>重做</button>
        <button type="button" onClick={refresh} disabled={busy}>刷新对象</button>
        <button type="button" onClick={()=>void execute(()=>controller.save(),'整个代码世界与编辑层已保存到当前浏览器')}
          disabled={busy||state.busy||state.revision!==state.runningRevision}>保存世界</button>
      </div>
      <div className="code-world-gizmo-tools" role="group" aria-label="三轴变换工具">
        {([
          ['translate','移动 W','position'],['rotate','旋转 E','quaternion'],['scale','缩放 R','scale']
        ] as const).map(([mode,label,property])=><button key={mode} type="button"
          aria-pressed={gizmoMode===mode}
          disabled={!selectedObject||!selectedObject.properties.includes(property)||busy||state.busy}
          onClick={()=>{gizmoRef.current?.setMode(mode);}}>
          {label}
        </button>)}
      </div>
      <small data-gizmo-status={session&&selectedObject?'active':'inactive'}>
        {selectedObject?'拖动场景中的三轴控件预览，松开鼠标提交一次；Esc 取消。':'先选中场景对象以显示三轴控件。'}
        {hoverAxis?' · 当前轴：'+hoverAxis:''}
      </small>
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
