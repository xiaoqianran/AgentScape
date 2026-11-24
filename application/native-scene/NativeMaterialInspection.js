// Only return stable, bounded scalar metadata. Texture pixels, source URLs,
// shader source and arbitrary userData are deliberately not serialized.
const MAX_MATERIALS=32,MAX_SLOTS=16;
const textureKeys=['map','normalMap','roughnessMap','metalnessMap','aoMap','emissiveMap','alphaMap','bumpMap','displacementMap','envMap','lightMap','clearcoatMap','clearcoatNormalMap','clearcoatRoughnessMap','transmissionMap','thicknessMap','specularMap','specularColorMap','specularIntensityMap','sheenColorMap','sheenRoughnessMap','iridescenceMap','iridescenceThicknessMap','anisotropyMap'];
const scalarKeys=['roughness','metalness','opacity','alphaTest','transparent','depthWrite','depthTest','visible','side','vertexColors','wireframe','emissiveIntensity','clearcoat','clearcoatRoughness','transmission','thickness','ior','reflectivity','anisotropy','iridescence','sheen','sheenRoughness','displacementScale'];
const colorKeys=['color','emissive','sheenColor','specularColor','attenuationColor'];
const short=s=>String(s??'').slice(0,120);
const number=n=>Number.isFinite(n)?Number(n.toPrecision(8)):null;
function textureInfo(texture){
  const image=texture.image;
  const first=Array.isArray(image)?image[0]:image;
  const width=first?.videoWidth||first?.naturalWidth||first?.width;
  const height=first?.videoHeight||first?.naturalHeight||first?.height;
  return {name:short(texture.name),type:texture.isCubeTexture?'CubeTexture':texture.isVideoTexture?'VideoTexture':texture.isDataTexture?'DataTexture':'Texture',
    width:Number.isFinite(width)?width:null,height:Number.isFinite(height)?height:null,
    colorSpace:short(texture.colorSpace),...(texture.repeat?.isVector2?{repeat:texture.repeat.toArray().map(number)}:{})};
}
function summarizeMaterial(material){
  const result={name:short(material.name),type:short(material.type),textures:{}};
  for(const key of scalarKeys){
    const value=material[key];
    if(typeof value==='boolean')result[key]=value;
    else if(Number.isFinite(value))result[key]=number(value);
  }
  for(const key of colorKeys)if(material[key]?.isColor)result[key]='#'+material[key].getHexString();
  for(const key of textureKeys)if(material[key]?.isTexture)result.textures[key]=textureInfo(material[key]);
  if(material.isShaderMaterial||material.isRawShaderMaterial)result.customShader=true;
  return result;
}
export function createMaterialInventory(){
  const entries=new Map();let truncated=false;
  return {
    add(object,visible){
      const materials=Array.isArray(object.material)?object.material:[object.material];
      if(materials.length>MAX_SLOTS)truncated=true;
      const seen=new Set();
      for(const material of materials.slice(0,MAX_SLOTS)){
        if(!material?.isMaterial||seen.has(material))continue;
        seen.add(material);
        let item=entries.get(material);
        if(!item){
          if(entries.size>=MAX_MATERIALS){truncated=true;continue;}
          item={...summarizeMaterial(material),objects:0,visibleObjects:0};
          entries.set(material,item);
        }
        item.objects++;
        if(visible&&material.visible!==false)item.visibleObjects++;
      }
    },
    result(complete=true){return {items:[...entries.values()],truncated:truncated||!complete};}
  };
}
