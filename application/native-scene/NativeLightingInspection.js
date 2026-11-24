import { Vector3 } from 'three';

const MAX_LIGHTS=32;
const short=value=>String(value??'').slice(0,120);
const vector=value=>value.toArray().map(n=>Number.isFinite(n)?Number(n.toPrecision(8)):null);
const color=value=>value?.isColor?'#'+value.getHexString():undefined;

/** Bounded read-only light metadata. Intensity is the Three.js value, not lux. */
export function createLightingInventory(){
  const items=[],seen=new Set();let truncated=false;
  const position=new Vector3(),direction=new Vector3(),target=new Vector3();
  return {
    add(light,visible){
      if(!light?.isLight||seen.has(light))return;
      seen.add(light);
      if(items.length>=MAX_LIGHTS){truncated=true;return;}
      light.getWorldPosition(position);
      const item={name:short(light.name),type:short(light.type),visible:Boolean(visible&&light.visible!==false),
        color:color(light.color),intensity:Number.isFinite(light.intensity)?Number(light.intensity.toPrecision(8)):null,
        position:vector(position),castShadow:Boolean(light.castShadow)};
      if(light.groundColor?.isColor)item.groundColor=color(light.groundColor);
      for(const key of ['distance','decay','angle','penumbra'])if(Number.isFinite(light[key]))item[key]=Number(light[key].toPrecision(8));
      if(light.target?.isObject3D){light.target.getWorldPosition(target);item.target=vector(target);
        direction.copy(target).sub(position);if(direction.lengthSq()>1e-12)item.direction=vector(direction.normalize());}
      if(light.shadow?.mapSize)item.shadow={mapSize:[light.shadow.mapSize.x,light.shadow.mapSize.y],
        bias:Number.isFinite(light.shadow.bias)?light.shadow.bias:null,
        normalBias:Number.isFinite(light.shadow.normalBias)?light.shadow.normalBias:null,
        radius:Number.isFinite(light.shadow.radius)?light.shadow.radius:null};
      items.push(item);
    },
    result(complete=true){return {items,truncated:truncated||!complete};}
  };
}
