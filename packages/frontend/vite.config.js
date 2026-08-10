import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose WALLETCONNECT_PROJECT_ID (and VITE_-prefixed vars) to client code.
  envPrefix: ['VITE_', 'WALLETCONNECT_'],
  server: {
    proxy: {
      // Forward API calls to the local API (same container) so the browser
      // only ever talks to the frontend origin. This avoids Codespaces
      // cross-origin/CORS problems on the forwarded API port (which is
      // often private/auth-gated). Override the target via API_PROXY_TARGET.
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
