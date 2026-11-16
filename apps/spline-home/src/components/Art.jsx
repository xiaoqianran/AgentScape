import styles from "./Art.module.css";

/**
 * CSS-art placeholder surface (no external images): layered radial +
 * linear gradients keyed by two hues, with an optional light variant
 * for bright (Hana-style) cards.
 */
export default function Art({ hues = [222, 262], seed = 0, light = false, className = "" }) {
  const [a, b] = hues;
  const background = light
    ? `radial-gradient(130% 120% at ${18 + seed * 7}% 12%, hsl(${a} 30% 82% / 0.9), transparent 55%), linear-gradient(140deg, hsl(${a} 18% 94%), hsl(${b} 16% 84%))`
    : `radial-gradient(130% 120% at ${18 + seed * 7}% 12%, hsl(${a} 72% 64% / 0.9), transparent 55%), radial-gradient(120% 130% at ${82 - seed * 5}% 88%, hsl(${b} 68% 46% / 0.85), transparent 55%), linear-gradient(140deg, hsl(${a} 36% 30%), hsl(${b} 40% 15%))`;
  return <div className={`${styles.art} ${className}`} style={{ background }} aria-hidden="true" />;
}

