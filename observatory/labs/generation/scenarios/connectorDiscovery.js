export const generationConnectorDiscoveryScenario = {
  id: "generation.connector.discovery",
  title: "真实 Connector 能力发现",
  subtitle: "Pair → Capability Snapshot · 不提交生成任务",
  description: "仅连接本机 Connector、建立/恢复会话并读取 Provider Capability；不会 submit generation job，因此不会启动 Modal GPU。连接器不可达时 2.5 秒内快速失败。",
  async setup(ctx) {
    if (ctx.backendId !== "connector") {
      ctx.transition = { status: "backend-required", reason: "SELECT_CONNECTOR_BACKEND" };
      return;
    }
    try {
      const state = await ctx.generation.initialize({ pair: true });
      const providers = state.status === "generation-ready"
        ? ctx.generation.listGenerationProviders({ availableOnly: false })
        : { status: "providers-listed", providers: [] };
      const capabilities = state.status === "generation-ready"
        ? ctx.generation.listGenerationCapabilities({ availableOnly: false })
        : { status: "capabilities-listed", capabilities: [] };
      ctx.transition = { status: "connector-smoke-complete", state, providers, capabilities };
    } catch (error) {
      ctx.transition = {
        status: "connector-smoke-failed",
        error: { code: error?.code || (error?.name === "AbortError" ? "CONNECTOR_TIMEOUT" : "CONNECTOR_UNREACHABLE"), message: error?.message || String(error) }
      };
    }
  },
  assertions(ctx) {
    const transition = ctx.transition || {};
    if (transition.status === "backend-required") return [{ label: "请选择真实 Connector backend", pass: false, detail: "backend=connector" }];
    if (transition.status === "connector-smoke-failed") return [{ label: "Connector 当前可达", pass: false, detail: `${transition.error?.code}: ${transition.error?.message}` }];
    const ready = transition.state?.status === "generation-ready";
    const approval = transition.state?.reason === "APPROVAL_REQUIRED";
    return [
      { label: "Connector 会话已建立或进入明确审批态", pass: ready || approval, detail: transition.state?.status || transition.state?.reason },
      { label: "Smoke 未提交任何 Generation Job", pass: ctx.generation.listGenerationJobs().jobs.length === 0 },
      { label: "能力快照可读取", pass: ready ? Array.isArray(transition.capabilities?.capabilities) : approval }
    ];
  }
};
