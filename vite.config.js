import { defineConfig } from "vite";
import { capabilityDevPlugin } from "./tooling/dev/capabilityDevPlugin.js";

export default defineConfig({
  base: "/",
  plugins: [capabilityDevPlugin()],
  test: {
    include: ["tests/**/*.test.js"]
  },
  server: {
    host: "0.0.0.0",
    watch: {
      ignored: ["**/.venv/**", "**/__pycache__/**", "**/.git/**", "**/dist/**"]
    }
  },
  preview: {
    host: "0.0.0.0"
  },
  build: {
    rollupOptions: {
      input: {
        studio: new URL("./index.html", import.meta.url).pathname,
        observatory: new URL("./observatory/index.html", import.meta.url).pathname
      },
      output: {
        manualChunks(id) {
          if (id.includes("@dimforge/rapier3d-compat")) return "physics";
          if (id.includes("/three/")) return "three";
        }
      }
    }
  }
});
