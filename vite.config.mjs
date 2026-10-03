import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    // Relative, so the build loads from file:// inside Electron.
    base: './',
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', emptyOutDir: true },
    // React page tests (npm run test:ui): each page rendered in jsdom against a fake legacy core.
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.jsx'],
        setupFiles: ['src/test/setup.js'],
    },
});
