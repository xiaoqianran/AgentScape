import styles from "./App.module.css";
import UserSidebar from "./components/UserSidebar.jsx";
import CreateActions from "./components/CreateActions.jsx";
import HomeRecents from "./components/HomeRecents.jsx";
import HomeHero from "./components/HomeHero.jsx";
import ConceptDesign from "./components/ConceptDesign.jsx";
import GeneratePage from "./components/GeneratePage.jsx";
import SceneEditor from "./components/SceneEditor.jsx";
import DesignEditor from "./components/DesignEditor.jsx";
import FilesPage from "./components/FilesPage.jsx";
import TemplatesPage from "./components/TemplatesPage.jsx";
import CommunityPage from "./components/CommunityPage.jsx";
import AcademyPage from "./components/AcademyPage.jsx";
import ArenaPage from "./components/ArenaPage.jsx";
import { WorkspaceMenu, InboxPanel, NewProjectModal, ImportModal } from "./components/Dialogs.jsx";
import { IconSearch, IconClose } from "./components/icons.jsx";
import { workspace, recents, routeTitles, importAccept, paintThumb } from "./data/home.js";
import { useCallback, useEffect, useRef, useState } from "react";

const ROUTES = ["home", "scene", "design", "generate", "files", "templates", "community", "academy", "arena"];

