// Runs the renderer in a normal browser against the dev API server (src/web/server.ts).
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import pkg from './package.json' with { type: 'json' }

const port = Number(process.env.SUPERHEY_API_PORT ?? 5188)

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  plugins: [react(), tailwindcss()],
  define: { 'import.meta.env.VITE_API_TOKEN': JSON.stringify(process.env.SUPERHEY_TOKEN ?? ''), __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': { target: `http://127.0.0.1:${port}`, changeOrigin: true } },
  },
})
