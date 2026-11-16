import { useMemo, useState } from "react";
import styles from "./CommunityPage.module.css";
import Art from "./Art.jsx";
import { IconSearch, IconCaret } from "./icons.jsx";
import { CategoryCarousel } from "./TemplatesPage.jsx";
import { workspace } from "../data/home.js";
import {
  communityForYou,
  communityHana,
  communitySections,
  creators,
  allResources,
} from "../data/pages.js";

function CommunityCard({ card, onToast }) {
  return (
    <button type="button" className={styles.card} onClick={() => onToast(`Open — ${card.title}`)}>
      <span className={styles.cardArt}>
        <Art hues={card.hues} seed={card.seed} light={card.light} />
      </span>
      <span className={styles.cardTitle}>{card.title}</span>
      <span className={styles.authorRow}>
        <span className={styles.avatar} style={{ background: `hsl(${card.hues[0]} 45% 38%)` }}>
          {card.author.charAt(0)}
        </span>
        <span className={styles.authorName}>{card.author}</span>
        <span className={styles.stats}>👁 {card.views} · ♥ {card.likes}</span>
      </span>
    </button>
  );
}

function CardSection({ title, badge, cards, onToast }) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h2>
          {title}
          {badge ? <span className={styles.newBadge}>{badge}</span> : null}
        </h2>
      </div>
      <div className={styles.grid}>
        {cards.map((card) => (
          <CommunityCard key={card.id} card={card} onToast={onToast} />
        ))}
      </div>
    </section>
  );
}

export default function CommunityPage({ onToast }) {
  const [tab, setTab] = useState("Explore");
  const [resTab, setResTab] = useState("Trending");
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState(() => new Set());

  const toggleFollow = (id) => {
    setFollowing((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const forYou = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return communityForYou;
    return communityForYou.filter((c) => c.title.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className={styles.wrap}>
      <div className={styles.topRow}>
        <div className={styles.tabs} role="tablist" aria-label="Community">
          {["Explore", "Feed", "Notifications"].map((t) => (
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
        <span className={styles.spacer} />
        <label className={styles.search}>
          <IconSearch />
          <input
            type="search"
            placeholder="Search Community"
            aria-label="Search Community"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button type="button" className={styles.publishBtn} onClick={() => onToast("Publish is not connected in this preview.")}>
          Publish
        </button>
        <button type="button" className={styles.profileBtn} aria-label="Profile" onClick={() => onToast(workspace.name)}>
          {workspace.avatar}
        </button>
      </div>

      {tab !== "Explore" ? (
        <p className={styles.empty}>
          {tab === "Feed" ? "Your feed is empty — follow creators to see their latest work here." : "No new notifications."}
        </p>
      ) : (
        <>
          <section className={styles.section} aria-label="For you">
            <div className={styles.sectionHead}>
              <h2>
                For you based on Brand &amp; Marketing <IconCaret />
              </h2>
            </div>
            <div className={styles.grid}>
              {forYou.map((card) => (
                <CommunityCard key={card.id} card={card} onToast={onToast} />
              ))}
            </div>
            {forYou.length === 0 ? <p className={styles.empty}>No results for “{query}”.</p> : null}
          </section>

          <CardSection title="Spline Hana" badge="NEW" cards={communityHana} onToast={onToast} />

          <section className={styles.section} aria-label="Meet the creators">
            <div className={styles.sectionHead}>
              <h2>Meet the creators</h2>
            </div>
            <div className={styles.creators}>
              {creators.map((person) => (
                <div key={person.id} className={styles.creator}>
                  <span className={styles.creatorAvatar} style={{ background: `hsl(${person.hue} 45% 38%)` }}>
                    {person.name.charAt(0)}
                  </span>
                  <span className={styles.creatorName}>{person.name}</span>
                  <span className={styles.creatorHandle}>{person.handle}</span>
                  <button
                    type="button"
                    className={`${styles.followBtn} ${following.has(person.id) ? styles.followActive : ""}`}
                    onClick={() => toggleFollow(person.id)}
                  >
                    {following.has(person.id) ? "Following" : "+ Follow"}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {communitySections.map((section) => (
            <CardSection key={section.id} title={section.title} cards={section.cards} onToast={onToast} />
          ))}

          <section className={styles.section} aria-label="More Categories">
            <div className={styles.sectionHead}>
              <h2>More Categories</h2>
            </div>
            <CategoryCarousel onToast={onToast} />
          </section>

          <section className={styles.section} aria-label="All Resources">
            <div className={styles.sectionHead}>
              <h2>All Resources</h2>
            </div>
            <div className={styles.resRow}>
              <div className={styles.resTabs}>
                {["Trending", "Popular", "New"].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`${styles.resTab} ${resTab === t ? styles.resTabActive : ""}`}
                    onClick={() => setResTab(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <span className={styles.spacer} />
              <button type="button" className={styles.selectBtn} onClick={() => onToast("Filter — All types")}>
                All types <IconCaret />
              </button>
            </div>
            <div className={styles.grid}>
              {allResources.slice(0, 9).map((card) => (
                <CommunityCard key={`all-${card.id}`} card={card} onToast={onToast} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

