import styles from "./UserSidebar.module.css";
import {
  IconHome,
  IconFile,
  IconTemplates,
  IconCommunity,
  IconAcademy,
  IconArena,
  IconSearch,
  IconInbox,
  IconChevron,
  IconPlus,
  IconClose,
  IconMcp,
  IconBolt,
  IconGear,
  IconCube,
} from "./icons.jsx";
import { workspace, routeTitles } from "../data/home.js";

const NAV = [
  { id: "home", label: routeTitles.home, Icon: IconHome },
  { id: "files", label: routeTitles.files, Icon: IconFile },
  { id: "templates", label: routeTitles.templates, Icon: IconTemplates },
  { id: "community", label: routeTitles.community, Icon: IconCommunity },
  { id: "academy", label: routeTitles.academy, Icon: IconAcademy },
  { id: "arena", label: routeTitles.arena, Icon: IconArena },
];

export default function UserSidebar({
  route,
  onRoute,
  onToast,
  onSearch,
  mcpVisible,
  onDismissMcp,
  onWorkspaceClick,
  onInbox,
  onNewProject,
}) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.headerRow}>
        <button type="button" className={styles.workspaceBtn} onClick={onWorkspaceClick} aria-haspopup="menu">
          <span className={styles.avatar}>{workspace.avatar}</span>
          <span className={styles.workspaceName}>{workspace.name}</span>
          <span className={styles.chevron}>
            <IconChevron />
          </span>
        </button>
        <button type="button" className={styles.iconBtn} title="Search files (Ctrl/⌘ K)" aria-label="Search files" onClick={onSearch}>
          <IconSearch />
        </button>
        <button type="button" className={styles.iconBtn} title="Inbox" aria-label="Inbox" onClick={onInbox}>
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
                  aria-current={route === id ? "page" : undefined}
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

        <nav className={`${styles.nav} ${styles.appNav}`} aria-label="AgentScape applications">
          <ul>
            <li><a className={styles.navItem} href="/studio/"><span className={styles.navIcon}><IconCube /></span>AgentScape Studio ↗</a></li>
            <li><a className={styles.navItem} href="/observatory/">Observatory ↗</a></li>
          </ul>
        </nav>

        <div className={styles.projectsHead}>
          <h4>Projects</h4>
          <button type="button" className={styles.iconBtnSm} aria-label="New Project" onClick={onNewProject}>
            <IconPlus />
          </button>
        </div>
        <button type="button" className={styles.newProjectBtn} onClick={onNewProject}>
          <IconPlus />
          New Project
        </button>

        <div className={styles.cards}>
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

          <div className={styles.trialCard}>
            <p className={styles.trialText}>
              You have <strong>6 days left</strong> in your trial
            </p>
            <button type="button" className={styles.trialBtn} onClick={() => onToast("View plans")}>
              View plans
            </button>
          </div>
        </div>
      </div>

      <div className={styles.menuBottomContainer}>
        <button type="button" className={styles.settingsRow} onClick={() => onToast("Settings")}>
          <span className={styles.navIcon}>
            <IconGear />
          </span>
          Settings
        </button>
        <button type="button" className={styles.userRow} onClick={onWorkspaceClick} aria-haspopup="menu">
          <span className={styles.avatar}>{workspace.avatar}</span>
          <span className={styles.userName}>{workspace.user}</span>
          <span className={styles.plan}>Free</span>
          <span className={styles.chevron}>
            <IconChevron />
          </span>
        </button>
      </div>
    </aside>
  );
}

