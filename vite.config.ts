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
        // Main portfolio SPA (served at /)
        main: resolve(__dirname, 'index.html'),
        // Video Editor tool (served at /video/)
        video: resolve(__dirname, 'video/index.html'),
      },
    },
  },
})
