import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    open: false,
    watch: {
      // Le watcher natif (fsevents) meurt régulièrement sur ce poste → les
      // modules transformés restent périmés en mémoire. Polling robuste.
      usePolling: true,
      interval: 400,
    },
  },
  build: {
    target: 'es2022',
  },
});
