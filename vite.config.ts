import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const API = 'http://localhost:5174'

export default defineConfig({
  plugins: [react()],
  server: {
    // The editor saves through the local data API; floor plan images are served from it too.
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/floorplans': { target: API, changeOrigin: true },
    },
  },
})
