import { useEffect, useLayoutEffect, useRef, useState } from "react";
import styles from "./DropdownMenu.module.css";

export default function DropdownMenu({ open, items, value, onSelect, anchorRef, onClose }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const menu = menuRef.current;
    const mh = menu ? menu.offsetHeight : 160;
    const mw = Math.max(menu ? menu.offsetWidth : 0, 240);
    let left = rect.left;
    let top = rect.top - mh - 8;
    if (left + mw > window.innerWidth - 8) left = Math.max(8, window.innerWidth - mw - 8);
    if (top < 8) top = Math.min(rect.bottom + 8, window.innerHeight - mh - 8);
    setPos({ left, top });
  }, [open, anchorRef, items]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (anchorRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  return (
    <div ref={menuRef} className={styles.menu} role="menu" style={{ left: pos.left, top: pos.top }}>
      {items.map((item) => {
        const selected = value === item.label;
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={`${styles.item} ${selected ? styles.itemActive : ""}`}
            onClick={() => onSelect(item)}
          >
            <span className={styles.check}>{selected ? "✓" : ""}</span>
            <span className={styles.copy}>
              <span className={styles.line1}>
                <span className={styles.label}>{item.label}</span>
                {item.description ? <span className={styles.desc}> — {item.description}</span> : null}
              </span>
              {item.model ? <span className={styles.model}>{item.model}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
