import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// Proxies /api to FastAPI so the frontend can call the backend without CORS issues.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
})
