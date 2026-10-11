const escapeHtml = (value) => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const toolArgumentTemplate = (schema = {}) => {
  const properties = schema.properties || {};
  const keys = schema.required?.length ? schema.required : Object.keys(properties).slice(0, 4);
  return Object.fromEntries(keys.map((key) => [key, toolArgumentValue(key, properties[key] || {})]));
};

const toolArgumentValue = (key, schema) => {
  if (schema.default !== undefined) return schema.default;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.enum?.length) return schema.enum[0];
  if (key === "id" || key.endsWith("Id")) return "table";
  if (key === "origin") return [0, 2, 0];
  if (key === "direction") return [0, -1, 0];
  if (key === "position" || key === "point") return [0, 0, 0];
  if (schema.type === "array") return [];
  if (schema.type === "number" || schema.type === "integer") return 0;
  if (schema.type === "boolean") return false;
  if (schema.type === "object") return {};
  return "";
};


export const ToolWorkbenchMethods = {
  configureToolWorkbench(definitions = [], onInvoke = null, preferredToolName = null) {
    this.toolDefinitions = [...definitions].sort((a, b) => a.name.localeCompare(b.name));
    this.onToolInvoke = onInvoke;
    const visible = this.toolDefinitions.length > 0;
    this.refs["tools-tab"].hidden = !visible;
    this.root.classList.toggle("obs-has-tool-workbench", visible);
    if (!visible) {
      this.activeToolName = null;
      if (this.root.querySelector('[data-right-tab="tools"]')?.classList.contains("is-active")) this.setRightTab("run");
      return;
    }
    const preferred = this.toolDefinitions.some((item) => item.name === preferredToolName) ? preferredToolName : null;
    const selected = preferred || (this.toolDefinitions.some((item) => item.name === this.activeToolName)
      ? this.activeToolName
      : this.toolDefinitions[0].name);
    this.selectTool(selected);
  },

  renderToolList() {
    const query = this.refs["tool-search"].value.trim().toLowerCase();
    const filtered = this.toolDefinitions.filter((definition) => `${definition.name} ${definition.description || ""}`.toLowerCase().includes(query));
    this.refs["tool-list"].replaceChildren(...filtered.map((definition) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `obs-tool-item${definition.name === this.activeToolName ? " is-active" : ""}`;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(definition.name === this.activeToolName));
      const required = definition.parameters?.required?.length || 0;
      button.innerHTML = `<span>${escapeHtml(definition.name)}</span><small>${required ? `${required} 必填` : "无必填"}</small>`;
      button.addEventListener("click", () => this.selectTool(definition.name));
      return button;
    }));
    if (!filtered.length) this.refs["tool-list"].innerHTML = `<div class="obs-empty">没有匹配的工具</div>`;
  },

  selectTool(name) {
    const definition = this.toolDefinitions.find((item) => item.name === name);
    if (!definition) return;
    this.activeToolName = name;
    this.refs["tool-name"].textContent = definition.name;
    this.refs["tool-description"].textContent = definition.description || "该工具没有提供说明。";
    const required = definition.parameters?.required || [];
    this.refs["tool-required"].textContent = required.length ? `必填：${required.join(" · ")}` : "无必填参数";
    this.refs["tool-args"].value = JSON.stringify(toolArgumentTemplate(definition.parameters), null, 2);
    this.refs["tool-error"].hidden = true;
    this.refs["tool-invoke"].disabled = false;
    this.renderToolList();
  },

  async invokeSelectedTool() {
    if (!this.activeToolName || !this.onToolInvoke || this.refs["tool-invoke"].disabled) return;
    let args;
    try {
      args = JSON.parse(this.refs["tool-args"].value || "{}");
      if (!args || Array.isArray(args) || typeof args !== "object") throw new Error("参数必须是 JSON 对象");
    } catch (error) {
      this.refs["tool-error"].textContent = `参数格式错误：${error.message}`;
      this.refs["tool-error"].hidden = false;
      return;
    }
    this.refs["tool-error"].hidden = true;
    this.refs["tool-invoke"].disabled = true;
    this.refs["tool-invoke"].classList.add("is-running");
    this.refs["tool-invoke"].querySelector("span").textContent = "正在调用…";
    const startedAt = performance.now();
    try {
      const payload = await this.onToolInvoke(this.activeToolName, args);
      const elapsedMs = payload?.elapsedMs ?? performance.now() - startedAt;
      const outcome = payload?.policy?.outcome?.state || "accepted";
      this.refs["tool-outcome"].textContent = `${outcome} · ${elapsedMs.toFixed(1)} ms`;
      this.refs["tool-outcome"].dataset.tone = payload?.policy?.outcome?.verified === false ? "warn" : "pass";
      this.refs["tool-result"].textContent = JSON.stringify(payload?.result ?? null, null, 2);
      this.toolHistory.unshift({ name: this.activeToolName, args, result: payload?.result, outcome, elapsedMs, ok: true, time: new Date() });
    } catch (error) {
      const elapsedMs = performance.now() - startedAt;
      this.refs["tool-outcome"].textContent = `${error.code || "error"} · ${elapsedMs.toFixed(1)} ms`;
      this.refs["tool-outcome"].dataset.tone = "fail";
      this.refs["tool-result"].textContent = JSON.stringify({ error: error.message, code: error.code || null }, null, 2);
      this.toolHistory.unshift({ name: this.activeToolName, args, error: error.message, outcome: error.code || "error", elapsedMs, ok: false, time: new Date() });
    } finally {
      this.toolHistory = this.toolHistory.slice(0, 12);
      this.renderToolHistory();
      this.refs["tool-invoke"].disabled = false;
      this.refs["tool-invoke"].classList.remove("is-running");
      this.refs["tool-invoke"].querySelector("span").textContent = "调用工具";
    }
  },

  renderToolHistory() {
    if (!this.toolHistory.length) {
      this.refs["tool-history"].innerHTML = `<div class="obs-empty">暂无手动调用</div>`;
      return;
    }
    this.refs["tool-history"].innerHTML = this.toolHistory.map((entry) => `<article class="obs-tool-history-item ${entry.ok ? "is-pass" : "is-fail"}">
      <i></i><div><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.outcome)} · ${entry.elapsedMs.toFixed(1)} ms · ${entry.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small></div>
    </article>`).join("");
  }
};

