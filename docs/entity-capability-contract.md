# 实体能力契约

## Responsibility

为宿主对象和 Runtime 资产提供稳定 `entityId`、能力列表、变换权威和生命周期索引。

## Owns

- `EntityCapabilityRegistry` 中的身份记录
- 能力名称去重
- 生命周期阶段变更
- 注册、注销和基础事件

## Does Not Own

- Three.js renderer、材质、几何、纹理和宿主资源
- 物理刚体的求解状态
- 音频节点和音频资源
- 交互动作的具体执行器

## API

```js
world.entities.register({
  id: 'piano-1',
  object,
  source: 'native',
  capabilities: ['semantic', 'interaction', 'instrument', 'audio-emitter'],
  transformAuthority: 'host',
});
world.entities.addCapabilities('piano-1', ['environment-audio']);
world.entities.setPhase('piano-1', 'active');
world.entities.list({ capability: 'instrument' });
world.entities.unregister('piano-1');
```

实体 ID 在一个 Runtime 中必须唯一。宿主注入对象不能与 Runtime 资产实例复用 ID。实体注销不自动 dispose 宿主 Three.js 资源。
