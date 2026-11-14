# Semantic World View（P0）

## 目标与边界

`SemanticWorldView` 是现有 Runtime 的只读事实投影，不持有第二份对象状态，也不替代物理引擎、SceneGraph 或 Code Project 的回调。

- `runtime.semantic.entity(id)`：从 `ObjectStore`、环境 affordance、`ProjectCapabilities` 查找实时对象身份。
- `runtime.semantic.state(id, key)`：读取对应所有者的当前状态；返回 `status:'known'` 与值，或 `status:'unknown'` 和原因。
- `runtime.semantic.relation({subject,predicate,object,objectAnyOf?,surfaceId?})`：读取 SceneGraph 的当前关系；返回 `truth:'true'|'false'|'unknown'`。
- `WorldAcceptance` 的 `object-exists`、`state-equals`、`relation-exists` 统一通过该投影查询；原有验收条件格式保持不变。

## 事实可信度

| 来源 | 说明 | 证明范围 |
| --- | --- | --- |
| `runtime` | `ObjectStore` 的当前声明状态 | 状态所有者当前值，不是物理后置条件 |
| `project` | `ProjectCapabilities.readState` | Three.js 项目声明的状态，不自动构成物理证明 |
| `environment` | 环境 affordance 的 `read()` | 环境设备状态；受限文本内容不能通过无 actor 验收读取 |
| `scene-graph` | 当前 `SceneGraph` 空间关系 | 根据关系证据及几何覆盖情况解释其成立性 |

`relation` 的不存在**不一定等于 false**：

- 有对应 SceneGraph 边时返回 `true`（包括带来源的环境语义边）。
- 如果关系两端都是活跃、参与 `SpatialSystem` 的 Runtime 对象，且空间图能成功更新，缺少对应几何关系可判为 `false`。
- 对指定 `surfaceId`，已有边却不匹配该表面，也可判断该表面条件不成立。
- 如果对象仅由 Code Project 管理、未进入空间索引，或者空间图不可用，返回 `unknown`，不能把数据不足当成负面结论。
- `objectAnyOf`：任一候选已证实为 `true` 则为真；否则只要仍有候选不可观测，结果就是 `unknown`。

`state` 的字段不存在返回 `STATE_NOT_OBSERVED`，不再伪装为普通的数值不匹配；已知值和预期值不等仍返回 `STATE_MISMATCH`。

## 示例

```js
const state = world.semantic.state('cooker_01', 'mode');
// { kind:'state', source:'project', status:'known', value:'cooking', ... }

const relation = world.semantic.relation({
  subject:'rice_01', predicate:'INSIDE', object:'cooker_01'
});
// { kind:'relation', truth:'true'|'false'|'unknown', source:'scene-graph', ... }
```

`scene.verify` 和 `scene_verify` 使用同一个验收路径；失败结果包含来源、真值状态和原因，不会将未经验证的关系当成已验收成功。

## P0 的边界

P0 未将 Code Project Mesh 自动纳入 `SpatialSystem`。P1 已支持给现有 Runtime 实体显式附加项目状态与行为，但尚未自动为任意原生 Three.js Mesh 建立空间与物理实体。缺少几何观测时的 `unknown` 仍是不可省略的证据边界。

## P1：同一实体的多 Provider 语义能力

Code Project 可以显式附加在一个**已经存在的 Runtime 实体**上，而不创建同名物理对象：

```js
// 要先通过 scene.addModel / 已保存世界恢复创建 device_01。
scene.registerEntity({
  id:'device_01',
  attachTo:'runtime',
  read:()=>({mode})
});
scene.registerAction({
  target:'device_01',
  name:'startProgram',
  execute:()=>{ mode='running'; },
  verify:({after})=>({verified:after.mode==='running'})
});
```

声明式状态机也支持 `attachTo:'runtime'`，并仍通过原有 Code Project `machines` 快照自动保存和恢复。没有设置 `attachTo` 时，重复 ID 继续拒绝；不存在 Runtime 对象时不允许附加。运行中目标被删除或替换为新的物理实例，旧项目动作立即失效，需要重新注册绑定。

`scene.inspect('device_01')` 现在可返回 `source:'composite'`、`providers:['asset','project']` 及两类 `capabilities`。本地 `state` 合并无冲突的字段；`stateProviders` 保留各所有者状态，`stateConflicts` 列出重名字段。**没有任何状态被写入另一 Provider。**

同名语义动作必须明确来源：

```js
// project-defined，不代表物理验证
scene.interact({action:'invoke',target:'device_01',name:'open',source:'project'});
// 真实关节执行仍受物理准入和 actor 检查约束
scene.interact({action:'invoke',target:'device_01',name:'open',
  source:'asset',actor:'agent_01',partName:'lid'});
```

如果不同 Provider 同时声明 `open`，省略 `source` 会触发 `ACTION_SOURCE_REQUIRED`；单一 Provider 多关节同名动作仍需要 `partName`。Scene、SDK 与 MCP 共用同一规则。

事实验证也可以按来源指定：

```js
scene.verify([
  {id:'logical-mode',kind:'state-equals',targetId:'device_01',
    stateKey:'mode',source:'project',value:'running'},
  {id:'project-open',kind:'interaction-verified',targetId:'device_01',
    capability:'OPEN',source:'project'},
  {id:'physical-open',kind:'interaction-verified',targetId:'device_01',
    capability:'OPEN',source:'asset'}
]);
```

没有指明来源、且两个状态 Provider 对同一字段都有声明时，事实查询返回 `STATE_PROVIDER_CONFLICT` 和 `unknown`；不同来源声明同名动作时，未经来源限定的动作验证返回 `INTERACTION_SOURCE_REQUIRED`。交互验证记录按来源隔离，保存重开后不会继承历史动作验证。

**边界**：P1 还没有把任意 Code Project Mesh 自动注册为独立的物理对象，也没有实现跨对象后置条件的通用 DSL。项目逻辑验证仍然是 `physicsVerified:false`，关节验证也不自动证明新的功能语义。
