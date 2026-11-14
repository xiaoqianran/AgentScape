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

## 下一阶段

P0 **不**自动使 Code Project Mesh 进入 `SpatialSystem`，也不允许 `ProjectCapabilities` 与 `ObjectStore` 注册同名对象。这需要 P1 的实体身份/Provider 组合与原生 Three.js 部件空间绑定。P0 的 `unknown` 是有意识的安全边界，而不是语义能力的最终完整实现。
