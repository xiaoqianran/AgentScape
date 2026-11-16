import { useMemo, useRef, useState } from "react";
import styles from "./GeneratePage.module.css";
import DropdownMenu from "./DropdownMenu.jsx";
import Art from "./Art.jsx";
import {
  IconArrowLeft,
  IconSparkle,
  IconCube,
  IconImage,
  IconTemplates,
  IconSliders,
} from "./icons.jsx";
import {
  generateNav,
  generateCategories,
  outputTypeOptions,
  modelEngineOptions,
  discoverCards,
} from "../data/home.js";

const CAT_HUES = {
  Characters: [280, 330],
  Furniture: [30, 18],
  Architecture: [205, 232],
  Props: [150, 185],
  Creatures: [350, 22],
  Objects: [220, 252],
  Nature: [190, 150],
  Vehicles: [95, 125],
  "Food & drink": [42, 18],
};

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

  const queue = () => {
    onToast(`Queued ${outputType} · ${engine}: ${prompt.slice(0, 40)}…`);
    setPrompt("");
  };

  return (
    <div className={styles.root}>
      <aside className={styles.rail} aria-label="Generate tools">
        <button type="button" className={styles.railBtn} title="Back" aria-label="Back" onClick={onBack}>
          <IconArrowLeft />
        </button>
        <button type="button" className={`${styles.railBtn} ${styles.railActive}`} title="3D Generate" aria-label="3D Generate" onClick={() => setTab("3d")}>
          <span className={styles.sparkle}>
            <IconSparkle />
          </span>
        </button>
        <button type="button" className={styles.railBtn} title="Scenes" aria-label="Scenes" onClick={() => onToast("Scenes")}>
          <IconCube />
        </button>
        <button type="button" className={styles.railBtn} title="Image Generate" aria-label="Image Generate" onClick={() => setTab("image")}>
          <IconImage />
        </button>
        <button type="button" className={styles.railBtn} title="Assets" aria-label="Assets" onClick={() => setTab("assets")}>
          <IconTemplates />
        </button>
        <span className={styles.railSpacer} />
        <button type="button" className={styles.railBtn} title="Settings" aria-label="Settings" onClick={() => setTab("settings")}>
          <IconSliders />
        </button>
      </aside>

      <div className={styles.main}>
        <nav className={styles.topTabs} aria-label="Generate navigation">
          <button type="button" className={styles.backLink} onClick={onBack}>
            ← Back
          </button>
          {generateNav.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.tabBtn} ${tab === item.id ? styles.tabActive : ""}`}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className={styles.hero}>
          <h2 className={styles.heading}>What do you want to create?</h2>
          <div className={styles.promptBox}>
            <textarea
              className={styles.textarea}
              rows={3}
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
                  queue();
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
                + {refImage ? refImage : "Add reference image"}
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
                <span className={styles.selectLabel}>Output type</span> {outputType}
              </button>
              <button
                ref={engineRef}
                type="button"
                className={styles.selectBtn}
                aria-label="3D model engine"
                onClick={() => setOpenMenu(openMenu === "engine" ? null : "engine")}
              >
                <span className={styles.selectLabel}>3D model engine</span> {engine}
              </button>

              <span className={styles.spacer} />
              <button type="button" className={styles.generateBtn} disabled={!canGenerate} onClick={queue}>
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
            aria-label="Search models"
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
              <span className={styles.cardArt}>
                <Art hues={CAT_HUES[card.category] || [222, 262]} seed={Number(card.id.slice(1)) % 4} />
                <span className={styles.cardPrompt}>{card.prompt}</span>
              </span>
              <span className={styles.cardTitle}>{card.title}</span>
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

