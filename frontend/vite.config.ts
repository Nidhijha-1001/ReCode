import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const frontendRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendRoot, '')
  const apiBaseUrl = (env.VITE_API_BASE_URL?.trim() || '/api').replace(/\/+$/, '') || '/api'
  const proxyTarget = env.VITE_API_PROXY_TARGET?.trim() || 'http://127.0.0.1:8000'

  return {
    root: frontendRoot,
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: apiBaseUrl.startsWith('/')
        ? {
            [apiBaseUrl]: {
              target: proxyTarget,
              changeOrigin: true,
            },
          }
        : undefined,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      strictPort: true,
    },
  }
})
