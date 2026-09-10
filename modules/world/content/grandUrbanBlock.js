import * as THREE from 'three';

export const GRAND_URBAN_BLOCK_ASSETS = Object.freeze({
  hdri:'assets/grand-urban-block/urban_street_01_1k.hdr',
  asphaltDiffuse:'assets/grand-urban-block/clean_asphalt_diff_1k.jpg',
  asphaltNormal:'assets/grand-urban-block/clean_asphalt_nor_gl_1k.jpg',
  pavementDiffuse:'assets/grand-urban-block/concrete_pavement_diff_1k.jpg'
});

const box = (halfExtents, translation) => ({ shape:'box', halfExtents, translation });
const PADS = [[-27,-21.5],[27,-21.5],[-27,21.5],[27,21.5]];
const BUILDINGS = Object.freeze([
  [-35,-25,12,14,18,0],[-21,-25,10,14,26,1],[-30,-11,20,7,12,2],
  [22,-25,11,14,20,1],[36,-25,12,14,30,2],[29,-11,22,7,14,0],
  [-35,25,12,14,22,2],[-21,25,10,14,16,0],[-30,11,20,7,28,1],
  [22,25,11,14,18,0],[36,25,12,14,24,1],[29,11,22,7,13,2]
]);

export const GRAND_URBAN_BLOCK_COLLIDERS = Object.freeze([
  box([48,.15,36],[0,-.15,0]),
  ...PADS.map(([x,z])=>box([18,.12,14.5],[x,.12,z])),
  box([9,.08,9],[0,.08,0]),
  ...BUILDINGS.map(([x,z,w,d,h])=>box([w/2,h/2,d/2],[x,.24+h/2,z])),
  { shape:'cylinder', radius:2.2, halfHeight:1.8, translation:[0,1.96,0] }
]);

const mesh = (geometry, material, { position, name, castShadow=true, receiveShadow=true, navigationIgnore=false }={}) => {
  const value=new THREE.Mesh(geometry,material);
  if(position) value.position.set(...position);
  value.name=name||'';
  value.castShadow=castShadow;
  value.receiveShadow=receiveShadow;
  if(navigationIgnore) value.userData.navigationIgnore=true;
  return value;
};

const tile = (texture, repeat, color=false) => {
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy=4;
  if(color) texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
};

const addRoadMarkings = (root) => {
  const material=new THREE.MeshBasicMaterial({color:0xe7e0c4});
  const geometry=new THREE.BoxGeometry(.18,.012,2.2);
  const items=[];
  for(let z=-31;z<=31;z+=5.5) items.push([0,.012,z,0]);
  for(let x=-43;x<=43;x+=5.5) items.push([x,.012,0,Math.PI/2]);
  const lines=new THREE.InstancedMesh(geometry,material,items.length);
  lines.name='LaneMarkings'; lines.userData.navigationIgnore=true; lines.userData.decorative=true;
  const matrix=new THREE.Matrix4(), quaternion=new THREE.Quaternion(), scale=new THREE.Vector3(1,1,1);
  items.forEach(([x,y,z,r],i)=>{
    quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),r);
    matrix.compose(new THREE.Vector3(x,y,z),quaternion,scale);
    lines.setMatrixAt(i,matrix);
  });
  lines.instanceMatrix.needsUpdate=true;
  root.add(lines);
};

const addFacadeWindows = (root) => {
  const material=new THREE.MeshBasicMaterial({color:0xb7cae5,toneMapped:false,transparent:true,opacity:.68,side:THREE.DoubleSide});
  const geometry=new THREE.PlaneGeometry(.9,.52);
  const transforms=[];
  for(const [x,z,w,d,h] of BUILDINGS){
    const floors=Math.max(3,Math.floor((h-2)/2.5));
    const columns=Math.max(3,Math.floor(d/3));
    const innerX=x<0?x+w/2+.012:x-w/2-.012;
    const rotation=x<0?Math.PI/2:-Math.PI/2;
    for(let floor=0;floor<floors;floor++){
      for(let col=0;col<columns;col++){
        const zz=z-d*.38+(col/(Math.max(1,columns-1)))*d*.76;
        transforms.push([innerX,1.8+floor*2.5,zz,rotation]);
      }
    }
  }
  const windows=new THREE.InstancedMesh(geometry,material,transforms.length);
  windows.name='FacadeWindows'; windows.userData.navigationIgnore=true;
  const matrix=new THREE.Matrix4(), quaternion=new THREE.Quaternion(), scale=new THREE.Vector3(1,1,1);
  transforms.forEach(([x,y,z,r],i)=>{
    quaternion.setFromAxisAngle(new THREE.Vector3(0,1,0),r);
    matrix.compose(new THREE.Vector3(x,y,z),quaternion,scale);
    windows.setMatrixAt(i,matrix);
  });
  windows.instanceMatrix.needsUpdate=true;
  root.add(windows);
};

