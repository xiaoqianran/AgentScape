import { useMemo, useRef, useState } from "react";
import styles from "./AcademyPage.module.css";
import Art from "./Art.jsx";
import { IconSearch, IconCaret } from "./icons.jsx";
import { academyTopics, academyCollections, academyTutorials } from "../data/pages.js";

const LEVEL_CLASS = {
  Beginner: "levelBeginner",
  Intermediate: "levelIntermediate",
  Advanced: "levelAdvanced",
};

export default function AcademyPage({ onToast }) {
  const [query, setQuery] = useState("");
  const collRef = useRef(null);

  const tutorials = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return academyTutorials;
    return academyTutorials.filter((t) => t.title.toLowerCase().includes(q));
  }, [query]);

  const scrollCollections = (dir) => collRef.current?.scrollBy({ left: dir * 420, behavior: "smooth" });

  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Spline Academy</h1>
        <p className={styles.heroSub}>
          Learn to design and build in 3D with tutorials, guides, and courses — from basics to advanced.
        </p>
        <label className={styles.search}>
          <IconSearch />
          <input
            type="search"
            placeholder="What do you want to learn?"
            aria-label="Search tutorials"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className={styles.topics}>
          {academyTopics.map((topic) => (
            <button key={topic} type="button" className={styles.topicPill} onClick={() => setQuery(topic)}>
              {topic}
            </button>
          ))}
          <button type="button" className={styles.exploreAll} onClick={() => onToast("Explore All — Academy")}>
            Explore All &gt;
          </button>
        </div>
      </header>

      <section className={styles.section} aria-label="Collections">
        <div className={styles.sectionHead}>
          <h2>Collections</h2>
          <div className={styles.arrows}>
            <button type="button" aria-label="Scroll collections left" onClick={() => scrollCollections(-1)}>‹</button>
            <button type="button" aria-label="Scroll collections right" onClick={() => scrollCollections(1)}>›</button>
          </div>
        </div>
        <div className={styles.collRow} ref={collRef}>
          {academyCollections.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.collCard}
              onClick={() => onToast(`Collection — ${item.title}`)}
            >
              <span className={styles.collArt}>
                <Art hues={item.hues} seed={item.seed} light={item.light} />
              </span>
              <span className={styles.collTitle}>{item.title}</span>
              <span className={styles.metaRow}>
                <span className={styles.meta}>{item.meta}</span>
                <span className={`${styles.level} ${styles[LEVEL_CLASS[item.level]]}`}>{item.level}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section} aria-label="Tutorials">
        <div className={styles.sectionHead}>
          <h2>Tutorials</h2>
        </div>
        <div className={styles.filterRow}>
          {["Product", "Feature", "Level"].map((f) => (
            <button key={f} type="button" className={styles.selectBtn} onClick={() => onToast(`Filter — ${f}`)}>
              {f} <IconCaret />
            </button>
          ))}
          <span className={styles.spacer} />
          <span className={styles.showing}>Showing 140+ tutorials</span>
        </div>
        <div className={styles.grid}>
          {tutorials.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.card}
              onClick={() => onToast(`Tutorial — ${item.title}`)}
            >
              <span className={styles.cardArt}>
                <Art hues={item.hues} seed={item.seed} />
              </span>
              <span className={styles.cardTitle}>{item.title}</span>
              <span className={styles.metaRow}>
                <span className={styles.meta}>{item.meta}</span>
                <span className={`${styles.level} ${styles[LEVEL_CLASS[item.level]]}`}>{item.level}</span>
              </span>
            </button>
          ))}
        </div>
        {tutorials.length === 0 ? <p className={styles.empty}>No tutorials match “{query}”.</p> : null}
      </section>
    </div>
  );
}

