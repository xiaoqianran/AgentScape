import styles from "./ConceptDesign.module.css";

export default function ConceptDesign() {
  return (
    <section className={styles.concept} aria-label="概念设计 Concept design">
      <div className={styles.badge}>概念设计 · Concept Design</div>
      <h2 className={styles.title}>没有布景，一切可交互</h2>
      <p className={styles.note}>
        本片为概念设想（mock），画面由 AI 生成素材剪辑而成，描绘的是 AgentScape 希望抵达的形态，
        <strong>不代表当前版本已经实现这些功能</strong>
        。当前真实能力请以 GitHub 仓库中的候选版本能力矩阵为准。
      </p>
      <p className={styles.noteEn}>
        A concept film (mock) — the vision AgentScape is heading toward, not a recording of the current release.
      </p>
      <video
        className={styles.video}
        controls
        preload="none"
        poster="/media/agentscape-concept-poster.jpg"
        src="/media/agentscape-concept-30s.mp4"
      />
      <p className={styles.caption}>30 秒概念片 · 片中画面均为生成素材，非实拍录屏 · MOCK</p>
    </section>
  );
}
