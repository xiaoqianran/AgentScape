import { useRef, useState } from "react";
import styles from "./HomeHero.module.css";
import DropdownMenu from "./DropdownMenu.jsx";
import { IconAttach, IconOrbit, IconCaret, IconSend } from "./icons.jsx";
import { examples, modeOptions, qualityOptions, effortOptions } from "../data/home.js";

export default function HomeHero({ onToast }) {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState("3D Scene");
  const [quality, setQuality] = useState("Medium");
  const [effort, setEffort] = useState("High");
  const [openMenu, setOpenMenu] = useState(null);

  const modeRef = useRef(null);
  const qualityRef = useRef(null);
  const effortRef = useRef(null);
  const taRef = useRef(null);

  const submit = () => {
    const text = prompt.trim();
    if (!text) return;
    onToast(`Queued (${mode} · ${quality} · ${effort}): ${text.slice(0, 42)}${text.length > 42 ? "…" : ""}`);
    setPrompt("");
    if (taRef.current) taRef.current.style.height = "auto";
  };

  const autosize = (el) => {
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  };

  const toggle = (name) => setOpenMenu((cur) => (cur === name ? null : name));

  const menuProps = {
    mode: {
      open: openMenu === "mode",
      items: modeOptions,
      value: mode,
      onSelect: (item) => {
        setMode(item.label);
        setOpenMenu(null);
      },
      anchorRef: modeRef,
      onClose: () => setOpenMenu(null),
    },
    quality: {
      open: openMenu === "quality",
      items: qualityOptions,
      value: quality,
      onSelect: (item) => {
        setQuality(item.label);
        setOpenMenu(null);
      },
      anchorRef: qualityRef,
      onClose: () => setOpenMenu(null),
    },
    effort: {
      open: openMenu === "effort",
      items: effortOptions,
      value: effort,
      onSelect: (item) => {
        setEffort(item.label);
        setOpenMenu(null);
      },
      anchorRef: effortRef,
      onClose: () => setOpenMenu(null),
    },
  };

  return (
    <section className={styles.hero} aria-label="Generate">
      <div className={styles.exampleChips}>
        {examples.map((text) => (
          <button
            key={text}
            type="button"
            className={styles.exampleChip}
            onClick={() => {
              setPrompt(text);
              requestAnimationFrame(() => {
                taRef.current?.focus();
                if (taRef.current) autosize(taRef.current);
              });
            }}
          >
            {text}
          </button>
        ))}
      </div>

      <div className={styles.promptContainer}>
        <textarea
          ref={taRef}
          className={styles.textarea}
          rows={1}
          placeholder="Describe or type / for commands"
          aria-label="Describe or type / for commands"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            autosize(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className={styles.toolbar}>
          <button type="button" className={styles.toolIcon} title="Attach files" aria-label="Attach files" onClick={() => onToast("Attach files")}>
            <IconAttach />
          </button>

          <button ref={modeRef} type="button" className={styles.toolBtn} onClick={() => toggle("mode")}>
            <IconOrbit width="14" height="14" />
            <span>{mode}</span>
            <IconCaret />
          </button>
          <button ref={qualityRef} type="button" className={styles.toolBtn} title="Quality" onClick={() => toggle("quality")}>
            <span>{quality}</span>
            <IconCaret />
          </button>
          <button ref={effortRef} type="button" className={styles.toolBtn} title="Thinking effort" onClick={() => toggle("effort")}>
            <span>{effort}</span>
            <IconCaret />
          </button>

          <span className={styles.spacer} />

          <button
            type="button"
            className={styles.sendBtn}
            disabled={!prompt.trim()}
            title="Send"
            aria-label="Send"
            onClick={submit}
          >
            <IconSend />
          </button>
        </div>
      </div>

      <DropdownMenu {...menuProps.mode} />
      <DropdownMenu {...menuProps.quality} />
      <DropdownMenu {...menuProps.effort} />
    </section>
  );
}
