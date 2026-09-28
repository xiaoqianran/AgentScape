import styles from "./App.module.css";
import UserSidebar from "./components/UserSidebar.jsx";
import CreateActions from "./components/CreateActions.jsx";
import HomeRecents from "./components/HomeRecents.jsx";
import HomeHero from "./components/HomeHero.jsx";
import GeneratePage from "./components/GeneratePage.jsx";
import SceneEditor from "./components/SceneEditor.jsx";
import DesignEditor from "./components/DesignEditor.jsx";
import { workspace, routeTitles, importAccept } from "./data/home.js";
import { useCallback, useEffect, useRef, useState } from "react";

const ROUTES = ["home", "scene", "design", "generate", "files", "templates", "community", "academy"];

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

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const [mcpVisible, setMcpVisible] = useState(true);
  const [toast, setToast] = useState("");
  const [toastOn, setToastOn] = useState(false);
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

  const onCreate = (action) => {
    if (action === "scene") {
      setSceneFile("Spline 3D Starter File");
      onRoute("scene");
    } else if (action === "design") {
      setDesignFile("Hana starter file");
      onRoute("design");
    } else if (action === "generate") onRoute("generate");
    else if (action === "import") importRef.current?.click();
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

  return (
    <div className={styles.pageContainer}>
      <div className={`${styles.sidebarHost} ${isShell ? "" : styles.sidebarHidden}`}>
        <UserSidebar
          route={route}
          onRoute={onRoute}
          onToast={showToast}
          mcpVisible={mcpVisible}
          onDismissMcp={() => {
            setMcpVisible(false);
            showToast("Dismissed MCP card");
          }}
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
            <div className={styles.page}>
              {route === "home" ? (
                <>
                  <div className={styles.heroWrap}>
                    <h1 className={styles.welcome}>Welcome back, {workspace.user}</h1>
                    <HomeRecents onOpen={openFile} />
                  </div>
                  <HomeHero onToast={showToast} />
                </>
              ) : (
                <div className={styles.placeholder}>{routeTitles[route]} — coming soon in this clone</div>
              )}
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

      <div className={`${styles.toast} ${toastOn ? styles.toastShow : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  );
}