function readRoute() {
  const raw = (typeof location !== "undefined" && location.hash.replace(/^#\/?/, "")) || "home";
  return routeTitles[raw] ? raw : "home";
}

function View({ active, children, label }) {
  return (
    <div
      className={`${styles.view}${active ? ` ${styles.viewActive}` : ""}`}
      data-view={label}
      data-active={active ? "1" : "0"}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function SearchThumb({ art }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) paintThumb(ref.current, art);
  }, [art]);
  return (
    <span className={styles.searchThumb}>
      <canvas ref={ref} className={styles.searchThumbArt} aria-hidden="true" />
    </span>
  );
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [mcpVisible, setMcpVisible] = useState(true);
  const [toast, setToast] = useState("");
  const [toastOn, setToastOn] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [panel, setPanel] = useState(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [sceneFile, setSceneFile] = useState("Spline 3D Starter File");
  const [designFile, setDesignFile] = useState("Hana starter file");
  const importRef = useRef(null);
  const skipHashSync = useRef(false);

  const showToast = useCallback((message) => {
    setToast(message);
    setToastOn(true);
    window.clearTimeout(showToast._t);
    showToast._t = window.setTimeout(() => setToastOn(false), 1600);
  }, []);

  const onRoute = useCallback((next) => {
    if (!ROUTES.includes(next)) next = "home";
    setPanel(null);
    skipHashSync.current = true;
    if (location.hash !== `#/${next}`) {
      window.history.pushState(null, "", `#/${next}`);
    }
    setRoute(next);
    requestAnimationFrame(() => {
      skipHashSync.current = false;
    });
  }, []);

  useEffect(() => {
    const onHash = () => {
      if (skipHashSync.current) return;
      setRoute(readRoute());
    };
    const onPop = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchQuery("");
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setPanel(null);
        setNewProjectOpen(false);
        setImportOpen(false);
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  const openSearch = useCallback(() => {
    setSearchQuery("");
    setSearchOpen(true);
  }, []);

  const togglePanel = useCallback((name) => {
    setPanel((cur) => (cur === name ? null : name));
  }, []);

  const onCreate = (action) => {
    if (action === "scene") {
      setSceneFile("Spline 3D Starter File");
      onRoute("scene");
    } else if (action === "design") {
      setDesignFile("Hana starter file");
      onRoute("design");
    } else if (action === "generate") onRoute("generate");
    else if (action === "import") setImportOpen(true);
  };

  const createProject = (name) => {
    setNewProjectOpen(false);
    setSceneFile(name);
    onRoute("scene");
    showToast(`Created “${name}”`);
  };

  const openFile = (name) => {
    if (name.includes("Hana")) {
      setDesignFile(name);
      onRoute("design");
    } else if (name.includes("Starter") || name.includes("Mini Room") || name === "Untitled") {
      setSceneFile(name);
      onRoute("scene");
    } else {
      showToast(`Opening “${name}”…`);
    }
  };

  const isShell = route === "home" || route === "files" || route === "templates" || route === "community" || route === "academy";

  const query = searchQuery.trim().toLowerCase();
  const matches = recents.filter((file) => !query || file.name.toLowerCase().includes(query));
  const searchGroups = query
    ? [{ id: "results", label: "RESULTS", items: matches }]
    : [
        { id: "previous", label: "PREVIOUS 30 DAYS", items: matches.filter((f) => f.group === "previous") },
        { id: "older", label: "OLDER", items: matches.filter((f) => f.group === "older") },
      ].filter((g) => g.items.length > 0);

  return (
    <div className={styles.pageContainer}>
      <div className={`${styles.sidebarHost} ${isShell ? "" : styles.sidebarHidden}`}>
        <UserSidebar
          route={route}
          onRoute={onRoute}
          onToast={showToast}
          onSearch={openSearch}
          mcpVisible={mcpVisible}
          onDismissMcp={() => {
            setMcpVisible(false);
            showToast("Dismissed MCP card");
          }}
          onWorkspaceClick={() => togglePanel("workspace")}
          onInbox={() => togglePanel("inbox")}
          onNewProject={() => setNewProjectOpen(true)}
        />
      </div>

      <div className={styles.relativeContainer}>
        {/* Keep heavy views mounted so WebGL / layout stay warm */}
        <View active={isShell} label="home">
          <div className={styles.content}>
            <header className={styles.pageHeader}>
              <h2 className={styles.pageTitle}>{routeTitles[route] || routeTitles.home}</h2>
              <CreateActions onAction={onCreate} />
            </header>
            <div className={styles.page} data-shell-content>
              {route === "home" ? (
                <>
                  <div className={styles.homeCol}>
                    <h1 className={styles.welcome}>Welcome back, {workspace.user}</h1>
                    <HomeRecents
                      onOpen={openFile}
                      onViewAll={() => onRoute("files")}
                      onTrash={() => showToast("Trash — 2 files")}
                    />
                    <ConceptDesign />
                  </div>
                  <div className={styles.aiDock}>
                    <HomeHero onToast={showToast} />
                  </div>
                </>
              ) : route === "files" ? (
                <FilesPage
                  onOpen={openFile}
                  onToast={showToast}
                  onNewProject={() => setNewProjectOpen(true)}
                />
              ) : route === "templates" ? (
                <TemplatesPage onToast={showToast} />
              ) : route === "community" ? (
                <CommunityPage onToast={showToast} />
              ) : route === "academy" ? (
                <AcademyPage onToast={showToast} />
              ) : null}
            </div>
          </div>
        </View>

        <View active={route === "scene"} label="scene">
          <SceneEditor title={sceneFile} onBack={() => onRoute("home")} onToast={showToast} />
        </View>

        <View active={route === "design"} label="design">
          <DesignEditor title={designFile} onBack={() => onRoute("home")} onToast={showToast} />
        </View>

        <View active={route === "generate"} label="generate">
          <GeneratePage onBack={() => onRoute("home")} onToast={showToast} />
        </View>

        <View active={route === "arena"} label="arena">
          <ArenaPage onRoute={onRoute} onSearch={openSearch} onToast={showToast} />
        </View>
      </div>

      <input
        ref={importRef}
        type="file"
        accept={importAccept}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files || [])];
          if (!files.length) return;
          const names = files.map((f) => f.name).join(", ");
          showToast(files.length === 1 ? `Importing ${names}` : `Importing ${files.length} files`);
          e.target.value = "";
        }}
      />

      {panel === "workspace" ? (
        <WorkspaceMenu onClose={() => setPanel(null)} onToast={showToast} />
      ) : null}
      {panel === "inbox" ? <InboxPanel onClose={() => setPanel(null)} /> : null}
      {newProjectOpen ? (
        <NewProjectModal onClose={() => setNewProjectOpen(false)} onCreate={createProject} />
      ) : null}
      {importOpen ? (
        <ImportModal
          onClose={() => setImportOpen(false)}
          onPickFiles={() => {
            setImportOpen(false);
            importRef.current?.click();
          }}
          onGenerate={() => {
            setImportOpen(false);
            onRoute("generate");
          }}
          onToast={showToast}
        />
      ) : null}

      {searchOpen ? (
        <div className={styles.searchBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget) setSearchOpen(false);
        }}>
          <section className={styles.searchDialog} role="dialog" aria-modal="true" aria-label="Search files">
            <div className={styles.searchInputRow}>
              <IconSearch />
              <input
                autoFocus
                className={styles.searchInput}
                type="search"
                placeholder="Search files in this workspace"
                aria-label="Search files in this workspace"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery ? (
                <button type="button" className={styles.searchClear} aria-label="Clear search" onClick={() => setSearchQuery("")}>
                  <IconClose />
                </button>
              ) : null}
              <button type="button" className={styles.searchCloseBtn} onClick={() => setSearchOpen(false)}>
                Close search
              </button>
            </div>
            <div className={styles.searchResults}>
              {searchGroups.map((group) => (
                <div key={group.id}>
                  <p className={styles.searchGroup}>{group.label}</p>
                  {group.items.map((file) => (
                    <button
                      key={file.id}
                      type="button"
                      className={styles.searchResult}
                      onClick={() => {
                        setSearchOpen(false);
                        openFile(file.name);
                      }}
                    >
                      <SearchThumb art={file.art} />
                      <span className={styles.searchName}>{file.name}</span>
                      {query ? <span className={styles.searchLoc}>My Files</span> : null}
                    </button>
                  ))}
                </div>
              ))}
              {matches.length === 0 ? (
                <p className={styles.searchEmpty}>No files match “{searchQuery}”.</p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <div className={`${styles.toast} ${toastOn ? styles.toastShow : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}

