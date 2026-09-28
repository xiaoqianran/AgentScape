import { useMemo, useRef, useState } from "react";
import styles from "./GeneratePage.module.css";
import DropdownMenu from "./DropdownMenu.jsx";
import {
  generateNav,
  generateCategories,
  outputTypeOptions,
  modelEngineOptions,
  discoverCards,
} from "../data/home.js";

export default function GeneratePage({ onBack, onToast }) {
  const [tab, setTab] = useState("discover");
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [outputType, setOutputType] = useState("3D model");
  const [engine, setEngine] = useState("Hunyuan3D");
  const [openMenu, setOpenMenu] = useState(null);
  const [refImage, setRefImage] = useState(null);

  const outputRef = useRef(null);
  const engineRef = useRef(null);
  const fileRef = useRef(null);

  const cards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return discoverCards.filter((c) => {
      if (category !== "All" && c.category !== category) return false;
      if (!q) return true;
      return (c.title + " " + c.prompt).toLowerCase().includes(q);
    });
  }, [category, search]);

  const canGenerate = prompt.trim().length > 0;

  return (
    <div className={styles.root}>
      <aside className={styles.nav} aria-label="Generate navigation">
        <button type="button" className={styles.backBtn} onClick={onBack}>
          ← Back
        </button>
        <div className={styles.navList}>
          {generateNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.navItem} ${tab === item.id ? styles.navItemActive : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </aside>

      <div className={styles.main}>
        <div className={styles.hero}>
          <h2 className={styles.heading}>What do you want to create?</h2>
          <div className={styles.promptBox}>
            <textarea
              className={styles.textarea}
              rows={2}
              placeholder={
                outputType === "Image"
                  ? "Describe an image to generate"
                  : outputType === "Material"
                    ? "Describe a material to generate"
                    : "Describe a 3D model to generate"
              }
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && canGenerate) {
                  e.preventDefault();
                  onToast(`Queued ${outputType} · ${engine}: ${prompt.slice(0, 40)}…`);
                  setPrompt("");
                }
              }}
            />
            <div className={styles.promptToolbar}>
              <button
                type="button"
                className={styles.toolBtn}
                title="Add reference image"
                onClick={() => fileRef.current?.click()}
              >
                {refImage ? refImage : "＋ Reference"}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/png, image/jpeg, image/jpg, image/webp, image/gif"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) {
                    setRefImage(f.name);
                    onToast(`Reference: ${f.name}`);
                  }
                }}
              />

              <button
                ref={outputRef}
                type="button"
                className={styles.selectBtn}
                aria-label="Output type"
                onClick={() => setOpenMenu(openMenu === "output" ? null : "output")}
              >
                {outputType}
              </button>
              <button
                ref={engineRef}
                type="button"
                className={styles.selectBtn}
                aria-label="3D model engine"
                onClick={() => setOpenMenu(openMenu === "engine" ? null : "engine")}
              >
                {engine}
              </button>

              <span className={styles.spacer} />
              <button
                type="button"
                className={styles.generateBtn}
                disabled={!canGenerate}
                onClick={() => {
                  onToast(`Queued ${outputType} · ${engine}: ${prompt.slice(0, 40)}…`);
                  setPrompt("");
                }}
              >
                Generate
              </button>
            </div>
          </div>
        </div>

        <div className={styles.filters}>
          <div className={styles.cats}>
            {generateCategories.map((c) => (
              <button
                key={c}
                type="button"
                className={`${styles.cat} ${category === c ? styles.catActive : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            className={styles.search}
            type="search"
            placeholder="Search models"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className={styles.grid}>
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={styles.card}
              onClick={() => {
                setPrompt(card.prompt);
                onToast(`Loaded prompt: ${card.title}`);
              }}
            >
              <span className={styles.cardArt} data-cat={card.category} />
              <span className={styles.cardBody}>
                <span className={styles.cardTitle}>{card.title}</span>
                <span className={styles.cardPrompt}>{card.prompt}</span>
              </span>
            </button>
          ))}
          {cards.length === 0 ? <div className={styles.empty}>No models match</div> : null}
        </div>

        <DropdownMenu
          open={openMenu === "output"}
          items={outputTypeOptions}
          value={outputType}
          onSelect={(item) => {
            setOutputType(item.label);
            setOpenMenu(null);
          }}
          anchorRef={outputRef}
          onClose={() => setOpenMenu(null)}
        />
        <DropdownMenu
          open={openMenu === "engine"}
          items={modelEngineOptions}
          value={engine}
          onSelect={(item) => {
            setEngine(item.label);
            setOpenMenu(null);
          }}
          anchorRef={engineRef}
          onClose={() => setOpenMenu(null)}
        />
      </div>
    </div>
  );
}
