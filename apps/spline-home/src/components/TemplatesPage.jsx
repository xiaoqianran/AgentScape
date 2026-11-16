import { useMemo, useRef, useState } from "react";
import styles from "./TemplatesPage.module.css";
import Art from "./Art.jsx";
import { IconSearch } from "./icons.jsx";
import { templateTabs, templateSections, moreCategories } from "../data/pages.js";

function CollageCard({ category, onToast }) {
  return (
    <button type="button" className={styles.collageCard} onClick={() => onToast(`Category — ${category.name}`)}>
      <span className={styles.collageTiles}>
        {category.hues.map((hue, i) => (
          <span key={i} className={styles.collageTile}>
            <Art hues={[hue, (hue + 45) % 360]} seed={i + 1} />
          </span>
        ))}
      </span>
      <span className={styles.collageName}>{category.name}</span>
    </button>
  );
}

export function CategoryCarousel({ onToast }) {
  const trackRef = useRef(null);
  const scroll = (dir) => trackRef.current?.scrollBy({ left: dir * 540, behavior: "smooth" });
  return (
    <div className={styles.carouselWrap}>
      <div className={styles.carouselBtns}>
        <button type="button" aria-label="Scroll categories left" onClick={() => scroll(-1)}>‹</button>
        <button type="button" aria-label="Scroll categories right" onClick={() => scroll(1)}>›</button>
      </div>
      <div className={styles.carousel} ref={trackRef}>
        {moreCategories.map((cat) => (
          <CollageCard key={cat.id} category={cat} onToast={onToast} />
        ))}
      </div>
    </div>
  );
}

export default function TemplatesPage({ onToast }) {
  const [tab, setTab] = useState("Overview");
  const [query, setQuery] = useState("");

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templateSections
      .filter((s) => tab === "Overview" || s.title === tab)
      .map((s) => ({
        ...s,
        cards: s.cards.filter((c) => !q || c.title.toLowerCase().includes(q)),
      }))
      .filter((s) => s.cards.length > 0);
  }, [tab, query]);

  return (
    <div className={styles.wrap}>
      <header className={styles.hero}>
        <h1 className={styles.heroTitle}>Templates</h1>
        <p className={styles.heroSub}>
          Jumpstart your next project with templates built by the Spline team and community.
        </p>
        <div className={styles.tabs} role="tablist" aria-label="Template categories">
          {templateTabs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`${styles.tabBtn} ${tab === t ? styles.tabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <label className={styles.search}>
          <IconSearch />
          <input
            type="search"
            placeholder="Search templates…"
            aria-label="Search templates"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </header>

      {sections.map((section) => (
        <section key={section.id} className={styles.section} aria-label={section.title}>
          <div className={styles.sectionHead}>
            <h2>{section.title}</h2>
            <button type="button" className={styles.showMore} onClick={() => onToast(`Show more — ${section.title}`)}>
              Show more
            </button>
          </div>
          <div className={styles.grid}>
            {section.cards.map((card) => (
              <button
                key={card.id}
                type="button"
                className={styles.card}
                onClick={() => onToast(`Template — ${card.title}`)}
              >
                <span className={styles.cardArt} style={{ aspectRatio: section.ratio }}>
                  <Art hues={card.hues} seed={card.seed} />
                </span>
                <span className={styles.cardTitle}>{card.title}</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      {sections.length === 0 ? <p className={styles.empty}>No templates match “{query}”.</p> : null}

      <section className={styles.section} aria-label="More Categories">
        <div className={styles.sectionHead}>
          <h2>More Categories</h2>
        </div>
        <CategoryCarousel onToast={onToast} />
      </section>
    </div>
  );
}

