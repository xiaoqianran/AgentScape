import styles from "./UserSidebar.module.css";
import {
  IconHome,
  IconFile,
  IconTemplates,
  IconCommunity,
  IconAcademy,
  IconSearch,
  IconInbox,
  IconChevron,
  IconPlus,
  IconClose,
  IconMcp,
  IconBolt,
} from "./icons.jsx";
import { workspace, routeTitles } from "../data/home.js";

const NAV = [
  { id: "home", label: routeTitles.home, Icon: IconHome },
  { id: "files", label: routeTitles.files, Icon: IconFile },
  { id: "templates", label: routeTitles.templates, Icon: IconTemplates },
  { id: "community", label: routeTitles.community, Icon: IconCommunity },
  { id: "academy", label: routeTitles.academy, Icon: IconAcademy },
];

export default function UserSidebar({ route, onRoute, onToast, mcpVisible, onDismissMcp }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.workspaceBtn} onClick={() => onToast(workspace.name)}>
          <span className={styles.avatar}>{workspace.avatar}</span>
          <span className={styles.workspaceName}>{workspace.name}</span>
          <span className={styles.chevron}>
            <IconChevron />
          </span>
        </button>
        <button type="button" className={styles.iconBtn} title="Search" aria-label="Search" onClick={() => onToast("Search — Cmd/Ctrl K")}>
          <IconSearch />
        </button>
        <button type="button" className={styles.iconBtn} title="Inbox" aria-label="Inbox" onClick={() => onToast("Inbox — 1 unread")}>
          <IconInbox />
          <span className={styles.badge} />
        </button>
      </div>

      <div className={styles.scrollableArea}>
        <nav className={styles.nav} aria-label="Main navigation">
          <ul>
            {NAV.map(({ id, label, Icon }) => (
              <li key={id}>
                <a
                  href={`#/${id}`}
                  className={`${styles.navItem} ${route === id ? styles.navItemActive : ""}`}
                  onClick={(e) => {
                    e.preventDefault();
                    onRoute(id);
                  }}
                >
                  <span className={styles.navIcon}>
                    <Icon />
                  </span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.projectsHead}>
          <h4>Projects</h4>
          <button type="button" className={styles.iconBtnSm} aria-label="New Project" onClick={() => onToast("New Project")}>
            <IconPlus />
          </button>
        </div>
        <button type="button" className={styles.newProjectBtn} onClick={() => onToast("New Project")}>
          <IconPlus />
          New Project
        </button>
      </div>

      <div className={styles.menuBottomContainer}>
        {mcpVisible ? (
          <div className={styles.mcpCard}>
            <button type="button" className={styles.mcpMain} onClick={() => onToast("Connect with MCP")}>
              <span className={styles.mcpIcon}>
                <IconMcp />
              </span>
              <span className={styles.mcpCopy}>
                <span className={styles.mcpTitle}>Connect with MCP</span>
                <span className={styles.mcpSub}>Build with agentic tools.</span>
              </span>
            </button>
            <button type="button" className={styles.dismiss} aria-label="Dismiss" onClick={onDismissMcp}>
              <IconClose />
            </button>
          </div>
        ) : null}

        <div className={styles.referCard}>
          <div className={styles.referRow}>
            <span className={styles.bolt}>
              <IconBolt />
            </span>
            <span className={styles.referTitle}>Refer a friend</span>
          </div>
          <p className={styles.referSub}>
            Give 30% off Spline Pro plan,
            <br />
            Get 30%
          </p>
          <button type="button" className={styles.referBtn} onClick={() => onToast("Referral link copied")}>
            Refer a friend
          </button>
        </div>
      </div>
    </aside>
  );
}
