import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The UI calls its own origin (/api, /socket.io) and Vite forwards both to the
// backend. Where the backend is comes from the environment: BACKEND_URL, else
// localhost on BACKEND_PORT. Both are read from the repository's .env (one
// level up) and from the process environment (docker-compose sets them).
const envDir = path.resolve(__dirname, '..')

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '')
  const backend = env.BACKEND_URL || `http://localhost:${env.BACKEND_PORT || 3000}`
  const proxy = {
    '/api': { target: backend, changeOrigin: true },
    '/socket.io': { target: backend, changeOrigin: true, ws: true },
  }
  const port = Number(env.UI_PORT) || 5173
  // Host names the UI may be opened by. Vite refuses unknown ones, which breaks
  // a server reached by its domain. Unset: any host (the backend's port is open
  // anyway). Set a comma list, e.g. "emulator.example.com", to restrict it.
  const allowedHosts = env.ALLOWED_HOSTS
    ? env.ALLOWED_HOSTS.split(',').map((h) => h.trim()).filter(Boolean)
    : true

  return {
    envDir,
    plugins: [react()],
    server: { port, proxy, allowedHosts },
    preview: { port, proxy, allowedHosts },
  }
})
