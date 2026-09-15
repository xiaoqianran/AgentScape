"""Extract the user's cabin content, not its renderer, player controller or game shell."""
from pathlib import Path
import hashlib
import re

repo = Path(__file__).resolve().parents[2]
source = repo.parent / 'web-012-line-art-style-magic-cabin/index.html'
html = source.read_text(encoding='utf-8')

def between(start, end):
    return html[html.index(start):html.index(end, html.index(start))]

body = between('            const MAT =', '            const MEMB_MAT =')
# All UI is scoped to the host supplied by Studio; no global IDs or second event loop.
body = re.sub(r"document.getElementById\('([^']+)'\)", r"editorHost.querySelector('#\1')", body)
body = re.sub(r'            let decorLastT =.*?            /\* ============ 便签编辑器',
              '            let mirrorDirtyT = 0;\n            /* ============ 便签编辑器', body, flags=re.S)
body = re.sub(r"            renderer.domElement.addEventListener\('pointerdown'.*?\n            /\* ===",
              '\n            /* ===', body, flags=re.S)
# Never forward user picture URLs to third-party CORS proxies.
body = re.sub(r'            /\* 图片加载：.*?            function tryLoadPic',
              '            const PIC_SOURCES = [u => u];\n            function tryLoadPic', body, flags=re.S)
body = body.replace('            const hinges = [],', '            const architectureRoots = [...scene.children];\n            const hinges = [],')
body = body.replace('scene.add(buildStairs());', 'const stairs = buildStairs(); scene.add(stairs); architectureRoots.push(stairs);')
body = body.replace('boardTilt.add(g);\n', 'boardTilt.add(g); n.object = g;\n')
body = body.replace('function applyNote() {', "function applyNote() {\n                if (editorHost.executeWorldEdit) return editorHost.executeWorldEdit({targetId:`cabin:note-${noteEditing+1}`,text:noteInput.value}).then(result=>{if(result.verified) noteEditor.classList.remove('show');});")
body = body.replace('new THREE.ShaderMaterial(', 'createCabinMaterial(')
body = body.replace('new THREE.PlaneGeometry(130, 130)', 'new THREE.PlaneGeometry(28, 28)')
body = body.replace("if (!/^https?:\\/\\//i.test(u))", "if (!/^(https?:\\/\\/|data:image\\/)/i.test(u))")
body = body.replace('img.onerror = function () { tryLoadPic(url, idx + 1); };', 'img.onerror = function () { if (!disposed) tryLoadPic(url, idx + 1); };')
body = body.replace('if (!img.width || !img.height) { tryLoadPic', 'if (disposed) return;\n                    if (!img.width || !img.height) { tryLoadPic')
# Preserve stable source variable names for otherwise unlabeled interactive objects.
labels = {
    'orbG':'转动星象仪','potG':'拔出 / 塞回药剂瓶塞','corkG':'拔出 / 塞回瓶塞',
    'dineBookG':'翻开魔法书','lanternPivot':'点亮 / 熄灭木灯','catG':'唤醒 / 哄睡小猫',
    'yarnG':'拨动毛线球','bookPileG':'唤起魔法书堆','hg':'翻转沙漏','chest':'打开 / 关闭宝箱',
    'car':'启动玩具车','cauldronG':'搅拌魔女坩埚','mcG':'启动魔法阵','teapotPos':'倒一杯茶',
    'broomG':'让扫帚悬浮','orbStandG':'唤醒水晶球','plantG':'唤醒月光盆栽',
    'cartBody':'拉出 / 推回小推车','inkG':'让羽毛笔写字','quillG':'让羽毛笔写字','paperG':'唤起纸张',
    'tarotG':'展开塔罗牌','kotBody':'开启 / 关闭暖桌','radioG':'启动魔法收音机','orangeG':'剥开橘子',
    'doorbellG':'摇响门铃','sunPivot':'拨动太阳挂饰','chimePivot':'摇响风铃','storageChest':'打开楼梯下储物箱',
    'pillowG':'翻转枕头','drawerG':'拉开 / 关闭床头抽屉','candleG':'点燃 / 熄灭蜡烛','chairG':'拉出 / 推回书桌椅',
    'rubikG':'转动魔方','group':'推倒 / 扶起书本','deckG':'展开纸牌','snowG':'摇动雪景球',
    'hourG':'翻转二楼沙漏','calG':'翻动日历','bookG':'翻阅二楼魔法书','astro':'启动二楼星象仪',
    'eraserG':'翻转黑板擦','chalkG':'让粉笔画画','wandG':'挥动魔杖','stoolG':'拨动小凳子',
    'hatG':'唤醒魔法帽','tissueBoxG':'打开纸巾盒','tissuePaperG':'抽出纸巾','picG':'更换挂画图片',
    'junkG':'打开 / 关闭置物箱'
}
def registration(match):
    name = match.group(1)
    if name == 'o':
        return match.group(0)
    label = labels.get(name, '交互')
    if name == 'g':
        preceding = body[:match.start()]
        if 'openNoteEditor(i)' in body[match.end():match.end()+70]: label='编辑计划板便签'
        elif 'g.userData.out' in body[match.end():match.end()+80]: label='抽出 / 放回书架上的书'
        elif 'g.userData.spinV' in body[match.end():match.end()+80]: label='转动餐桌摆件'
        elif 'g.userData.open' in body[match.end():match.end()+80]: label='拉出 / 推回座椅'
        else: label='拨动小摆件'
    return f"regMagic(named({name}, '{name}', '{label}'),"
