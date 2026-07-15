import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ===== Frozen snapshot build: the original site, served at /old/ =====
//
// This is an independent Vite project rooted at `legacy/`. It builds the site
// exactly as it existed before the iPad-home-screen redesign and emits it into
// `dist/old/`, so the old site (including /old/video and its #tool hash routes)
// stays reachable and fully functional after the redesign ships.
//
// Run after the main build (which empties dist/): `emptyOutDir: false` keeps it
// from wiping the freshly-built new site.
export default defineConfig({
  root: __dirname,
  base: '/old/',
  publicDir: resolve(__dirname, '../public'),
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    outDir: resolve(__dirname, '../dist/old'),
    emptyOutDir: false,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        video: resolve(__dirname, 'video/index.html'),
      },
    },
  },
})
