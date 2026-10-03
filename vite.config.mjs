import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    // Relative, so the build loads from file:// inside Electron.
    base: './',
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true },
});
