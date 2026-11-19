# 音频运行时与自适配音乐

音频能力使用实体 ID 与场景对象关联。宿主提供 `AudioListener`，它持有宿主的 `AudioContext` 和输出链路。AgentScape 管理实体关联的空间发声体和短生命周期音符，不创建、接管或关闭宿主的音频上下文，也不修改宿主渲染器和帧循环。

## 当前实现

`WorldRuntime` 接受可选的 `audioListener` 和 `audioThree`。未提供 `audioListener` 时不会创建音频系统，现有 Runtime 和原生 Three.js 场景保持原有行为。

原生场景注入支持下面的实体音频闭环。

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

## 实体乐器

`createInstrument()` 提供命名音符到 `scheduleNote()` 的显式映射。它只保存音符配置，不创建音频上下文，也不直接操作 Three.js 对象。

```js
const instrument = host.scene.native.audio.createInstrument('piano', {
  notes: {
    C4: 261.63,
    D4: 293.66,
    E4: { frequency: 329.63, duration: 0.6 },
  },
  duration: 0.4,
  gain: 0.2,
});

instrument.play('C4');
instrument.trigger('E4', { waveform: 'triangle' });
instrument.dispose();
```

乐器可以绑定到 GLB 导入后的实体，只要该实体已经通过 `addComponent({ audio: true })` 注册发声体。交互、碰撞或自定义脚本应在自己的事件处理器中显式调用 `play()`，避免音频系统监听全局事件。发声体注销时，绑定它的乐器会自动失效并释放注册关系。

`Instrument` 支持数字频率和音符配置对象。音符对象可以覆盖乐器默认的时长、增益和波形。频率、时长、增益、开始时间和波形仍由 `AudioSystem.scheduleNote()` 统一校验。

## 错误与生命周期

音频系统拒绝不存在的实体、对象不匹配、重复注册和无效音符参数。没有宿主 `AudioListener` 时请求音频组件会返回 `NATIVE_AUDIO_UNAVAILABLE`。未知音符返回 `AUDIO_NOTE_UNKNOWN`，已销毁乐器返回 `AUDIO_INSTRUMENT_DISPOSED`，已销毁音频运行时返回 `AUDIO_RUNTIME_DISPOSED`。

## 后续阶段

当前闭环覆盖实体音频注册、空间定位、单音事件和显式乐器触发。`MusicDirector` 仍应建立在 `AudioSystem` 之上，负责基于区域、环境标签、时间、天气、玩家状态和活跃事件编排可取消的音乐事件。音频资源必须有明确加载、复用、暂停和释放路径，Runtime 关闭时按实体逆序清理。

宿主浏览器仍需遵守 Web Audio 的用户手势策略。Runtime 只使用宿主已创建的上下文，不在后台自动恢复或启动上下文。
