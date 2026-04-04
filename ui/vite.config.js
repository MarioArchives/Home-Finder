import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/data': {
        target: 'http://localhost:5173',
        rewrite: () => '/listings.json',
      },
      '/api': {
        target: 'http://localhost:8080',
      },
    },
  },
  publicDir: 'public',
})
