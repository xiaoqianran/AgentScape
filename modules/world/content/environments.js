export const ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id:'magic-cabin',number:'世界 05',title:'魔女小屋 · 原版迁移',headline:'走进原来的二层小屋。',
    description:'原版线稿小屋：旋转楼梯、两层生活空间、门窗、书籍、魔法陈设与原地编辑。',
    facts:['原版双层房屋','丰富物件交互','世界优先'],worldFirst:true,cabin:true,
    load:()=>import('./magicCabin.js').then(module=>module.createMagicCabin),
    bootstrap:{agent:[6,0,-5],table:[7,0,2],cabinet:[7,0,5],cup:[7.35,1.4,2]},
    coffeeCorner:{table:[7,0,2],cabinet:[7,0,5]}
  }),
  Object.freeze({
    id:'woodland-workshop', number:'世界 04', title:'林间工坊', headline:'在世界里，开始创造。',
    description:'开放式工坊与林间庭院。点选物体直接操作，按需打开构建与检查工具。',
    facts:['世界优先交互','真实物理资产','开放式工坊'],
    worldFirst:true,
    inlineEditors:[
      { id:'board', label:'告示板文字', maxLength:24 },
      { id:'sign', label:'木牌文字', maxLength:12 }
    ],
    load:()=>import('./woodlandWorkshop.js').then(module=>module.createWoodlandWorkshop),
    bootstrap:{agent:[0,0,3],table:[2.5,0,-3],cabinet:[-3,0,-5],cup:[2.85,1.4,-3]},
    coffeeCorner:{table:[2.5,0,-3],cabinet:[-3,0,-5]}
  }),
  Object.freeze({
    id:'monument-hall', number:'世界 01', title:'纪念大厅', headline:'为智能留出空间。',
    description:'一个 32 × 24 米的纪念性空间，物理、导航与智能体行为共享同一个现实世界。',
    facts:['RAPIER 物理引擎','RECAST / DETOUR 导航','智能体就绪资产'],
    load:()=>import('./monumentHall.js').then((module)=>module.createMonumentHall),
    bootstrap:{agent:[0,0,9],table:[5.2,0,4.2],cabinet:[-5.2,0,3.9],cup:[5.55,1.4,4.2]},
    coffeeCorner:{table:[4.8,0,4.2],cabinet:[2.4,0,4.2]}
  }),
  Object.freeze({
    id:'ruined-courtyard', number:'世界 02', title:'遗迹庭院', headline:'穿行于记忆之间。',
    description:'一个 36 × 30 米的露天遗迹，由破损拱廊、错层露台与再利用石材构成。',
    facts:['多层级导航网格','物理遗迹场景','CC0 材质'],
    load:()=>import('./ruinedCourtyard.js').then((module)=>module.createRuinedCourtyard),
    bootstrap:{agent:[0,0,12],table:[11.8,1.2,5.1],cabinet:[-11.6,.8,-5.8],cup:[12.1,2.6,5.1]},
    coffeeCorner:{table:[10.5,1.2,3.5],cabinet:[8.4,1.2,3.5]}
  }),
  Object.freeze({
    id:'grand-urban-block', number:'世界 03', title:'大型城市街区', headline:'一个会产生真实后果的城市街区。',
    description:'一个 96 × 72 米的模块化城区，包含林荫大道、抬升街区、市民广场与长距离导航。',
    facts:['96 × 72 米世界','实例化街道生活','分块导航'],
    load:()=>import('./grandUrbanBlock.js').then((module)=>module.createGrandUrbanBlock),
    bootstrap:{agent:[0,0,-30],table:[6,.16,5],cabinet:[-6,.16,5],cup:[6.35,1.56,5]},
    coffeeCorner:{table:[6,.16,5],cabinet:[3.4,.16,5]}
  })
]);

const byId=new Map(ENVIRONMENTS.map((value)=>[value.id,value]));
export const DEFAULT_ENVIRONMENT=ENVIRONMENTS.find(value=>value.id==='monument-hall');
export const resolveEnvironment=(id)=>byId.get(id)||DEFAULT_ENVIRONMENT;
