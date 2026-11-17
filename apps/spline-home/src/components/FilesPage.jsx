import { useState } from "react";
import styles from "./FilesPage.module.css";
import Art from "./Art.jsx";
import { IconGrid, IconList, IconCaret, IconDots } from "./icons.jsx";
import { recents } from "../data/home.js";

const ART_HUES = {
  starter: [222, 280],
  "mini-room": [280, 330],
  hana: [205, 240],
  "hana-light": [205, 240],
  empty: [220, 230],
};

const CHIPS = ["All Files", "Recent Files", "Trash"];

export default function FilesPage({ onOpen, onToast, onNewProject }) {
  const [tab, setTab] = useState("mine");
  const [view, setView] = useState("grid");
  const [chip, setChip] = useState("All Files");

  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>My files</h1>
      <p className={styles.sub}>Your workspace files in one place.</p>

      <div className={styles.tabRow}>
        <div className={styles.tabs} role="tablist" aria-label="File ownership">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className={`${styles.tab} ${tab === "mine" ? styles.tabActive : ""}`}
            onClick={() => setTab("mine")}
          >
            My files
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shared"}
            className={`${styles.tab} ${tab === "shared" ? styles.tabActive : ""}`}
            onClick={() => setTab("shared")}
          >
            Shared with me
          </button>
        </div>
        <span className={styles.spacer} />
        <button type="button" className={styles.folderBtn} onClick={() => onToast("New Folder is not connected in this preview.")}>
          + New Folder
        </button>
        <button type="button" className={styles.createBtn} onClick={onNewProject}>
          Create
        </button>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.viewToggle} role="group" aria-label="View mode">
          <button
            type="button"
            className={view === "grid" ? styles.viewActive : ""}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <IconGrid />
          </button>
          <button
            type="button"
            className={view === "list" ? styles.viewActive : ""}
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <IconList />
          </button>
        </div>
        <button type="button" className={styles.selectBtn} onClick={() => onToast("Filter — All")}>
          All <IconCaret />
        </button>
        <button type="button" className={styles.selectBtn} onClick={() => onToast("Sort — Last modified")}>
          Last modified <IconCaret />
        </button>
      </div>

      <div className={styles.chips}>
        {CHIPS.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.chip} ${chip === c ? styles.chipActive : ""}`}
            onClick={() => setChip(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {tab === "shared" ? (
        <p className={styles.empty}>Nothing has been shared with you yet.</p>
      ) : chip === "Trash" ? (
        <div>
          <p className={styles.trashNote}>2 files in Trash</p>
          <ul className={styles.trashList}>
            <li><span>Untitled</span><span className={styles.edited}>Deleted 2 months ago</span></li>
            <li><span>Hana starter file</span><span className={styles.edited}>Deleted 2 months ago</span></li>
          </ul>
        </div>
      ) : view === "grid" ? (
        <div className={styles.grid}>
          {recents.filter((file) => chip !== "Recent Files" || file.group === "previous").map((file) => (
            <div key={file.id} className={styles.card}>
              <div className={styles.thumbWrap}>
                <button type="button" className={styles.thumbOpen} onClick={() => onOpen(file.name)} aria-label={`Open ${file.name}`}>
                  <Art hues={ART_HUES[file.art] || [222, 262]} seed={Number(file.id.slice(1)) % 4} light={file.art.startsWith("hana")} />
                </button>
                <button
                  type="button"
                  className={styles.dots}
                  aria-label={`More actions for ${file.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToast(`Actions for “${file.name}”`);
                  }}
                >
                  <IconDots />
                </button>
              </div>
              <button type="button" className={styles.cardName} onClick={() => onOpen(file.name)}>
                {file.name}
              </button>
              <p className={styles.edited}>Edited {file.time}</p>
            </div>
          ))}
        </div>
      ) : (
        <ul className={styles.listView}>
          {recents.filter((file) => chip !== "Recent Files" || file.group === "previous").map((file) => (
            <li key={file.id}>
              <button type="button" className={styles.listRow} onClick={() => onOpen(file.name)}>
                <span className={styles.listThumb}>
                  <Art hues={ART_HUES[file.art] || [222, 262]} seed={1} light={file.art.startsWith("hana")} />
                </span>
                <span className={styles.listName}>{file.name}</span>
                <span className={styles.edited}>Edited {file.time}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

