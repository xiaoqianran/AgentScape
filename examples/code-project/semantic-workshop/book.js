import * as THREE from 'three';

export function makeBook() {
  const object=new THREE.Group();object.name='InteractiveBook';object.position.set(-1.65,.12,.1);
  const coverMaterial=new THREE.MeshStandardMaterial({color:'#3475a9',roughness:.65});
  const paperMaterial=new THREE.MeshStandardMaterial({color:'#f6eed7',roughness:.94,side:THREE.DoubleSide});
  const spine=new THREE.Mesh(new THREE.BoxGeometry(.09,.2,1),coverMaterial);
  spine.position.set(-.52,.10,0);object.add(spine);
  const back=new THREE.Mesh(new THREE.BoxGeometry(1.1,.055,.98),coverMaterial);
  back.position.y=.025;object.add(back);
  const cover=new THREE.Group();cover.name='BookCoverHinge';cover.position.set(-.52,.12,0);
  const front=new THREE.Mesh(new THREE.BoxGeometry(1.05,.04,.98),coverMaterial);
  front.position.set(.52,.04,0);cover.add(front);object.add(cover);
  const pages=Array.from({length:5},(_,index)=>{
    const hinge=new THREE.Group();hinge.name='Page_'+(index+1);
    hinge.position.set(-.52,.085+index*.014,0);
    const sheet=new THREE.Mesh(new THREE.BoxGeometry(1.01,.008,.92),paperMaterial);
    sheet.position.x=.505;hinge.add(sheet);object.add(hinge);
    return hinge;
  });
  const angle=state=>state.cover==='open'?-2.5:0;
  const render=state=>{
    cover.rotation.z=angle(state);
    pages.forEach((page,index)=>{page.rotation.y=index<state.page?-Math.PI:0;});
  };
  const verify=state=>
    Math.abs(cover.rotation.z-angle(state))<1e-5
    && pages.every((page,index)=>Math.abs(page.rotation.y-(index<state.page?-Math.PI:0))<1e-5);
  const machine={
    id:'book_01',label:'可翻页的书籍',description:'真实独立书页网格，状态机控制封面与页码。',
    object,
    initialState:{cover:'closed',page:0,pages:pages.length},
    ranges:{page:{min:0,max:pages.length}},
    transitions:[
      {name:'openBook',description:'打开封面',when:[{field:'cover',op:'eq',value:'closed'}],
        effects:[{field:'cover',op:'set',value:'open'}]},
      {name:'turnPage',description:'把一页真实网格翻到左侧',when:[
        {field:'cover',op:'eq',value:'open'},{field:'page',op:'lt',other:'pages'}],
        effects:[{field:'page',op:'add',value:1}]},
      {name:'turnBack',description:'把上一页翻回右侧',when:[
        {field:'cover',op:'eq',value:'open'},{field:'page',op:'gt',value:0}],
        effects:[{field:'page',op:'add',value:-1}]},
      {name:'closeBook',description:'合上封面，需先翻回第一页',when:[
        {field:'cover',op:'eq',value:'open'},{field:'page',op:'eq',value:0}],
        effects:[{field:'cover',op:'set',value:'closed'}]}
    ],
    onChange:render,verifyVisual:verify
  };
  return {object,pages,cover,machine};
}
