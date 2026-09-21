import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The UI is bundled into the Rust binary (see src-tauri/tauri.conf.json). The dev server is
// only used by `npm run dev`, which opens it inside the desktop window with hot reload.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/target/**'] } },
  build: { target: 'chrome110', outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/**/*.test.ts'] },
});
