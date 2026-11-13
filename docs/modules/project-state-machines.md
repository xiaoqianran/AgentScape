# Three.js Code Project 声明式状态机

## 目标

用一个可复用接口 `scene.registerStateMachine()` 替代对每个新物体重复手写 `registerEntity` / `registerAction` / 守卫 / 多字段变更 / verify / serialize。**Runtime 不读取 book、cooker 等类别来决定行为**；开发者提供状态、条件、变更和 Three.js 实体回调。

与资产物理交互的区别：状态机给出 **project-defined（项目逻辑/真实 Three.js 视觉）验证**，`physicsVerified:false`。物体必须由项目提供对应的网格、部件和视觉验证；它不生成力学关节、热力学过程或机械手抓握力。

## 快速上手

在 Code Project 的 `createProject().setup({scene})` 中：

```js
const machine=scene.registerStateMachine({
  id:'device_01',
  object:someThreeGroup,
  initialState:{cover:'closed',page:0,pages:5},
  ranges:{page:{min:0,max:5}},
  transitions:[
    {name:'openCover',
      when:[{field:'cover',op:'eq',value:'closed'}],
      effects:[{field:'cover',op:'set',value:'open'}]},
    {name:'nextPage',
      when:[{field:'cover',op:'eq',value:'open'},{field:'page',op:'lt',other:'pages'}],
      effects:[{field:'page',op:'add',value:1}]}
  ],
  onChange(next) {
    coverHinge.rotation.z=next.cover==='open'?-2.5:0;
    pageHinges.forEach((hinge,i)=>{hinge.rotation.y=i<next.page?-Math.PI:0;});
  },
  verifyVisual(next) {
    return Math.abs(coverHinge.rotation.z-(next.cover==='open'?-2.5:0))<1e-5;
  }
});
```

- `initialState`：仅接受有限数值、字符串、布尔值和 null。最多 64 个字段，字段名 `[A-Za-z][A-Za-z0-9_]*`。
- `transitions`：最多 64 个动作；每个动作最多 16 条 `when`、16 条 `effects`。条件支持 `eq/ne/lt/lte/gt/gte`，比较常量用 `value`，比较另一个状态字段用 `other`。
- `effects`：`set` 赋值，或 `add` 对数字字段加值；同一动作所有状态更新作为一个原子结果应用。守卫失败时状态与画面均不变。
- `ranges`：可为数字字段声明范围；持久化还校验字段集合、数值类型及通过动作定义推断的枚举值。
- `onChange(next,previous,meta)`：由 Code Project 映射状态到真实 Three.js 物体，**必须同步**；`verifyVisual(next)` 可检查实际对象变换/材质。失败时回滚项目状态和渲染回调。
- `machine.read()`、`machine.advance(seconds)`、`machine.dispose()`：分别读取独立状态、推进确定性计时器、注销机器与能力。读取返回克隆副本。
- `expose:false`：内部状态迁移，不向 Agent 暴露可调用动作。

```js
// 通过普通 Scene / Agent / MCP 的统一入口执行
const actions=scene.inspect('device_01').capabilities;
const job=scene.interact({action:'invoke',target:'device_01',name:'nextPage'});
const done=await scene.waitJob(job.id);
// 必须检查 done.result.verification.status
```

## 确定性计时

```js
const machine=scene.registerStateMachine({
  id:'timed_01',
  initialState:{mode:'idle',elapsed:0},
  ranges:{elapsed:{min:0,max:3}},
  transitions:[
    {name:'start',effects:[{field:'mode',op:'set',value:'running'},{field:'elapsed',op:'set',value:0}]},
    {name:'complete',expose:false,
      when:[{field:'mode',op:'eq',value:'running'},{field:'elapsed',op:'gte',value:3}],
      effects:[{field:'mode',op:'set',value:'done'}]}
  ],
  timers:[{field:'elapsed',rate:1,max:3,
    when:[{field:'mode',op:'eq',value:'running'}],onComplete:'complete'}]
});
// 在 createProject().update({dt}) 中调用 machine.advance(dt)
```

时钟以**宿主传入的仿真秒数**推进；暂停世界时不自动累积。计时器达到阈值后执行未公开的 `complete` 状态迁移；不能通过普通 `invoke` 提前触发。自动完成通过实时状态及视觉验收而非伪造 Agent 完成记录。

## 可直接导入 Studio 的完整示例

`examples/code-project/semantic-workshop.json`

这是包含 `main.js`、`book.js`、`cooker.js` 的原生多文件 Code Project；导入 Studio 后直接运行，不需要重新打包第三方依赖。

**书籍**：封面是独立旋转铰链，5 张书页是独立网格。执行 `openBook`、`turnPage`、`turnBack`、`closeBook` 后，真实网格转角与状态一致。没有开书时不可翻页；未翻回第一页不可合书。

**电饭煲**：`openLid` 旋转盖子，`addRice` 把同一个米饭网格从托盘移到锅内，`closeLid`、`startCook` 后计时 3 秒，内部 `completeCook` 设置 `mode=done`，灯光/颜色同步。烹饪时不允许开盖；完成后可 `openLid`、`serveRice`，米饭网格回托盘。

这些是 **程序性设备动作和视觉状态**。米饭从托盘进入内锅目前由项目逻辑移动 Three.js 网格，不宣称执行真实物体的物理抓取、放置或烹饪热模拟。

## 自动保存、恢复与验收

```js
const saved=(await scene.save()).value;
// Code Project v1 现在增加可选 machines:
// {schema:'agentscape.project-machine-state',schemaVersion:1,
//  entities:{book_01:{cover:'open',page:2,pages:5},...}}
```

`openCodeProject()` 完成原 Runtime 资产及 `instance.restore()` 后，按 `machines` 快照恢复状态机，重新运行 `onChange`，因此书页转角、锅盖、米饭位置及剩余烹饪时间可重建。状态机不需要手写 `serialize/restore`，原有用户自定义状态与资源保存逻辑保持不变。快照参与既有完整性摘要；恢复前校验全部目标和数据结构，视觉验证失败时回滚机器状态。**历史交互验证不跨重开复用。**

`tests/world/project-state-machine.test.js` 验证约束、原子变更、失败回滚与时钟；`tests/integration/semantic-state-machines.test.js` 验证真实几何、状态保存恢复和 Agent Tool；`tests/browser/semantic-workshop.spec.js` 使用 Chromium + HTTP MCP 验证发现、调用、页面重载恢复。

## 边界

- 仅为 **受信任的 Code Project** 注册；用户仍需授权运行任意 Three.js 代码。不能在未审核的外部 GLB 上自动推断出可信动作。
- 自动执行的是项目状态机操作，不是 Rapier 接触验证；复杂机械关节应继续注册 Manifest 关节并复用物理验证器。
- `onChange` 与 `verifyVisual` 必须同步；异步网络副作用不参与回滚，需使用原来的项目自定义动作契约。
- 当前仅支持每台机器自己的状态与计时器，不自动协调多个不同实体之间的物理物料流和工艺依赖。未来可在现有 World 行为图上增加跨实体组合与物理前后条件。
