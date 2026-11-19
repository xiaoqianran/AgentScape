# 音频运行时与自适配音乐

音频能力使用实体 ID 与场景对象关联。宿主提供 AudioContext、AudioListener 和输出节点，AgentScape 管理空间发声体、乐器事件和音乐状态，不修改宿主渲染器。

乐器事件链路为 `InteractionSystem → Instrument → AudioSystem.scheduleNote → 空间音频`。环境音乐由 MusicDirector 读取区域、环境标签、时间、天气、玩家状态和活跃事件。音频资源必须有明确加载、复用、暂停和释放路径，Runtime 关闭时按实体逆序清理。

当前仓库已建立实体和生命周期扩展点，完整 AudioSystem、Instrument 和 MusicDirector 属于后续阶段。
