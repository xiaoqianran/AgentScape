import * as THREE from 'three';

export function makeCooker() {
  const object=new THREE.Group();object.name='InteractiveRiceCooker';object.position.set(1.75,0,0);
  const shell=new THREE.Mesh(new THREE.CylinderGeometry(.57,.54,.64,36),
    new THREE.MeshStandardMaterial({color:'#c9d2dc',metalness:.4,roughness:.46}));
  shell.position.y=.4;object.add(shell);
  const inside=new THREE.Mesh(new THREE.CylinderGeometry(.45,.45,.035,36),
    new THREE.MeshStandardMaterial({color:'#313b46',metalness:.35}));
  inside.position.y=.73;object.add(inside);
  const hinge=new THREE.Group();hinge.name='CookerLidHinge';
  hinge.position.set(0,.75,-.5);object.add(hinge);
  const lid=new THREE.Mesh(new THREE.CylinderGeometry(.6,.6,.09,36),
    new THREE.MeshStandardMaterial({color:'#eef2f7',metalness:.3,roughness:.4}));
  lid.position.z=.5;hinge.add(lid);
  const handle=new THREE.Mesh(new THREE.BoxGeometry(.25,.08,.14),
    new THREE.MeshStandardMaterial({color:'#343a42'}));
  handle.position.set(0,.09,.89);hinge.add(handle);

  const bowl=new THREE.Mesh(new THREE.CylinderGeometry(.32,.26,.07,24),
    new THREE.MeshStandardMaterial({color:'#668ea2',metalness:.2}));
  bowl.position.set(-.85,.12,.65);object.add(bowl);
  // This SAME Three.js mesh moves from the ingredient tray into the pot.
  const rice=new THREE.Mesh(new THREE.SphereGeometry(.24,18,12),
    new THREE.MeshStandardMaterial({color:'#e3d7aa',roughness:.94}));
  rice.name='RicePortion';object.add(rice);
  const indicator=new THREE.Mesh(new THREE.SphereGeometry(.065,14,12),
    new THREE.MeshStandardMaterial({color:0x55606f,emissive:0x0a141b,roughness:.5}));
  indicator.position.set(0,.35,.56);object.add(indicator);
  const steam=Array.from({length:3},(_,index)=>{
    const puff=new THREE.Mesh(new THREE.SphereGeometry(.07,10,8),
      new THREE.MeshStandardMaterial({color:'#d2efff',transparent:true,opacity:.48}));
    puff.position.set((index-1)*.18,1.15+index*.14,0);object.add(puff);return puff;
  });

  const pos=state=>state.contents==='empty'?[-.85,.22,.65]:[0,.83,0];
  const light=state=>state.mode==='cooking'?0xe84f36:state.mode==='done'?0x4bbc74:0x55606f;
  const render=state=>{
    hinge.rotation.x=state.lid==='open'?-1.34:0;
    rice.position.set(...pos(state));
    rice.material.color.setHex(state.contents==='cooked'?0xfff3cb:0xe3d7aa);
    indicator.material.color.setHex(light(state));
    steam.forEach(puff=>{puff.visible=state.mode==='cooking';});
  };
  const verify=state=>{
    const [x,y,z]=pos(state);
    return Math.abs(hinge.rotation.x-(state.lid==='open'?-1.34:0))<1e-5
      && rice.position.distanceTo(new THREE.Vector3(x,y,z))<1e-5
      && indicator.material.color.getHex()===light(state)
      && steam.every(puff=>puff.visible===(state.mode==='cooking'));
  };
  const machine={
    id:'cooker_01',label:'可操作的电饭煲',
    description:'锅盖铰链、同一个米饭物体的移动、烹饪计时与灯光状态。',
    object,
    initialState:{lid:'closed',contents:'empty',mode:'idle',elapsed:0},
    ranges:{elapsed:{min:0,max:3}},
    transitions:[
      {name:'openLid',description:'打开真实锅盖铰链，烹饪中禁止打开',
        when:[{field:'lid',op:'eq',value:'closed'},{field:'mode',op:'ne',value:'cooking'}],
        effects:[{field:'lid',op:'set',value:'open'}]},
      {name:'closeLid',description:'关闭真实锅盖铰链',
        when:[{field:'lid',op:'eq',value:'open'}],
        effects:[{field:'lid',op:'set',value:'closed'}]},
      {name:'addRice',description:'把米饭网格从托盘移动到内锅，必须先开盖',
        when:[{field:'lid',op:'eq',value:'open'},{field:'contents',op:'eq',value:'empty'},
          {field:'mode',op:'eq',value:'idle'}],
        effects:[{field:'contents',op:'set',value:'rice'}]},
      {name:'removeRice',description:'烹饪前可取出食材',
        when:[{field:'lid',op:'eq',value:'open'},{field:'contents',op:'eq',value:'rice'},
          {field:'mode',op:'eq',value:'idle'}],
        effects:[{field:'contents',op:'set',value:'empty'}]},
      {name:'startCook',description:'只有食材已入锅、锅盖闭合才能启动计时烹饪',
        when:[{field:'lid',op:'eq',value:'closed'},{field:'contents',op:'eq',value:'rice'},
          {field:'mode',op:'eq',value:'idle'}],
        effects:[{field:'mode',op:'set',value:'cooking'},{field:'elapsed',op:'set',value:0}]},
      {name:'completeCook',expose:false,
        when:[{field:'mode',op:'eq',value:'cooking'},{field:'elapsed',op:'gte',value:3}],
        effects:[{field:'mode',op:'set',value:'done'},{field:'contents',op:'set',value:'cooked'}]},
      {name:'serveRice',description:'烹饪完成后开盖取饭，恢复空锅',
        when:[{field:'lid',op:'eq',value:'open'},{field:'contents',op:'eq',value:'cooked'},
          {field:'mode',op:'eq',value:'done'}],
        effects:[{field:'contents',op:'set',value:'empty'},{field:'mode',op:'set',value:'idle'},
          {field:'elapsed',op:'set',value:0}]}
    ],
    timers:[{field:'elapsed',rate:1,max:3,when:[{field:'mode',op:'eq',value:'cooking'}],onComplete:'completeCook'}],
    onChange:render,verifyVisual:verify
  };
  return {object,hinge,rice,indicator,steam,machine};
}
