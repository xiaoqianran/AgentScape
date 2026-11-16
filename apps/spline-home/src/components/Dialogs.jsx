import { useState } from "react";
import styles from "./Dialogs.module.css";
import Art from "./Art.jsx";
import { IconClose } from "./icons.jsx";
import { workspace } from "../data/home.js";
import { importTiles } from "../data/pages.js";

function Backdrop({ children, onClose, dim = true }) {
  return (
    <div
      className={`${styles.backdrop} ${dim ? "" : styles.backdropClear}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

/** Workspace switcher menu (mirrors app.spline.design workspace menu). */
export function WorkspaceMenu({ onClose, onToast }) {
  const [themeOpen, setThemeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const act = (label) => {
    onToast(label);
    onClose();
  };

  const helpItems = [
    "X/Twitter",
    "YouTube",
    "Instagram",
    "TikTok",
    "Discord",
    "Spline Docs",
    "Tutorials",
    "Keyboard Shortcuts",
    "Send Feedback",
    "Report a Bug",
    "Feature Request",
  ];

  return (
    <Backdrop onClose={onClose} dim={false}>
      <div className={styles.wsMenu} role="menu" aria-label="Workspace menu">
        <div className={styles.wsTop}>
          <button type="button" onClick={() => act("Settings")}>Settings</button>
          <button type="button" onClick={() => act("Invite")}>Invite</button>
        </div>
        <p className={styles.wsMeta}>{workspace.name} · Free plan</p>
        <button type="button" className={styles.wsRow} onClick={onClose}>
          <span className={styles.wsCheck}>✓</span>
          <span className={styles.wsAvatar}>{workspace.avatar}</span>
          <span className={styles.wsName}>{workspace.name}</span>
        </button>
        <button type="button" className={styles.wsItem} onClick={() => act("Create Workspace")}>Create Workspace</button>
        <button type="button" className={styles.wsItem} onClick={() => act("Upgrade Plan")}>Upgrade Plan</button>
        <div className={styles.wsSep} />
        <button type="button" className={styles.wsItem} onClick={() => setThemeOpen((o) => !o)}>
          Theme <span className={styles.wsTrail}>›</span>
        </button>
        {themeOpen ? (
          <div className={styles.wsSub}>
            {["Dark", "Light", "System Theme"].map((t) => (
              <button key={t} type="button" className={styles.wsItem} onClick={() => act(`Theme — ${t}`)}>
                {t}
                {t === "Dark" ? <span className={styles.wsTrail}>✓</span> : null}
              </button>
            ))}
          </div>
        ) : null}
        <button type="button" className={styles.wsItem} onClick={() => act("Download Desktop App")}>Download Desktop App</button>
        <button type="button" className={styles.wsItem} onClick={() => act("Archive")}>Archive</button>
        <button type="button" className={styles.wsItem} onClick={() => setHelpOpen((o) => !o)}>
          Help &amp; Feedback <span className={styles.wsTrail}>›</span>
        </button>
        {helpOpen ? (
          <div className={styles.wsSub}>
            {helpItems.map((t) => (
              <button key={t} type="button" className={styles.wsItem} onClick={() => act(t)}>
                {t}
              </button>
            ))}
          </div>
        ) : null}
        <div className={styles.wsSep} />
        <button type="button" className={styles.wsItem} onClick={() => act("Logout")}>Logout</button>
      </div>
    </Backdrop>
  );
}

const INBOX_ITEMS = [
  {
    id: "n1",
    title: "Earn AI credits in Spline Arena",
    body: "Vote on head-to-head AI generations in Spline Arena to earn AI credits for your workspace, and see which models the community ranks highest…",
    date: "Oct 30, 2026",
    hues: [262, 205],
  },
  {
    id: "n2",
    title: "Introducing Spline V2 — A complete rebuild of our 3d editor for the agentic era.",
    body: "Spline V2 is here: a complete rebuild of the 3D editor with faster rendering, a new design surface, and workflows built for agentic tools…",
    date: "Aug 24, 2026",
    hues: [160, 212],
  },
];

/** Inbox "WHAT'S NEW" panel. */
export function InboxPanel({ onClose }) {
  return (
    <Backdrop onClose={onClose} dim={false}>
      <div className={styles.inboxPanel} role="dialog" aria-label="Inbox">
        <div className={styles.inboxHead}>
          <span className={styles.inboxTitle}>WHAT'S NEW</span>
          <button type="button" className={styles.iconClose} aria-label="Close inbox" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        {INBOX_ITEMS.map((item) => (
          <article key={item.id} className={styles.inboxCard}>
            <div className={styles.inboxCopy}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className={styles.inboxDate}>{item.date}</span>
            </div>
            <div className={styles.inboxArt}>
              <Art hues={item.hues} seed={2} />
            </div>
          </article>
        ))}
      </div>
    </Backdrop>
  );
}

/** "Create new project" modal. */
export function NewProjectModal({ onClose, onCreate }) {
  const [name, setName] = useState("Workspace Project");
  return (
    <Backdrop onClose={onClose}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="newProjectTitle">
        <h2 id="newProjectTitle" className={styles.modalTitle}>Create new project</h2>
        <label className={styles.fieldLabel} htmlFor="newProjectName">Project name</label>
        <input
          id="newProjectName"
          className={styles.fieldInput}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCreate(name.trim() || "Untitled");
          }}
        />
        <div className={styles.modalActions}>
          <button type="button" className={styles.ghostBtn} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primaryBtn} onClick={() => onCreate(name.trim() || "Untitled")}>Create</button>
        </div>
      </div>
    </Backdrop>
  );
}

/** "Import or Drag & Drop" modal with format tiles. */
export function ImportModal({ onClose, onPickFiles, onGenerate, onToast }) {
  return (
    <Backdrop onClose={onClose}>
      <div className={`${styles.modal} ${styles.importModal}`} role="dialog" aria-modal="true" aria-labelledby="importTitle">
        <div className={styles.modalHead}>
          <h2 id="importTitle" className={styles.modalTitle}>Import or Drag &amp; Drop</h2>
          <button type="button" className={styles.iconClose} aria-label="Close import" onClick={onClose}>
            <IconClose />
          </button>
        </div>
        <div className={styles.tileGrid}>
          {importTiles.map((tile) => (
            <button key={tile.id} type="button" className={styles.tile} onClick={onPickFiles}>
              <span className={styles.tileTitle}>
                {tile.title}
                {tile.fast ? <span className={styles.bolt}>⚡</span> : null}
              </span>
              <span className={styles.tileFormats}>{tile.formats}</span>
            </button>
          ))}
        </div>
        <div className={styles.orRow}>
          <span className={styles.orLine} />
          <span>or... Generate it!</span>
          <span className={styles.orLine} />
        </div>
        <div className={styles.wideTiles}>
          <button type="button" className={styles.wideTile} onClick={onGenerate}>
            <span className={styles.tileTitle}>
              Generate
              <span className={styles.aiPill}>AI Add-on</span>
            </span>
            <span className={styles.tileFormats}>Generate 3D scenes and models with AI</span>
          </button>
          <button type="button" className={styles.wideTile} onClick={() => onToast("AI Texture is not connected in this preview.")}>
            <span className={styles.tileTitle}>
              AI Texture
              <span className={styles.aiPill}>AI Add-on</span>
            </span>
            <span className={styles.tileFormats}>Create textures from a prompt</span>
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

