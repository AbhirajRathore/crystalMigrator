import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During local dev, proxy /api to the data backend so the browser avoids CORS.
// Point this at your .NET backend (which proxies N1) or directly at the FastAPI (127.0.0.1:8000).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      // the report backend (.NET) handles convert + template serving
      '/api/v1/convert': { target: process.env.REPORT_API ?? 'http://127.0.0.1:5249', changeOrigin: true },
      '/api/v1/reports': { target: process.env.REPORT_API ?? 'http://127.0.0.1:5249', changeOrigin: true },
      // everything else (the raw data query) goes to the data gateway
      '/api': { target: process.env.DATA_API ?? 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