const addStreetFurniture = (root) => {
  const poleGeometry=new THREE.CylinderGeometry(.055,.075,3.6,8);
  const poleMaterial=new THREE.MeshStandardMaterial({color:0x232a31,roughness:.4,metalness:.72});
  const lampGeometry=new THREE.SphereGeometry(.12,8,6);
  const lampMaterial=new THREE.MeshBasicMaterial({color:0xffd899,toneMapped:false});
  const locations=[];
  for(let z=-28;z<=28;z+=8) locations.push([-6.8,z],[6.8,z]);
  for(let x=-40;x<=40;x+=10) locations.push([x,-5.2],[x,5.2]);
  const poles=new THREE.InstancedMesh(poleGeometry,poleMaterial,locations.length);
  const lamps=new THREE.InstancedMesh(lampGeometry,lampMaterial,locations.length);
  poles.name='StreetlightPoles'; lamps.name='StreetlightLamps';
  poles.userData.navigationIgnore=lamps.userData.navigationIgnore=true; poles.userData.decorative=lamps.userData.decorative=true;
  const matrix=new THREE.Matrix4();
  locations.forEach(([x,z],i)=>{
    matrix.makeTranslation(x,2,z); poles.setMatrixAt(i,matrix);
    matrix.makeTranslation(x,3.86,z); lamps.setMatrixAt(i,matrix);
  });
  poles.instanceMatrix.needsUpdate=lamps.instanceMatrix.needsUpdate=true;
  root.add(poles,lamps);

  const trunkGeometry=new THREE.CylinderGeometry(.11,.15,2.2,7);
  const trunkMaterial=new THREE.MeshStandardMaterial({color:0x4a3828,roughness:1});
  const crownGeometry=new THREE.IcosahedronGeometry(.85,1);
  const crownMaterial=new THREE.MeshStandardMaterial({color:0x455f46,roughness:.95});
  const trees=[[-42,-15],[-42,15],[42,-15],[42,15],[-12,-30],[12,-30],[-12,30],[12,30],[-13,-8],[13,-8],[-13,8],[13,8]];
  const trunks=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
  const crowns=new THREE.InstancedMesh(crownGeometry,crownMaterial,trees.length);
  trunks.name='StreetTrees'; crowns.name='StreetTreeCrowns';
  trunks.userData.navigationIgnore=crowns.userData.navigationIgnore=true; trunks.userData.decorative=crowns.userData.decorative=true;
  trees.forEach(([x,z],i)=>{
    matrix.makeTranslation(x,1.1,z); trunks.setMatrixAt(i,matrix);
    matrix.makeTranslation(x,2.75,z); crowns.setMatrixAt(i,matrix);
  });
  trunks.instanceMatrix.needsUpdate=crowns.instanceMatrix.needsUpdate=true;
  root.add(trunks,crowns);
};

