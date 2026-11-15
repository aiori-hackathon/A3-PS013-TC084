import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        // Defaults to the deployed API so `npm run dev` behaves as before.
        // Set VITE_API_PROXY to work against a backend running locally, so
        // local testing cannot reach production data by accident.
        target: process.env.VITE_API_PROXY || 'https://api.tracepoint.jassist.qzz.io',
        changeOrigin: true,
      },
    },
  },
})
