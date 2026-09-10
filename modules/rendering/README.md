# Rendering

正式渲染能力：createRenderer、后处理、Gaussian Splat 加载、资源释放与 RendererProbe。
保持平铺文件。RendererProbe 服务正式运行诊断；实验 WebGPU probes 已归 apps/observatory/probes/rendering。
World 的 RenderingSystem 仍负责运行装配，暂未迁移其生命周期。Gaussian 视觉加载仍使用 World 的生成坐标转换契约。

任务见 tasks.jsonl。验证：npm run test -- tests/rendering tests/observatory。
