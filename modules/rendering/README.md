# Rendering

正式渲染能力：createRenderer、后处理、Gaussian Splat 加载、资源释放与 RendererProbe。
保持平铺文件。RendererProbe 服务正式运行诊断；实验 WebGPU probes 已归 apps/observatory/probes/rendering。
World 的 RenderingSystem 负责 World 展示适配，并由 application/createSession.js 装配到 WorldRuntime。modules/rendering 不依赖 World；Generated World 坐标转换由 World 的 RenderingSystem 应用。

任务见 tasks.jsonl。验证：npm run test -- tests/rendering tests/observatory。