body = re.sub(r'regMagic\((\w+),', registration, body)
# The function declaration is not a registration call.
body = body.replace("function regMagic(named(o, 'o'), onClick)", 'function regMagic(o, onClick)')
platforms = between('            const platformBoxes =', '            const movingPlatforms =')
platforms += between('            const movingPlatforms =', '            let activePlatforms =')
animation = between('                /* ============ 室内陈设动画', '                if (camShake >')
toggle = between('            const toggleSpring =', '            const interactables =')

prefix = '''import * as THREE from 'three';
import { createCabinMaterial } from './materials.js';
import { createCabinAffordances } from './affordances.js';

// Migrated from the workspace's web-012-line-art-style-magic-cabin/index.html.
// Generated by dev/scripts/migrate-magic-cabin.py. Host integration lives in magicCabin.js.
export function createMagicCabinContents({ editorHost, document = globalThis.document } = {}) {
  if (!editorHost || !document) throw new Error('Magic cabin requires a scoped editor host and canvas document');
  const scene = new THREE.Group();
  let camera = new THREE.PerspectiveCamera();
  const SND = { play() {} };
  const named = (object, name, label) => { if (!object.name) object.name = name; if (!object.userData.aimLabel) object.userData.aimLabel = label; return object; };
  const timers = new Set();
  let disposed = false;
  let elapsed = 0;
  const performance = { now:() => elapsed * 1000 };
  const setTimeout = (callback, delay) => {
    const timer = { callback, at:elapsed + delay / 1000 };
    timers.add(timer); return timer;
  };
'''
suffix = r'''
  // The host provides one fixed-step update, shared with WorldRuntime.
  let ptLantern = 1, ptKot = 1, ptMc = 0, ptCb = 0, ptPlant = 0;
  const update = (dt) => {
    if (disposed) return;
    elapsed += dt;
    for (const timer of timers) if (elapsed >= timer.at) { timers.delete(timer); timer.callback(); }
    const time = elapsed;
    updateSprings();
    FILL.uniforms.uTime.value = time;
    FILL.uniforms.uFireStrength.value = fireP;
    updateNewDecor(time, dt);
ANIMATION
  };
  const applySign = () => {
    if (editorHost.executeWorldEdit) return editorHost.executeWorldEdit({targetId:'cabin:sign',text:editorHost.querySelector('#signInput').value}).then(result=>{if(result.verified)editorHost.querySelector('#signEditor').classList.remove('show');});
    signText = editorHost.querySelector('#signInput').value.trim() || '魔女小屋';
    drawSign(signText);
    editorHost.querySelector('#signEditor').classList.remove('show');
  };
  editorHost.querySelector('#signOk').addEventListener('click', applySign);
  editorHost.querySelector('#signInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') applySign();
    event.stopPropagation();
  });
  const roots = [...new Set(magicMeshes.map(mesh => mesh.userData.magicRoot))];
  const affordances=createCabinAffordances({
    hinges,
    switches:[
      {id:'cabin:table-lamp',label:'一楼餐桌灯',object:lanternPivot,get:()=>lanternLit,set:value=>{lanternLit=value;}},
      {id:'cabin:chandelier',label:'二楼吊灯',object:chandelier,get:()=>lampLit,set:value=>{lampLit=value;}},
      {id:'cabin:candle',label:'床头蜡烛',object:candleG,get:()=>candleLit,set:value=>{candleLit=value;}},
      {id:'cabin:fireplace',label:'壁炉',object:fireMeshes[0],position:[FX,.8,FZ],get:()=>fireLit,set:value=>{fireLit=value;}},
      {id:'cabin:heated-table',label:'暖桌',object:kotBody,get:()=>kotatsuOn,set:value=>{kotatsuOn=value;}}
    ],
    texts:[
      {id:'cabin:sign',label:'屋外路牌',object:signG,get:()=>signText,set:value=>{signText=value;drawSign(value);}},
      ...notes.map((note,index)=>({id:`cabin:note-${index+1}`,label:`计划板便签 ${index+1}`,object:note.object,get:()=>note.txt,set:value=>{note.txt=value;drawNote(index);}}))
    ],
    drawers:roots.filter(object=>['drawerG','wardrobeDrawerG'].includes(object.name)),books:shelfBooks
  });
  const contractByObject=new Map(affordances.map(contract=>[contract.object,contract]));
  const interactions = roots.map((object, index) => ({
    id:`cabin:object:${index}`, object, label:object.userData.aimLabel || object.name || '交互',
    contractId:contractByObject.get(object)?.id, activate:() => fireMagic(object)
  }));
  for (const [index, object] of hinges.entries()) interactions.push({
    id:`cabin:hinge:${index}`, object, label:object.userData.aimLabel || '打开 / 关闭',
    contractId:contractByObject.get(object)?.id, activate:() => toggleSpring(object)
  });
  for (const [index, object] of fireMeshes.entries()) interactions.push({
    id:`cabin:fire:${index}`, object, label:'点燃 / 熄灭壁炉', contractId:'cabin:fireplace', activate:toggleFire
  });
  interactions.push({id:'cabin:mirror',object:mirrorPane,label:'触碰魔镜',activate:()=>spawnMirrorRipple(80,240)});
  return {
    root:scene, architectureRoots, platformBoxes, movingPlatforms, interactions, affordances, update,
    setCamera(value) { camera = value; },
    resetPendingAnimations() { timers.clear();for(const hinge of hinges)hinge.userData.closing=false; },
    setCutaway(value) { fullHouse = !value; fullHouseGroup.visible = !value; dashedGroup.visible = value; },
    textState() { return { sign:signText, notes:notes.map(note=>note.txt), picture:picState.url }; },
    restoreText(state = {}) {
      if (typeof state.sign === 'string') { signText = state.sign.slice(0,10); drawSign(signText); }
      state.notes?.slice(0,notes.length).forEach((text,index)=>{ notes[index].txt=String(text).slice(0,100); drawNote(index); });
      if (typeof state.picture === 'string' && /^(https?:|data:image\/)/i.test(state.picture)) { picState.url=state.picture; setPicture(state.picture); }
    },
    dispose() { disposed = true; timers.clear(); }
  };
}
'''.replace('ANIMATION', animation)
target = repo / 'modules/world/content/magic-cabin/cabinContents.js'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(prefix + body + platforms + toggle + suffix, encoding='utf-8')
print(f'Extracted {len(body.splitlines())} source lines; SHA256 {hashlib.sha256(html.encode()).hexdigest()}')
