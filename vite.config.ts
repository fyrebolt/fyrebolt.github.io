import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  // ffmpeg.wasm spawns a worker via import.meta.url; keep esbuild from
  // pre-bundling it so that worker URL resolves correctly.
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      input: {
        // iPad-style home screen (served at /)
        main: resolve(__dirname, 'index.html'),
        // Camera → Video Editor (served at /video/)
        video: resolve(__dirname, 'video/index.html'),
        // Camera (classic) → frozen per-tool editor (served at /video-classic/)
        videoClassic: resolve(__dirname, 'video-classic/index.html'),
        // App Store → portfolio (served at /appstore/)
        appstore: resolve(__dirname, 'appstore/index.html'),
        // Printer → résumé PDF viewer (served at /printer/)
        printer: resolve(__dirname, 'printer/index.html'),
        // About Me (served at /about/)
        about: resolve(__dirname, 'about/index.html'),
        // Instagram Tracker (served at /instagram/)
        instagram: resolve(__dirname, 'instagram/index.html'),
        // LinkedIn Tracker (served at /linkedin/)
        linkedin: resolve(__dirname, 'linkedin/index.html'),
        // Drift → pointer-lock cursor game (served at /game/)
        game: resolve(__dirname, 'game/index.html'),
        // Doomscroll → scroll-driven feed game (served at /feed/)
        feed: resolve(__dirname, 'feed/index.html'),
        // GIF Shop → video-to-GIF converter (served at /gif/)
        gif: resolve(__dirname, 'gif/index.html'),
        // Retake → recorded-takes puzzle platformer (served at /retake/)
        retake: resolve(__dirname, 'retake/index.html'),
      },
    },
  },
})
