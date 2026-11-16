import { useState } from "react";
import styles from "./ArenaPage.module.css";
import Art from "./Art.jsx";
import {
  IconChevron,
  IconSearch,
  IconInbox,
  IconArrowLeft,
  IconDots,
  IconExpand,
  IconSend,
} from "./icons.jsx";
import { workspace } from "../data/home.js";
import { arenaRankings } from "../data/pages.js";

const ARENA_NAV = [
  { id: "vote", label: "Vote" },
  { id: "battle", label: "Battle" },
  { id: "rankings", label: "Rankings" },
];

const VOTE_OPTIONS = ["A is better", "Tie", "Both bad", "B is better"];

const PARETO_DOTS = [
  { x: 12, y: 68 }, { x: 22, y: 55 }, { x: 30, y: 62 }, { x: 38, y: 40 },
  { x: 47, y: 48 }, { x: 55, y: 30 }, { x: 63, y: 38 }, { x: 71, y: 22 },
  { x: 80, y: 28 }, { x: 88, y: 14 },
];

function StageCard({ label, hues, seed, onToast }) {
  return (
    <div className={styles.stage}>
      <Art hues={hues} seed={seed} />
      <span className={styles.stageBadge}>{label}</span>
      <button
        type="button"
        className={styles.stageDots}
        aria-label={`More actions for scene ${label}`}
        onClick={() => onToast(`Scene ${label} — actions`)}
      >
        <IconDots />
      </button>
      <span className={styles.stageExpand} aria-hidden="true">
        <IconExpand />
      </span>
    </div>
  );
}

