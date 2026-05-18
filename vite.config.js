import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: false,
    assetsDir: 'react-assets',
    chunkSizeWarningLimit: 2200,
    rollupOptions: {
      output: {
        entryFileNames: 'react-assets/reel-orbit.js',
        chunkFileNames: 'react-assets/[name].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name || 'asset';
          if (name.endsWith('.css')) return 'react-assets/reel-orbit.css';
          return 'react-assets/[name][extname]';
        },
      },
    },
  },
});
