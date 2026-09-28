import styles from "./CreateActions.module.css";
import { IconOrbit, IconPen, IconGenerate, IconImport } from "./icons.jsx";

const ACTIONS = [
  { id: "scene", label: "3D Scene", Icon: IconOrbit },
  { id: "design", label: "Design", Icon: IconPen },
  { id: "generate", label: "Generate", Icon: IconGenerate },
  { id: "import", label: "Import", Icon: IconImport },
];

export default function CreateActions({ onAction }) {
  return (
    <div className={styles.actions} role="group" aria-label="Create">
      {ACTIONS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`${styles.action} ${styles[id]}`}
          onClick={() => onAction(id)}
        >
          <span className={styles.icon}>
            <Icon />
          </span>
          <span className={styles.label}>{label}</span>
        </button>
      ))}
    </div>
  );
}