function VoteView({ onRoute, onToast }) {
  const [choice, setChoice] = useState(null);
  return (
    <div>
      <h2 className={styles.viewTitle}>Vote</h2>
      <p className={styles.eyebrow}>BLIND VOTE · TWO AI MODELS, SAME PROMPT</p>
      <h1 className={styles.promptTitle}>A cute 3D robot character</h1>
      <p className={styles.lede}>
        Compare the generated scenes and vote for the one you like best. Both scenes come from the same prompt.
      </p>
      <button type="button" className={styles.tryBtn} onClick={() => onRoute("generate")}>
        Try it yourself
      </button>

      <StageCard label="A" hues={[222, 275]} seed={1} onToast={onToast} />
      <StageCard label="B" hues={[150, 200]} seed={3} onToast={onToast} />

      <div className={styles.voteRow} role="group" aria-label="Vote options">
        {VOTE_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={`${styles.votePill} ${choice === option ? styles.votePillActive : ""}`}
            aria-pressed={choice === option}
            onClick={() => {
              setChoice(option);
              onToast(`Vote recorded — “${option}”`);
            }}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function BattleView({ onToast }) {
  const [prompt, setPrompt] = useState("");
  return (
    <div className={styles.battleWrap}>
      <div className={styles.battleHead}>
        <span className={styles.battlesLeft}>3 battles left</span>
      </div>
      <h1 className={styles.battleTitle}>What should two AIs build?</h1>
      <div className={styles.battleCard}>
        <textarea
          className={styles.battleInput}
          rows={4}
          placeholder="Describe anything… a toy robot, a retro camera, a game level…"
          aria-label="Battle prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className={styles.battleFoot}>
          <span className={styles.battleMeta}>A vs B · 2 AI models · Runs in the cloud</span>
          <button
            type="button"
            className={styles.startBtn}
            disabled={!prompt.trim()}
            aria-label="Start battle"
            title="Start battle"
            onClick={() => {
              onToast("Battle started — two AIs are building…");
              setPrompt("");
            }}
          >
            <span className={styles.startArrow}>
              <IconSend />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function RankingsView() {
  const top = arenaRankings.slice(0, 10);
  const maxElo = arenaRankings[0].elo;
  return (
    <div>
      <div className={styles.rankHead}>
        <div>
          <h1 className={styles.rankTitle}>Rankings</h1>
          <p className={styles.lede}>
            Community-driven rankings based on votes cast by Spline users. Votes are anonymous, blind, and pairwise.
          </p>
        </div>
        <span className={styles.rankStats}>Arena: 1.1k votes · 14 models</span>
      </div>

      <h3 className={styles.sectionTitle}>Top 10 by Elo Rating</h3>
      <div className={styles.bars}>
        {top.map((row) => (
          <div key={row.model} className={styles.barRow}>
            <span className={styles.barName}>{row.model}</span>
            <span className={styles.barTrack}>
              <span className={styles.barFill} style={{ width: `${(row.elo / maxElo) * 100}%` }} />
            </span>
            <span className={styles.barValue}>{row.elo}</span>
          </div>
        ))}
      </div>

      <h3 className={styles.sectionTitle}>Full Leaderboard</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Model</th>
            <th>Elo</th>
            <th>W</th>
            <th>L</th>
            <th>Win rate</th>
          </tr>
        </thead>
        <tbody>
          {arenaRankings.map((row, i) => (
            <tr key={row.model}>
              <td className={styles.rankNum}>{i + 1}</td>
              <td>{row.model}</td>
              <td>{row.elo}</td>
              <td>{row.wins}</td>
              <td>{row.losses}</td>
              <td>{((row.wins / (row.wins + row.losses)) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.plots}>
        <div className={styles.plotPanel}>
          <h4 className={styles.plotTitle}>Pareto Front (Elo vs Cost)</h4>
          <div className={styles.plotArea}>
            {PARETO_DOTS.map((dot, i) => (
              <span
                key={i}
                className={styles.plotDot}
                style={{ left: `${dot.x}%`, bottom: `${dot.y}%` }}
              />
            ))}
          </div>
          <p className={styles.plotCaption}>Simplified placeholder — cost → · Elo ↑</p>
        </div>
        <div className={styles.plotPanel}>
          <h4 className={styles.plotTitle}>Head-to-Head Win Rates</h4>
          <div className={styles.heat}>
            {Array.from({ length: 100 }).map((_, i) => (
              <span
                key={i}
                className={styles.heatCell}
                style={{ background: `hsl(222 70% ${16 + ((i * 37) % 52)}%)` }}
              />
            ))}
          </div>
          <p className={styles.plotCaption}>Simplified placeholder — 0% → 100% win rate</p>
        </div>
      </div>
    </div>
  );
}

export default function ArenaPage({ onRoute, onSearch, onToast }) {
  const [view, setView] = useState("vote");

  return (
    <div className={styles.root}>
      <aside className={styles.sub} aria-label="Spline Arena navigation">
        <button type="button" className={styles.subHead} onClick={() => onToast("Spline Arena")}>
          <span>Spline Arena</span>
          <IconChevron />
        </button>
        <nav className={styles.subNav}>
          {ARENA_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.subNavItem} ${view === item.id ? styles.subNavActive : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className={styles.subBottom}>
          <button type="button" className={styles.wsRow} onClick={() => onToast(workspace.name)}>
            <span className={styles.wsAvatar}>{workspace.avatar}</span>
            <span className={styles.wsName}>{workspace.name}</span>
            <IconChevron />
          </button>
          <div className={styles.subIcons}>
            <button type="button" aria-label="Back to Home" title="Back to Home" onClick={() => onRoute("home")}>
              <IconArrowLeft />
            </button>
            <button type="button" aria-label="Search files" title="Search files" onClick={onSearch}>
              <IconSearch />
            </button>
            <button type="button" aria-label="Inbox" title="Inbox" onClick={() => onToast("Inbox — 1 unread")}>
              <IconInbox />
            </button>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <div className={styles.inner}>
          {view === "vote" ? <VoteView onRoute={onRoute} onToast={onToast} /> : null}
          {view === "battle" ? <BattleView onToast={onToast} /> : null}
          {view === "rankings" ? <RankingsView /> : null}
        </div>
      </div>
    </div>
  );
}

