# TaskCompiler 真实模型验收记录（2026-11-21）

## 范围

本轮仅验证 TaskCompiler 从中英文任务文本到结构化 TaskSpec 的行为，不宣称 Agent 已实际生成场景或完成视觉评价。运行平台是 PC2，模型为 nvidia/nemotron-3.5-super-vl-120b-a12b，请求经项目现有 NewAPI 网关发送。评估代码不输出密钥或网关 URL。

复现：node dev/evaluate-task-compiler.mjs。若只验证前三项，设置 AGENTSCAPE_TASK_COMPILER_BENCH_LIMIT=3。

## 故障定位

原始请求未关闭 Nemotron 默认深度推理。实际观测一次 HTTP 200：耗时约 16.96 秒，completion_tokens=2048，reasoning_content 存在，content 为空，finish_reason=length。没有可用的任务 JSON。

加入 chat_template_kwargs.enable_thinking=false 后，同类请求约 2.46 秒得到非空 JSON 且不再输出推理内容。该参数仅对 Nemotron 3.5 或用户显式授权的兼容模型发送。

## 第二轮固定案例（真实模型）

| 场景 | 编译状态 |
| --- | --- |
| 汽车、4 轮、开门 | review-required |
| 城堡、2 座塔楼、大门 | ready |
| 花园、3 棵树、喷泉 | ready |
| 工厂、2 台机器、启动 | review-required |
| 杯子放桌子 | ready |
| 桥梁、河流、夜景灯光 | review-required |
| 房屋、电梯上下移动 | review-required |
| 机器人、双臂旋转、外观 | review-required |
| 无人机、4 螺旋桨、飞行 | review-required |
| 英文游乐场、2 秋千、滑梯 | review-required |

总计 10 任务：ready 3、review-required 7、格式/网络不可用 0；基本预设检查覆盖 9；按此有限标准识别的潜在误通过 0；累计 19,951 ms，平均约 1,995 ms。

重要：基本覆盖不是完整语义准确率；这里只检查对象数量下界、动作/关系/视觉标记。它不证明所有原始需求均被保留，也不证明 Scene 对象、物理和视觉质量。模型输出具有随机性，复测统计可能变化。

## 已修复和保留的保护

1. Nemotron 3.5 默认关闭编译环节的推理；可单独设置 AGENTSCAPE_TASK_COMPILER_MODEL，或通过 AGENTSCAPE_TASK_COMPILER_DISABLE_THINKING=1 指定其他支持该参数的模型。
2. 对输出截断、非法 JSON、Schema 失败与数量不符进行保守回退，输出限定的诊断码，不输出原始响应和凭据。
3. 不允许用 wheel_count=4 或 door_openable=true 冒充真实轮子实体与开门操作；对“两座”“两台”“三盏”等量词补充测试。
4. 保留 Golden Tasks 的确定性验收，以及 Finalizer 对实际 Runtime 的独立验证；视觉质量仍标记待验收。

## 当前限制与下一步

自动编译率仅 3/10，不应宣称通用任务已经稳定可用。后续重点是语义完整性二次审核、能力绑定与端到端 Scene/Studio 生成、截图质量评价；本轮未进行全量 Playwright 浏览器验收。

模型开关文档：https://docs.nvidia.com/nim/large-language-models/2.1.6/get-started/advanced/get-started-nemotron-3.5-super-vl.html
