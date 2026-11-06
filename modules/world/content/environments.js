import { houseRecipe } from './houseRecipe.js';
export const ENVIRONMENTS = Object.freeze([
  Object.freeze({
    id:'suzhou-garden',number:'世界 08',title:'吴苑澄观 · 苏州园林',
    headline:'探索程序化江南园林与山水建筑。',
    description:'CNB wk/002 移植：亭台楼阁、太湖石、池水、植被、天气与观景点，原生 AgentScape Runtime。',
    facts:['苏州园林','程序化建筑与山水','原生 Three.js Environment'],
    worldFirst:true,rendererMode:'webgl-legacy',
    load:()=>import('./suzhouGarden/index.js').then(module=>module.createSuzhouGardenEnvironment),
    bootstrap:{agent:[0,0,65]},coffeeCorner:{}
  }),
  Object.freeze({
    id:'yuanmingyuan-western-mansions',number:'世界 06',title:'圆明园 · 西洋楼',rendererMode:'webgl-legacy',
    headline:'走进一座可被 AI 探索的历史园林。',
    description:'程序化生成的大水法、海晏堂、远瀛观、湖泊与园林；原生接入 AgentScape Runtime。',
    facts:['大型程序化世界','地形碰撞','原生 Three.js 环境'],worldFirst:true,
    load:()=>import('./yuanmingyuan/index.js').then(module=>module.createYuanmingyuanEnvironment),
    bootstrap:{agent:[0,0,62],table:[3,0,62],cup:[3.3,1.1,62]},
    coffeeCorner:{table:[3,0,62]}
  }),
  Object.freeze({
    id:'blank-world',number:'世界 00',title:'空白实验世界',headline:'从一块空地开始搭建世界。',
    description:'没有现成建筑的独立物理场景，使用通用资产接口放置桌子、杯子和智能体。',
    facts:['空白场景','真实地面碰撞','可移动智能体'],worldFirst:true,
    load:()=>import('./blankWorld.js').then(module=>module.createBlankWorld),
    bootstrap:{agent:[-2,0,1],table:[0,0,-2],cup:[0,1.08,-2]},
    coffeeCorner:{table:[0,0,-2]}
  }),
  Object.freeze({
    id:'house-world',number:'世界 00B',title:'我的第一栋房屋',headline:'从空地上通过代码建造房屋。',
    description:'由空白物理环境开始，通过 AgentScape Asset Recipe 生成独立住宅资产。',
    facts:['声明式建筑资产','27个物理碰撞体','门窗与台阶'],worldFirst:true,
    load:()=>import('./blankWorld.js').then(module=>()=>module.createBlankWorld({id:'house-world'})),
    bootstrap:{agent:[-2,0,1],table:[0,0,-2],cup:[0,1.08,-2],models:[{id:'house_01',asset:houseRecipe,position:[4,0,-5]}]},
    coffeeCorner:{table:[0,0,-2]}
  }),
  Object.freeze({
    id:'house-door-world',number:'世界 00C',title:'我的房屋 · 可开关门',headline:'带真实铰链与碰撞的可交互住宅。',
    description:'使用固定建筑 Asset Recipe 和独立的旋转关节门构建，不占用旧房屋的本地存档。',
    facts:['可开关门','旋转关节','物理碰撞'],worldFirst:true,
    load:()=>import('./blankWorld.js').then(module=>()=>module.createBlankWorld({id:'house-door-world'})),
    bootstrap:{agent:[-2,0,1],table:[0,0,-2],cup:[0,1.08,-2],models:[{id:'house_01',asset:houseRecipe,position:[4,0,-5]}],assets:[{assetId:'house_door',position:[4,0,-2.8],instanceId:'house_door_01'}]},
    coffeeCorner:{table:[0,0,-2]}
  }),
  Object.freeze({
    id:'industrial-cabinet-lab',number:'世界 00D',title:'工业储物柜实验室',
    headline:'操作真正带铰链和滑轨的复杂机械资产。',
    description:'Three.js 程序化建模的钢制柜体，包含两扇独立柜门和两个抽屉。每个部件都由真实物理关节驱动。',
    facts:['双旋转铰链','双滑动关节','Agent 交互验证'],worldFirst:true,
    load:()=>import('./blankWorld.js').then(module=>()=>module.createBlankWorld({id:'industrial-cabinet-lab'})),
    bootstrap:{
      agent:[-2,0,1.5],table:[2.8,0,-2.1],cup:[2.8,1.1,-2.1],
      assets:[{assetId:'industrial_cabinet',position:[0,0,-2.5],instanceId:'industrial_cabinet_01'}]
    },
    coffeeCorner:{table:[2.8,0,-2.1]}
  }),
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
export const BUILTIN_ENVIRONMENT_IDS=Object.freeze(ENVIRONMENTS.map((value)=>value.id));
/** Strict lookup for Scene Project / SDK. Studio routes may use resolveEnvironment's fallback. */
export const findEnvironment=(id)=>byId.get(id)||null;
export const DEFAULT_ENVIRONMENT=ENVIRONMENTS.find(value=>value.id==='suzhou-garden');
export const resolveEnvironment=(id)=>byId.get(id)||DEFAULT_ENVIRONMENT;
