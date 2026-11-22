export async function createProject({THREE,container,state}){
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#101c32');
  scene.fog=new THREE.FogExp2('#27364c',0.0033);
  const camera=new THREE.PerspectiveCamera(48,1,0.1,600);
  camera.position.set(87,60,128);
  camera.lookAt(0,23,-22);
  const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'default'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.5;
  container.appendChild(renderer.domElement);
  const hemi=new THREE.HemisphereLight('#adc7ff','#536045',2.4);scene.add(hemi);
  const moon=new THREE.DirectionalLight('#c5d1ff',2.8);moon.position.set(-75,120,40);scene.add(moon);
  const warm=new THREE.PointLight('#ffbf70',90,120);warm.position.set(0,22,4);scene.add(warm);
  const makeMat=(color,roughness=0.94,metalness=0)=>new THREE.MeshStandardMaterial({color,roughness,metalness});
  const stone=makeMat('#858b99'),stoneLight=makeMat('#afb2bf'),stoneDark=makeMat('#595f71');
  const slate=makeMat('#252f49',0.81),roofTrim=makeMat('#414a62');
  const grass=makeMat('#33493c'),moss=makeMat('#4d6a48'),path=makeMat('#9b9185');
  const bark=makeMat('#433b38'),pine=makeMat('#1d3939'),pine2=makeMat('#2d5045');
  const wood=makeMat('#4a3029'),gold=makeMat('#c6a06a',0.55,0.32);
  const glass=new THREE.MeshStandardMaterial({color:'#ffc87d',emissive:'#ffab49',emissiveIntensity:2.8,roughness:0.4});
  const waterMat=new THREE.MeshStandardMaterial({color:'#21445d',roughness:0.25,metalness:0.28,transparent:true,opacity:0.84,side:THREE.DoubleSide});
  const basic=(geo,mat,x,y,z,parent=scene)=>{const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);parent.add(m);return m;};
  const box=(w,h,d,x,y,z,m,parent=scene)=>basic(new THREE.BoxGeometry(w,h,d),m,x,y,z,parent);
  const cyl=(r1,r2,h,x,y,z,m,seg=12,parent=scene)=>basic(new THREE.CylinderGeometry(r1,r2,h,seg),m,x,y,z,parent);
  const cone=(r,h,x,y,z,m,seg=8,parent=scene)=>basic(new THREE.ConeGeometry(r,h,seg),m,x,y,z,parent);
  const sphere=(r,x,y,z,m)=>basic(new THREE.SphereGeometry(r,10,7),m,x,y,z);
  const groups={};
  const group=(id)=>{const g=new THREE.Group();g.name=id;scene.add(g);groups[id]=g;return g;};
  const keep=group('grand_keep'),towers=group('astronomy_towers'),entrance=group('grand_gate'),bridge=group('moonlit_bridge'),lands=group('enchanted_grounds');
  const lake=group('silver_lake');
  const plain=basic(new THREE.PlaneGeometry(600,600),grass,0,-0.45,0,lands);plain.rotation.x=-Math.PI/2;
  const water=basic(new THREE.PlaneGeometry(220,145),waterMat,0,1.3,-18,lake);water.rotation.x=-Math.PI/2;
  const groundIsland=cyl(67,74,7,0,3.6,-23,stoneDark,36,lands);
  cyl(65,67,1.8,0,7.4,-23,moss,36,lands);
  cyl(62,64,0.6,0,8.5,-23,grass,36,lands);
  // Rocky escarpment around the college island.
  for(let i=0;i<32;i++){
    const a=i*Math.PI*2/32,r=68+Math.sin(i*3)*3;
    const rock=cyl(4+Math.sin(i*11)*1.4,6,9,Math.cos(a)*r,4,-23+Math.sin(a)*r,stoneDark,5,lands);
    rock.rotation.y=a;
  }
  // Castle's central quadrangle, hall and three wings.
  box(51,24,23,0,21,-28,stone,keep);
  box(43,1.1,24,0,33.5,-28,stoneLight,keep);
  box(25,20,19,-35,19,-20,stone,keep);
  box(25,20,19,35,19,-20,stone,keep);
  box(29,18,19,-22,18,-43,stoneDark,keep);
  box(29,18,19,22,18,-43,stoneDark,keep);
  box(26,26,17,0,21,-57,stone,keep);
  // Slate pitched roofs, ridge aligned along X.
  function pitchedRoof(x,y,z,w,d,peak,parent){
    const slope=Math.hypot(d/2+1.2,peak);
    for(const sign of [-1,1]){
      const panel=box(w+2,0.85,slope,x,y+peak/2,z+sign*d/4,slate,parent);
      panel.rotation.x=sign*Math.atan2(peak,d/2+1.2);
    }
    box(w+2.4,0.65,0.85,x,y+peak,z,roofTrim,parent);
  }
  pitchedRoof(0,34,-28,53,24,8,keep);
  pitchedRoof(-35,29,-20,26,19,7,keep);
  pitchedRoof(35,29,-20,26,19,7,keep);
  pitchedRoof(0,35,-57,27,17,9,keep);
  function battlements(x,y,z,count,spacing,parent){
    for(let i=0;i<count;i++)box(spacing*.63,2.4,2.4,x+(i-(count-1)/2)*spacing,y,z,stoneLight,parent);
  }
  battlements(0,35.7,-14.6,15,3.3,keep);
  battlements(0,35.7,-41.1,15,3.3,keep);
  // Tall square central library and bell tower.
  box(16,39,16,0,44,-57,stoneLight,towers);
  box(18,2,18,0,64,-57,stoneDark,towers);
  battlements(0,65.9,-48.3,7,2.5,towers);
  pitchedRoof(0,65,-57,18,18,15,towers);
  cone(1.5,9,0,88,-57,gold,8,towers);
  sphere(2.3,0,95,-57,gold);
  // Flying turret silhouettes and conical spires.
  function turret(x,z,r,h,spire,material=stone){
    const y=8.8+h/2;
    cyl(r,r+0.4,h,x,y,z,material,12,towers);
    cyl(r+1.3,r+1.3,1.5,x,9+h,z,stoneLight,12,towers);
    for(let k=0;k<12;k++){
      const a=k*Math.PI/6;
      box(1.6,2.4,1.6,x+(r+.5)*Math.cos(a),10.5+h,z+(r+.5)*Math.sin(a),stoneLight,towers).rotation.y=a;
    }
    cone(r+2,spire,x,10.6+h+spire/2,z,slate,12,towers);
    cyl(.25,.25,5,x,12+h+spire,z,gold,8,towers);
    sphere(.72,x,14.5+h+spire,z,gold);
  }
  turret(-28,-10,7.0,38,18);
  turret(28,-10,7.0,36,19);
  turret(-53,-29,8.0,40,22);
  turret(53,-29,8.0,44,23);
  turret(-24,-52,5.5,45,21,stoneLight);
  turret(25,-54,5.2,43,18,stoneLight);
  turret(-6,-72,4.2,31,14,stoneDark);
  turret(7,-73,4.2,34,15,stoneDark);
  // Stone arcade and castle gate on the bridge axis.
  box(31,16,9,0,16,-4,stoneDark,entrance);
  battlements(0,25,-.3,9,3.45,entrance);
  const gateFrame=box(11.5,14,1.3,0,15.2,0.95,stoneLight,entrance);
  const doorway=box(9.3,12,1.7,0,14.1,1.9,wood,entrance);
  const gateArch=basic(new THREE.TorusGeometry(5.3,0.9,8,22,Math.PI),stoneLight,0,20.2,1.2,entrance);
  const leftDoor=box(4.2,11.4,1.3,-2.15,13.8,3.0,wood,entrance);
  const rightDoor=box(4.2,11.4,1.3,2.15,13.8,3.0,wood,entrance);
  for(const dx of [-4,-2,0,2,4])box(.18,11.2,.25,dx,14,3.75,gold,entrance);
  // Gothic backlit windows, mullions and tiny masonry arches.
  let windowCount=0;
  function windowGlow(x,y,z,w=1.8,h=3.7,parent=keep){
    box(w+.8,h+.7,.75,x,y,z,stoneDark,parent);
    box(w,h,.25,x,y,z+.48,glass,parent);
    box(.28,h,.35,x,y,z+.73,gold,parent);
    box(w+.1,.23,.38,x,y,z+.75,gold,parent);
    const top=basic(new THREE.CircleGeometry(w/2,16,0,Math.PI),glass,x,y+h/2,z+.51,parent);
    top.rotation.z=Math.PI;
    windowCount++;
  }
  for(const x of [-20,-14,-8,8,14,20]){
    for(const y of [16,24,31])windowGlow(x,y,-15.85,1.6,3.1,keep);
  }
  for(const x of [-45,-39,-32,32,39,45]){
    for(const y of [17,24])windowGlow(x,y,-9.95,1.55,3.0,keep);
  }
  for(const x of [-8,0,8])for(const y of [17,25,32])windowGlow(x,y,-47.1,1.7,3.1,keep);
  // Central rose window and clock dials.
  const rose=basic(new THREE.RingGeometry(3.5,4.6,24),gold,0,31,-15.0,keep);
  const roseGlass=basic(new THREE.CircleGeometry(3.6,24),glass,0,31,-15.15,keep);
  rose.position.z=-15.04;
  for(let k=0;k<8;k++){
    const a=k*Math.PI/4;
    const bar=box(.18,3.3,.22,Math.sin(a)*1.5,31+Math.cos(a)*1.5,-14.7,gold,keep);
    bar.rotation.z=-a;
  }
  // Flying buttresses and massive stone stairway.
  for(const sx of [-1,1])for(const z of [-30,-20,-10]){
    box(2.5,18,3,sx*27,18,z,stoneLight,keep);
    const buttress=box(3.2,1.8,14,sx*31.5,22,z,stoneLight,keep);
    buttress.rotation.z=sx*-.48;
  }
  for(let k=0;k<8;k++)box(17+k*.5,.55,2.8,0,8.6+k*.63,8+k*2.1,path,entrance);
  // High-arched moon bridge over the lake, stone balustrades and street lamps.
  box(15,1.5,63,0,8.9,47,path,bridge);
  for(const sx of [-1,1]){
    box(.8,2.8,63,sx*7.8,10.6,47,stoneLight,bridge);
    for(let z=19;z<80;z+=9){
      box(1.9,3,2,sx*7.8,10.9,z,stone,bridge);
      const post=cyl(.28,.45,5,sx*8,15,z,stoneDark,8,bridge);
      box(1.4,1.4,1.4,sx*8,18,z,glass,bridge);
      cone(1.2,1.9,sx*8,19.5,z,slate,4,bridge);
    }
  }
  for(let z=20;z<75;z+=14)for(const sx of [-1,1])cyl(1.6,2.4,7,sx*6,4.4,z,stoneDark,8,bridge);
  // Mountain ranges, evergreen woods and an ancient curved approach road.
  const mt1=makeMat('#354354'),mt2=makeMat('#47556b'),mt3=makeMat('#253743');
  for(let k=0;k<25;k++){
    const x=-235+k*20;
    const height=42+25*(.5+.5*Math.sin(k*5.73));
    cone(18+4*Math.sin(k*3),height,x,height/2-2,-150-20*Math.sin(k*2),k%3===0?mt2:mt1,5,lands);
  }
  function tree(x,z,r=1){
    const y=0.4;
    cyl(.45*r,.62*r,5.2*r,x,y+2*r,z,bark,6,lands);
    for(let i=0;i<3;i++)cone((4.4-i*.75)*r,8*r,x,y+(5.5+i*2.7)*r,z,i%2?pine2:pine,7,lands);
  }
  for(let i=0;i<150;i++){
    const a=i*2.39996,r=90+27*Math.sin(i*4.3);
    const x=Math.cos(a)*r,z=-23+Math.sin(a)*r;
    if(Math.abs(x)<24 && z>45)continue;
    tree(x,z,.56+(i%7)*.12);
  }
  // Torchlight and golden fireflies.
  const glows=[];
  const fireflyMat=new THREE.MeshBasicMaterial({color:'#f6cf8c'});
  for(let i=0;i<42;i++){
    const a=i*2.4,r=22+(i%7)*7;
    const glint=sphere(.2+(i%3)*.1,Math.cos(a)*r,5+(i%9)*1.4,32+Math.sin(a)*r,fireflyMat);
    glows.push(glint);
  }
  const lanterns=new THREE.Group();scene.add(lanterns);
  for(const sx of [-1,1])for(const z of [-2,17,42,70]){
    const l=new THREE.PointLight('#ffb65d',7.5,17,1.6);
    l.position.set(sx*8,18,z);lanterns.add(l);
  }
  // Pale moon and stars.
  const moonMaterial=new THREE.MeshBasicMaterial({color:'#e3e9ff'});
  sphere(8,-125,102,-155,moonMaterial);
  const stars=[];
  for(let i=0;i<260;i++){
    const theta=i*2.39996,rr=190+50*((i*17)%13)/13;
    const x=Math.cos(theta)*rr,y=45+((i*43)%140),z=-140-Math.abs(Math.sin(theta)*100);
    stars.push(x,y,z);
  }
  const sg=new THREE.BufferGeometry();
  sg.setAttribute('position',new THREE.Float32BufferAttribute(stars,3));
  scene.add(new THREE.Points(sg,new THREE.PointsMaterial({size:1.2,color:'#d0ddff',sizeAttenuation:false})));
  // Title plaque in the world: original fictional college, no licensed insignia.
  const flags=[];
  for(const x of [-53,53,0]){
    const z=x===0?-57:-29,y=x===0?93:83;
    cyl(.2,.2,7,x,y,z,gold,8,towers);
    const flag=box(4,2.4,.08,x+2,y+2,z,makeMat(x===0?'#775f86':'#567b81'),towers);
    flags.push(flag);
  }
  const resize=new ResizeObserver(()=>{
    const width=Math.max(1,container.clientWidth),height=Math.max(1,container.clientHeight);
    renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
  });
  resize.observe(container);
  let lanternsOn=state?.lanternsOn??true;
  lanterns.visible=lanternsOn;
  return {
    scene,camera,renderer,
    setup({scene:api}){
      for(const [id,label] of [
        ['grand_keep','魔法学院中央大厅'],['astronomy_towers','星象观测塔群'],
        ['grand_gate','石砌学院正门'],['moonlit_bridge','月光石桥'],
        ['enchanted_grounds','环山松林与高地'],['silver_lake','银月湖']]){
        api.registerEntity({id,label,object:groups[id],read:()=>({label,exists:true})});
        // Code owns the geometry; Studio owns only explicitly exposed properties.
        api.registerEditable({id,label,object:groups[id],
          properties:['position','quaternion','scale','visible']});
      }
      api.registerAction({target:'grand_gate',name:'toggleLanterns',description:'切换城堡道路与入口的魔法灯光',
        parameters:{type:'object',properties:{enabled:{type:'boolean'}},required:['enabled'],additionalProperties:false},
        execute(args){lanternsOn=args.enabled;lanterns.visible=lanternsOn;},
        verify({args}){return lanternsOn===args.enabled;}
      });
    },
    update({timestamp}){
      const t=timestamp*.001;
      for(let i=0;i<glows.length;i++)glows[i].position.y+=Math.sin(t*.7+i)*.0018;
      flags.forEach((f,i)=>f.rotation.y=Math.sin(t*.85+i)*.18);
      water.material.opacity=.78+Math.sin(t*.28)*.035;
    },
    serialize(){return {lanternsOn}},
    restore(s){lanternsOn=s?.lanternsOn??true;lanterns.visible=lanternsOn;},
    dispose(){
      resize.disconnect();
      scene.traverse(o=>{if(o.geometry)o.geometry.dispose();});
      for(const m of [stone,stoneLight,stoneDark,slate,roofTrim,grass,moss,path,bark,pine,pine2,wood,gold,glass,waterMat,fireflyMat,moonMaterial,mt1,mt2,mt3])m.dispose();
      renderer.dispose();
    }
  };
}
