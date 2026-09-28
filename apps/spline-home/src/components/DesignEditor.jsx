import { useMemo, useRef, useState } from "react";
import styles from "./DesignEditor.module.css";
import {
  designSuggestions,
  hanaFrames,
  hanaLayers,
  designTools,
} from "../data/design.js";

function FrameArt({ frame }) {
  if (frame.kind === "spec") {
    return (
      <div className={styles.specArt}>
        <div className={styles.specLines}>
          <span style={{ width: "70%" }} />
          <span style={{ width: "55%" }} />
          <span style={{ width: "80%" }} />
          <span style={{ width: "40%" }} />
        </div>
        <div className={styles.specTitle}>{frame.title}</div>
      </div>
    );
  }

  if (frame.kind === "grid") {
    return (
      <div className={styles.gridArt}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className={styles.gridCell} style={{ background: `hsl(${(i * 37 + 200) % 360} 35% ${55 + (i % 3) * 10}%)` }} />
        ))}
        <div className={styles.frameCaption}>{frame.title}</div>
      </div>
    );
  }

  return (
    <div className={styles.uiArt}>
      <div className={styles.uiBar} />
      <div className={styles.uiHero} />
      <div className={styles.uiRows}>
        <span />
        <span />
        <span />
      </div>
      <div className={styles.frameCaption}>{frame.title}</div>
    </div>
  );
}

