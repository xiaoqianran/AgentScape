import { useEffect, useRef, useState } from "react";
import styles from "./HomeRecents.module.css";
import { recents, paintThumb } from "../data/home.js";

function Thumb({ art }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) paintThumb(ref.current, art);
  }, [art]);
  return (
    <span className={styles.thumb}>
      <canvas ref={ref} className={styles.thumbArt} aria-hidden="true" />
    </span>
  );
}

export default function HomeRecents({ onOpen }) {
  return (
    <section className={styles.section} aria-label="Recent files">
      <h2 className={styles.label}>Recents</h2>
      <ul className={styles.list}>
        {recents.map((file) => (
          <li key={file.id}>
            <button type="button" className={styles.row} onClick={() => onOpen(file.name)}>
              <Thumb art={file.art} />
              <span className={styles.name}>{file.name}</span>
              <span className={styles.time}>{file.time}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
