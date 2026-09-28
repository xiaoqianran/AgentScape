import { useCallback, useMemo, useState } from "react";
import styles from "./SceneEditor.module.css";
import SceneViewport from "./SceneViewport.jsx";
import { sceneTree, sceneTabs, materialAssets, starterScenes } from "../data/scene.js";

export default function SceneEditor({ title = "Spline 3D Starter File", onBack, onToast }) {
  const [tab, setTab] = useState("objects");
  const [sceneName, setSceneName] = useState(starterScenes[0]);
  const [selected, setSelected] = useState("sphere blue");
  const [mode, setMode] = useState("edit");
  const [zoom, setZoom] = useState("100%");
  const [autoZoom, setAutoZoom] = useState("Yes");
  const [snapping, setSnapping] = useState("Off");

  const tree = useMemo(() => sceneTree, []);

  const onSelect = useCallback((name) => setSelected(name), []);

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
          {sceneTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button type="button" className={styles.version} onClick={() => onToast("Version v1")}>
            v1
          </button>
        </div>

        {tab === "objects" ? (
          <div className={styles.panel}>
            <div className={styles.sectionHead}>
              <span>Scenes</span>
              <button type="button" className={styles.miniBtn} onClick={() => onToast("New Scene")}>
                +
              </button>
            </div>
            <div className={styles.sceneList}>
              {starterScenes.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.sceneItem} ${sceneName === name ? styles.sceneItemActive : ""}`}
                  onClick={() => {
                    setSceneName(name);
                    onToast(`Scene: ${name}`);
                  }}
                >
                  <span className={styles.radio} />
                  {name}
                </button>
              ))}
            </div>

            <div className={styles.searchRow}>
              <input className={styles.search} placeholder="Search" />
              <button type="button" className={styles.miniBtn} onClick={() => onToast("Filter by type")}>
                ⌗
              </button>
            </div>

            <div className={styles.tree} role="tree">
              {tree.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  role="treeitem"
                  className={`${styles.treeItem} ${selected === node.name ? styles.treeItemActive : ""}`}
                  onClick={() => setSelected(node.name)}
                >
                  <span className={styles.treeIcon}>{node.icon}</span>
                  <span className={styles.treeName}>{node.name}</span>
                  {node.event ? <span className={styles.eventTag}>Event</span> : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "assets" ? (
          <div className={styles.panel}>
            <div className={styles.sectionHead}>
              <span>Material Assets</span>
              <button type="button" className={styles.miniBtn} onClick={() => onToast("Create material")}>
                +
              </button>
            </div>
            <div className={styles.assetList}>
              {materialAssets.map((m) => (
                <button key={m.name} type="button" className={styles.assetItem} onClick={() => onToast(`Material: ${m.name}`)}>
                  <span className={styles.swatch} style={{ background: m.color }} />
                  {m.name}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "agent" ? (
          <div className={styles.panel}>
            <div className={styles.agentBox}>
              <p>Ask the agent to edit this scene.</p>
              <textarea placeholder="e.g. Make the center sphere salmon and add a torus" />
              <button type="button" className={styles.primaryBtn} onClick={() => onToast("Agent queued")}>
                Run
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      {/* Center */}
      <div className={styles.center}>
        <div className={styles.centerTop}>
          <div className={styles.modeGroup}>
            {["preview", "edit", "code"].map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.modeBtn} ${mode === m ? styles.modeBtnActive : ""}`}
                onClick={() => {
                  setMode(m);
                  if (m !== "edit") onToast(`${m} mode`);
                }}
              >
                {m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className={styles.centerActions}>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Create object")}>
              + Object
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Comment tool")}>
              💬
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Timeline")}>
              Timeline
            </button>
          </div>
          <div className={styles.centerRight}>
            <button type="button" className={styles.ghostBtn} onClick={() => setZoom(zoom === "100%" ? "Fit" : "100%")}>
              {zoom}
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Performance ok")}>
              Perf
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Share link copied")}>
              Share
            </button>
            <button type="button" className={styles.ghostBtn} onClick={() => onToast("Export .splinecode")}>
              Export
            </button>
          </div>
        </div>

        <SceneViewport selected={selected} onSelect={onSelect} />

        <div className={styles.viewHud}>
          <button type="button" className={styles.iconBtn} title="Orthographic" onClick={() => onToast("Ortho camera")}>
            ▣
          </button>
          <button type="button" className={styles.iconBtn} title="Collapse view controls" onClick={() => onToast("View controls")}>
            ⌄
          </button>
        </div>
      </div>

      {/* Right inspector */}
      <aside className={styles.right}>
        <div className={styles.rightHead}>
          <button type="button" className={styles.iconBtn} onClick={() => onToast("Hide inspector")}>
            ⟩
          </button>
          <select className={styles.select} defaultValue="Personal Camera">
            <option>Personal Camera</option>
            <option>Camera</option>
          </select>
        </div>

        <InspectorSection title="Frame">
          <Row label="Size">
            <select className={styles.select} defaultValue="Responsive">
              <option>Responsive</option>
              <option>Fixed</option>
            </select>
          </Row>
          <Row label="Auto Zoom">
            <Segmented options={["Yes", "No"]} value={autoZoom} onChange={setAutoZoom} />
          </Row>
        </InspectorSection>

        <InspectorSection title="Scene">
          <Row label="BG Color">
            <input className={styles.colorInput} defaultValue="#000000" />
          </Row>
          <Row label="Play Camera">
            <select className={styles.select} defaultValue="Camera">
              <option>Camera</option>
              <option>Personal Camera</option>
            </select>
          </Row>
          <Row label="Light">⟳</Row>
          <Row label="Simulation">⟳</Row>
          <Row label="Effects">▸</Row>
          <Row label="Fog">▸</Row>
          <Row label="Sky">▸</Row>
          <Row label="Ambient Shadows">▸</Row>
        </InspectorSection>

        <InspectorSection title="Global Settings">
          <Row label="Grid Plane">
            <select className={styles.select} defaultValue="Floor (XZ)">
              <option>Floor (XZ)</option>
              <option>Wall (XY)</option>
            </select>
          </Row>
          <Row label="Snapping">
            <Segmented options={["Object", "Grid", "Off"]} value={snapping} onChange={setSnapping} />
          </Row>
        </InspectorSection>

        <InspectorSection title="Selection">
          <Row label="Name">
            <span className={styles.value}>{selected || "—"}</span>
          </Row>
          <Row label="Type">
            <span className={styles.value}>Mesh</span>
          </Row>
          <Row label="Visible">✓</Row>
        </InspectorSection>

        <InspectorSection title="Material Assets">
          <div className={styles.assetList}>
            {materialAssets.slice(0, 10).map((m) => (
              <div key={m.name} className={styles.assetItem}>
                <span className={styles.swatch} style={{ background: m.color }} />
                {m.name}
              </div>
            ))}
          </div>
        </InspectorSection>
      </aside>
    </div>
  );
}

function InspectorSection({ title, children }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span>{title}</span>
      </div>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <div className={styles.rowValue}>{children}</div>
    </div>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className={styles.segmented}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`${styles.seg} ${value === opt ? styles.segActive : ""}`}
          onClick={() => onChange(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}
