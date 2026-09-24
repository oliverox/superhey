import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

// Strict CSP for the packaged app. Dev skips it because React refresh injects an inline script.
const csp: Plugin = {
  name: 'csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<head>',
      `<head><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob: myhey-file: https://gopher.hey.com; connect-src 'self' myhey-file:; object-src 'none'; base-uri 'none'; form-action 'none'">`,
    ),
}

export default defineConfig({
  main: {
    // Bundle the workspace core (TypeScript source) into the main process.
    build: { externalizeDeps: { exclude: ['@myhey/core'] } },
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
    plugins: [react(), tailwindcss(), csp],
  },
})