export function createGrandUrbanBlock({loadAssets=true}={}){
  const root=new THREE.Group();
  root.name='GrandUrbanBlock'; root.userData.environment='grand-urban-block';

  const asphalt=new THREE.MeshStandardMaterial({color:0x343a3e,roughness:.92});
  const pavement=new THREE.MeshStandardMaterial({color:0x848680,roughness:.9});
  const buildingMaterials=[
    new THREE.MeshStandardMaterial({color:0x777d84,roughness:.72,metalness:.04}),
    new THREE.MeshStandardMaterial({color:0x555f69,roughness:.68,metalness:.08}),
    new THREE.MeshStandardMaterial({color:0x8b8177,roughness:.78,metalness:.02})
  ];
  const darkMetal=new THREE.MeshStandardMaterial({color:0x202934,roughness:.32,metalness:.78});
  const beaconGlow=new THREE.MeshBasicMaterial({color:0x86b7ff,toneMapped:false});

  const floor=mesh(new THREE.BoxGeometry(96,.3,72),asphalt,{position:[0,-.15,0],name:'UrbanGround',castShadow:false});
  root.add(floor);
  for(const [x,z] of PADS) root.add(mesh(new THREE.BoxGeometry(36,.24,29),pavement,{position:[x,.12,z],name:`CityBlock_${x}_${z}`,castShadow:false}));
  root.add(mesh(new THREE.BoxGeometry(18,.16,18),pavement,{position:[0,.08,0],name:'CentralPlaza',castShadow:false}));

  for(const [x,z,w,d,h,materialIndex] of BUILDINGS){
    root.add(mesh(new THREE.BoxGeometry(w,h,d),buildingMaterials[materialIndex],{position:[x,.24+h/2,z],name:`Building_${x}_${z}`}));
    root.add(mesh(new THREE.BoxGeometry(w*.62,.35,d*.56),darkMetal,{position:[x,.24+h+.175,z],name:'RooftopPlant',navigationIgnore:true}));
  }

  const beacon=mesh(new THREE.CylinderGeometry(2.2,2.45,3.6,32),darkMetal,{position:[0,1.96,0],name:'CivicBeacon'});
  const halo=mesh(new THREE.TorusGeometry(2.75,.07,10,64),beaconGlow,{position:[0,3.35,0],name:'BeaconHalo',castShadow:false,receiveShadow:false,navigationIgnore:true});
  halo.rotation.x=Math.PI/2;
  root.add(beacon,halo);

  addRoadMarkings(root);
  addFacadeWindows(root);
  addStreetFurniture(root);

  const hemi=new THREE.HemisphereLight(0xd7e2ef,0x27313a,1.6);
  const sun=new THREE.DirectionalLight(0xffe3bd,3.4);
  sun.position.set(-28,42,22); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera,{left:-58,right:58,top:48,bottom:-48,near:2,far:110});
  const cityFill=new THREE.DirectionalLight(0x7ca4d8,1.15); cityFill.position.set(36,18,-32);
  const beaconLight=new THREE.PointLight(0x79aaff,38,22,1.5); beaconLight.position.set(0,4.6,0);
  root.add(hemi,sun,cityFill,beaconLight);

  let active=true;
  const loader=loadAssets?new THREE.TextureLoader():null;
  const loadTexture=(url,configure,apply)=>loader?.load(url,(texture)=>{
    if(!active){texture.dispose();return;}
    configure?.(texture); apply(texture);
  });
  if(loadAssets){
    loadTexture(GRAND_URBAN_BLOCK_ASSETS.asphaltDiffuse,(t)=>tile(t,[28,20],true),(t)=>{asphalt.map=t;asphalt.needsUpdate=true;});
    loadTexture(GRAND_URBAN_BLOCK_ASSETS.asphaltNormal,(t)=>tile(t,[28,20]),(t)=>{asphalt.normalMap=t;asphalt.normalScale.set(.28,.28);asphalt.needsUpdate=true;});
    loadTexture(GRAND_URBAN_BLOCK_ASSETS.pavementDiffuse,(t)=>tile(t,[12,9],true),(t)=>{pavement.map=t;pavement.needsUpdate=true;});
  }

  return {
    id:'grand-urban-block',root,floor,
    colliders:GRAND_URBAN_BLOCK_COLLIDERS.map((value)=>structuredClone(value)),
    layout:{bounds:{min:[-47,-35],max:[47,35]},groundY:0,margin:1.5},
    camera:{position:[52,36,58],target:[0,4,0],far:190},
    rendering:{background:0x66717d,fog:{color:0x66717d,near:58,far:155},exposure:1.04, ibl:loadAssets?{url:GRAND_URBAN_BLOCK_ASSETS.hdri,intensity:1}:null },
    dispose(){active=false;}
  };
}
