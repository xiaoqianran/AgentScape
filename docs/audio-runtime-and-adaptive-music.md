# 音频运行时与自适配音乐

音频能力使用实体 ID 与场景对象关联。宿主提供 `AudioListener`，它持有宿主的 `AudioContext` 和输出链路。AgentScape 管理实体关联的空间发声体和短生命周期音符，不创建、接管或关闭宿主的音频上下文，也不修改宿主渲染器和帧循环。

## 当前实现

`WorldRuntime` 接受可选的 `audioListener` 和 `audioThree`。未提供 `audioListener` 时不会创建音频系统，现有 Runtime 和原生 Three.js 场景保持原有行为。

原生场景注入支持下面的最小闭环。

```js
const component = host.scene.native.addComponent({
  id: 'bell',
  object: bellMesh,
  audio: true,
  audioOptions: { refDistance: 4, rolloffFactor: 1 },
});

host.scene.native.audio.scheduleNote('bell', {
  frequency: 440,
  duration: 0.5,
  gain: 0.2,
});

component.remove();
```

`audio: true` 会把实体注册为 Three.js `PositionalAudio` 发声体，并将实体阶段推进到 `audio-registered`。`scheduleNote()` 使用宿主 `AudioContext` 创建振荡器和包络，音频节点连接到该发声体的空间 Panner。实体移除和 Runtime 关闭会停止音符、断开节点并移除发声体。Runtime 只释放自己创建的节点。

音频系统拒绝不存在的实体、对象不匹配、重复注册和无效音符参数。没有宿主 `AudioListener` 时请求音频组件会返回 `NATIVE_AUDIO_UNAVAILABLE`。

## 边界与后续阶段

当前闭环覆盖实体音频注册、空间定位、单音事件和资源释放。`Instrument` 负责把交互动作映射到音符，`MusicDirector` 负责基于区域、环境标签、时间、天气、玩家状态和活跃事件编排音乐，这两层仍应建立在 `AudioSystem` 之上。它们不应复制音频上下文、实体身份或 Three.js 空间定位。

乐器事件链路为 `InteractionSystem → Instrument → AudioSystem.scheduleNote → 空间音频`。环境音乐由 `MusicDirector` 读取世界状态并提交可取消的音乐事件。音频资源必须有明确加载、复用、暂停和释放路径，Runtime 关闭时按实体逆序清理。

宿主浏览器仍需遵守 Web Audio 的用户手势策略。Runtime 只使用宿主已创建的上下文，不在后台自动恢复或启动上下文。
