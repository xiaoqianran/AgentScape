import { defineConfig } from 'vite';

export default defineConfig({
  base: '/AgentScape/',
  server: {
    watch: {
      ignored: ['**/.venv/**', '**/__pycache__/**', '**/.git/**', '**/dist/**']
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@dimforge/rapier3d-compat')) return 'physics';
          if (id.includes('three-mesh-bvh')) return 'spatial';
          if (id.includes('/three/')) return 'three';
        }
      }
    }
  }
});