export default function DesignEditor({ title = "Hana starter file", onBack, onToast }) {
  const [tab, setTab] = useState("agent");
  const [tool, setTool] = useState("select");
  const [selected, setSelected] = useState("frame-3-2");
  const [prompt, setPrompt] = useState("");
  const [zoom, setZoom] = useState("5%");
  const [bg, setBg] = useState("E4E4E4");
  const [quality, setQuality] = useState("Medium");
  const [effort, setEffort] = useState("High");
  const [review, setReview] = useState("Review 1x");
  const [mcpVisible, setMcpVisible] = useState(true);
  const canvasRef = useRef(null);

  const selectedName = useMemo(
    () => hanaLayers.find((l) => l.id === selected)?.name || "—",
    [selected]
  );

  return (
    <div className={styles.root}>
      {/* Left sidebar */}
      <aside className={styles.left}>
        <div className={styles.leftHead}>
          <button type="button" className={styles.backBtn} onClick={onBack}>
            ← Back
          </button>
          <div className={styles.fileTitle}>{title}</div>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === "agent" ? styles.tabActive : ""}`}
            onClick={() => setTab("agent")}
          >
            Agent
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === "layers" ? styles.tabActive : ""}`}
            onClick={() => setTab("layers")}
          >
            Layers
          </button>
          <button type="button" className={styles.iconBtn} title="New chat" onClick={() => onToast("New chat")}>
            +
          </button>
          <button type="button" className={styles.iconBtn} title="Chat history" onClick={() => onToast("Chat history")}>
            ⋯
          </button>
        </div>

        {tab === "agent" ? (
          <div className={styles.agentPane}>
            <h3 className={styles.buildTitle}>Let's build!</h3>
            <div className={styles.suggestions}>
              {designSuggestions.map((s) => (
                <button key={s} type="button" className={styles.suggestion} onClick={() => setPrompt(s)}>
                  {s}
                </button>
              ))}
            </div>

            <div className={styles.agentFoot}>
              <button type="button" className={styles.upgradeBtn} onClick={() => onToast("Upgrade — Free tier")}>
                <span>
                  <strong>Upgrade</strong> to use the AI agent
                </span>
                <span className={styles.freeTag}>Free</span>
              </button>

              {mcpVisible ? (
                <div className={styles.mcpCard}>
                  <button type="button" className={styles.mcpMain} onClick={() => onToast("Connect with MCP")}>
                    <span className={styles.mcpCopy}>
                      <span className={styles.mcpTitle}>Connect with MCP</span>
                      <span className={styles.mcpSub}>Build with agentic tools.</span>
                    </span>
                  </button>
                  <button type="button" className={styles.dismiss} onClick={() => setMcpVisible(false)} aria-label="Dismiss">
                    ×
                  </button>
                </div>
              ) : null}

              <div className={styles.promptBox}>
                <textarea
                  placeholder="Describe your design..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && prompt.trim()) {
                      e.preventDefault();
                      onToast(`Queued: ${prompt.slice(0, 40)}…`);
                      setPrompt("");
                    }
                  }}
                />
                <div className={styles.promptTools}>
                  <button type="button" className={styles.toolChip} title="Attach image or video" onClick={() => onToast("Attach media")}>
                    📎
                  </button>
                  <button type="button" className={styles.toolChip} onClick={() => setQuality(quality === "Medium" ? "High" : "Medium")}>
                    {quality}
                  </button>
                  <button type="button" className={styles.toolChip} onClick={() => setEffort(effort === "High" ? "Max" : "High")}>
                    {effort}
                  </button>
                  <button type="button" className={styles.toolChip} onClick={() => setReview(review === "Review 1x" ? "Review 2x" : "Review 1x")}>
                    {review}
                  </button>
                  <button
                    type="button"
                    className={styles.sendBtn}
                    disabled={!prompt.trim()}
                    onClick={() => {
                      onToast(`Queued: ${prompt.slice(0, 40)}…`);
                      setPrompt("");
                    }}
                  >
                    ↑
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.layerPane} role="tree">
            {hanaLayers.map((layer) => (
              <button
                key={layer.id}
                type="button"
                role="treeitem"
                className={`${styles.layerItem} ${selected === layer.id ? styles.layerActive : ""}`}
                style={{ paddingLeft: 8 + layer.depth * 14 }}
                onClick={() => setSelected(layer.id)}
              >
                <span className={styles.layerIcon}>{layer.icon}</span>
                {layer.name}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* Canvas stage */}
      <div className={styles.stage}>
        <div className={styles.floatTools} role="toolbar" aria-label="Tools">
          {designTools.map((t, i) => (
            <span key={t.id} className={styles.toolWrap}>
              <button
                type="button"
                className={`${styles.floatBtn} ${tool === t.id ? styles.floatBtnActive : ""}`}
                title={t.title}
                onClick={() => {
                  setTool(t.id);
                  onToast(t.title);
                }}
              >
                {t.icon}
              </button>
              {i === 7 ? <span className={styles.toolSep} /> : null}
            </span>
          ))}
        </div>

        <div
          ref={canvasRef}
          className={styles.canvas}
          style={{ background: `#${bg}` }}
          onClick={() => setSelected("page")}
        >
          {hanaFrames.map((frame) => (
            <button
              key={frame.id}
              type="button"
              className={`${styles.frame} ${selected === `frame-${frame.id.replace(/-/g, "-")}` || selected === `frame-${frame.id}` || (frame.title && selected === `frame-${frame.id}`) ? "" : ""}`}
              style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
              onClick={(e) => {
                e.stopPropagation();
                const layerId = `frame-${frame.id}`;
                setSelected(layerId);
              }}
              data-selected={selected === `frame-${frame.id}` || selected.endsWith(frame.id)}
            >
              {frame.label ? <span className={styles.frameLabel}>{frame.label}</span> : null}
              <FrameArt frame={frame} />
            </button>
          ))}
        </div>
      </div>

      {/* Right inspector */}
      <aside className={styles.right}>
        <div className={styles.rightHead}>
          <div className={styles.avatars}>
            <span className={styles.avatar}>X</span>
            <span className={styles.avatarMuted}>✕</span>
          </div>
          <button type="button" className={styles.zoomBtn} onClick={() => setZoom(zoom === "5%" ? "Fit" : "5%")}>
            {zoom}
          </button>
          <button type="button" className={styles.ghostBtn} onClick={() => onToast("Share link copied")}>
            Share
          </button>
          <button type="button" className={styles.exportBtn} disabled onClick={() => onToast("Export")}>
            Export
          </button>
        </div>

        <section className={styles.panel}>
          <div className={styles.panelHead}>Page</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>BG Color</span>
            <div className={styles.rowValue}>
              <span className={styles.swatch} style={{ background: `#${bg}` }} />
              <input
                className={styles.hexInput}
                value={bg}
                onChange={(e) => setBg(e.target.value.replace(/[^0-9a-fA-F]/g, "").slice(0, 6) || "E4E4E4")}
              />
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <button type="button" className={styles.panelHeadBtn} onClick={() => onToast("Snap to")}>
            Snap to ▸
          </button>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>Selection</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Name</span>
            <span className={styles.value}>{selectedName}</span>
          </div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Type</span>
            <span className={styles.value}>Frame</span>
          </div>
        </section>
      </aside>
    </div>
  );
}
