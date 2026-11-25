import {useState,useSyncExternalStore} from 'react';
import {useStudioStore} from '../state/studioStore';
import {RecipeMaterialPreview} from './RecipeMaterialPreview';
import './RecipeMaterialEditor.css';
import {proceduralTextureSchema,PROCEDURAL_TEXTURE_PALETTES} from '../../../../modules/asset/model/ProceduralTextureContract.js';

const defaultTexture=proceduralTextureSchema.parse({pattern:'wood'});
const patterns=[['wood','木纹'],['stone','石材'],['fabric','织物'],['brushed-metal','拉丝金属']];
const sliders=[
  ['roughness','粗糙度',.7,0,1,.01],['metalness','金属度',0,0,1,.01],
  ['opacity','不透明度',1,0,1,.01],['clearcoat','清漆',0,0,1,.01],
  ['clearcoatRoughness','清漆粗糙度',0,0,1,.01],
  ['transmission','透射',0,0,1,.01],['ior','折射率',1.5,1,2.5,.01],
  ['emissiveIntensity','自发光强度',1,0,100,.1]
];

function Range({label,value,min=0,max=1,step=.01,onChange}){
  return <label className="material-range"><span>{label}<output>{Number(value).toFixed(2)}</output></span>
    <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event=>onChange(Number(event.target.value))}/>
  </label>;
}

function MaterialDraft({controller,id,source,editing,log,partId,setPartId,opened,setOpened}){
  const part=source.parts.find(item=>item.id===partId)||source.parts[0];
  const [material,setMaterial]=useState(()=>structuredClone(part.material));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const dirty=JSON.stringify(material)!==JSON.stringify(part.material);
  const set=(key,value)=>setMaterial(current=>({...current,[key]:value}));
  const setTexture=(key,value)=>setMaterial(current=>({...current,texture:{...current.texture,[key]:value}}));
  const choosePart=value=>{
    setPartId(value);setMaterial(structuredClone(source.parts.find(item=>item.id===value).material));setError('');
  };
  const apply=async()=>{
    if(!editing||busy||!dirty)return;
    setBusy(true);setError('');
    try{
      await controller.applyRecipeMaterial({id,partId:part.id,assetId:source.assetId,revision:source.revision,material});
      log('已更新材质：'+id+'/'+part.id);
    }catch(error){
      const message=error instanceof Error?error.message:String(error);
      setError(message==='OBJECT_REVISION_CONFLICT'?'材质已被其他操作修改，请重新选择对象。':message);
      log('材质应用失败：'+message,'error');
    }finally{setBusy(false);}
  };
  return <details className="inspect-section recipe-material-editor" open={opened} onToggle={event=>setOpened(event.currentTarget.open)}>
    <summary>材质 <span>{source.parts.length} 个部件 · PBR</span></summary>
    {opened?<><RecipeMaterialPreview material={material}/>
      {!editing?<p className="muted-copy">切换到编辑模式以修改材质。</p>:null}
      <fieldset disabled={!editing||busy}>
        <label className="material-field">部件<select aria-label="材质部件" value={part.id} onChange={event=>choosePart(event.target.value)}>
          {source.parts.map(item=><option key={item.id} value={item.id}>{item.id}</option>)}
        </select></label>
        <label className="material-field">基础颜色<input aria-label="基础颜色" type="color" value={material.color||'#aaaaaa'} onChange={event=>set('color',event.target.value)}/></label>
        {sliders.slice(0,3).map(([key,label,fallback,min,max,step])=><Range key={key} label={label} value={material[key]??fallback} min={min} max={max} step={step} onChange={value=>set(key,value)}/>)}
        <label className="material-field">程序纹理<select aria-label="程序纹理" value={material.texture?.pattern||''} onChange={event=>{
          const pattern=event.target.value;
          setMaterial(current=>{const next={...current};if(pattern){next.texture={...(current.texture||defaultTexture),pattern};if(!current.texture)next.color='#ffffff';}else delete next.texture;return next;});
        }}>
          <option value="">纯色 / 无纹理</option>{patterns.map(([value,label])=><option key={value} value={value}>{label}</option>)}
        </select></label>
        {material.texture?<div className="material-texture-fields">
          <label className="material-field">分辨率<select aria-label="纹理分辨率" value={material.texture.resolution} onChange={event=>setTexture('resolution',Number(event.target.value))}>{[64,128,256].map(size=><option key={size} value={size}>{size} × {size}</option>)}</select></label>
          <label className="material-field">随机种子<input aria-label="纹理随机种子" type="number" min="0" max="4294967295" step="1" value={material.texture.seed} onChange={event=>setTexture('seed',Math.max(0,Math.min(4294967295,Math.trunc(Number(event.target.value)||0))))}/></label>
          <Range label="纹理频率" min={1} max={4} step={1} value={material.texture.frequency} onChange={value=>setTexture('frequency',value)}/>
          <Range label="纹理对比度" value={material.texture.contrast} onChange={value=>setTexture('contrast',value)}/>
          <Range label="法线强度" value={material.texture.normalStrength} onChange={value=>setTexture('normalStrength',value)}/>
          {['darkColor','lightColor'].map((key,i)=><label key={key} className="material-field">{i?'浅色':'深色'}<input type="color" aria-label={i?'纹理浅色':'纹理深色'} value={material.texture[key]||PROCEDURAL_TEXTURE_PALETTES[material.texture.pattern][i]} onChange={event=>setTexture(key,event.target.value)}/></label>)}
        </div>:null}
        <details className="material-advanced"><summary>高级 PBR</summary>
          {sliders.slice(3).map(([key,label,fallback,min,max,step])=><Range key={key} label={label} value={material[key]??fallback} min={min} max={max} step={step} onChange={value=>set(key,value)}/>)}
          <label className="material-field">自发光颜色<input aria-label="自发光颜色" type="color" value={material.emissive||'#000000'} onChange={event=>set('emissive',event.target.value)}/></label>
          <label className="material-field">双面渲染<input type="checkbox" checked={material.doubleSided||false} onChange={event=>set('doubleSided',event.target.checked)}/></label>
        </details>
      </fieldset>
      {error?<p className="inspect-error" role="alert">{error}</p>:null}
      <div className="material-actions"><button type="button" disabled={!dirty||busy} onClick={()=>{setMaterial(structuredClone(part.material));setError('');}}>重置预览</button><button type="button" disabled={!editing||!dirty||busy} onClick={()=>void apply()}>{busy?'应用中…':'应用材质'}</button></div>
      <small>仅替换当前实例；其他对象保持原材质。</small>
    </>:null}
  </details>;
}

export function RecipeMaterialEditor({controller,id,editing,log,opened,setOpened}){
  // Reading is cheap and side-effect free; the existing inspector revision
  // invalidates on world changes (including edits from MCP).
  useStudioStore(state=>state.editor.revision);
  useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
  const [partId,setPartId]=useState('');
  const source=controller.recipeMaterial(id);
  if(!source)return null;
  return <MaterialDraft key={id+':'+source.assetId+':'+source.revision} controller={controller} id={id} source={source} editing={editing} log={log} partId={partId} setPartId={setPartId} opened={opened} setOpened={setOpened}/>;
}
