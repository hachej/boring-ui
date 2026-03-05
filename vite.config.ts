import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://localhost:8000'
  const proxyApiTarget = env.VITE_PROXY_API_TARGET || apiTarget
  const companionTarget = env.VITE_COMPANION_PROXY_TARGET
  const toWsTarget = (value: string) => value.replace(/^http(s?):\/\//i, 'ws$1://')
  const proxyWsTarget = toWsTarget(proxyApiTarget)
  const companionWsTarget = companionTarget ? toWsTarget(companionTarget) : ''
  // Workspace root for workspace plugin panel loading
  const workspaceRoot = env.BORING_UI_WORKSPACE_ROOT || env.WORKSPACE_ROOT || ''

  // Library build mode (npm run build:lib)
  const isLibMode = mode === 'lib'
  const resolveAlias = [
    { find: /^@\//, replacement: `${path.resolve(__dirname, './src/front')}/` },
    {
      find: '@mariozechner/pi-ai/dist/providers/register-builtins.js',
      replacement: path.resolve(__dirname, './src/front/providers/pi/registerBuiltins.browser.js'),
    },
    {
      find: '@mariozechner/pi-ai/dist/utils/http-proxy.js',
      replacement: path.resolve(__dirname, './src/front/providers/pi/httpProxy.noop.js'),
    },
    {
      find: /^@mariozechner\/pi-ai$/,
      replacement: path.resolve(__dirname, './src/front/providers/pi/piAi.browser.js'),
    },
  ]
  if (workspaceRoot) {
    resolveAlias.push({
      find: '@workspace',
      replacement: path.resolve(workspaceRoot, 'kurt/panels'),
    })
  }

  const baseConfig = {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: resolveAlias,
    },
    test: {
      globals: true,
      environment: 'jsdom',
      css: true,
      include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    },
  }

  // Library build configuration
  if (isLibMode) {
    return {
      ...baseConfig,
      build: {
        lib: {
          entry: path.resolve(__dirname, 'src/front/index.js'),
          name: 'BoringUI',
          formats: ['es', 'cjs'],
          fileName: (format) => `boring-ui.${format === 'es' ? 'js' : 'cjs'}`,
        },
        rollupOptions: {
          // Externalize peer dependencies
          external: ['react', 'react-dom', 'react/jsx-runtime'],
          output: {
            // Global variable names for UMD build (not used but good practice)
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
              'react/jsx-runtime': 'jsxRuntime',
            },
          },
        },
        cssCodeSplit: false, // Emit single style.css
        sourcemap: true,
      },
    }
  }

  // Development/app build configuration
  return {
    ...baseConfig,
    base: './',
    server: {
      port: 5173,
      fs: {
        allow: ['.', ...(workspaceRoot ? [workspaceRoot] : [])],
      },
      proxy: {
        ...(companionTarget
          ? {
              '/api/v1/agent/companion': {
                target: companionTarget,
                changeOrigin: true,
                rewrite: (path: string) => path.replace(/^\/api\/v1\/agent\/companion/, '/api'),
              },
              // Dedicated chat-auth endpoints must stay browser-reachable in sandbox mode.
              '/api/v1/chat/auth': {
                target: companionTarget,
                changeOrigin: true,
              },
            }
          : {}),
        '/api': {
          target: proxyApiTarget,
          changeOrigin: false,
        },
        '/auth': {
          target: proxyApiTarget,
          changeOrigin: false,
          bypass(req) {
            // Let SPA handle settings page; proxy all other auth routes to backend
            if (req.url === '/auth/settings') return req.url
          },
        },
        '/w': {
          target: proxyApiTarget,
          changeOrigin: false,
          bypass(req) {
            // Let SPA handle workspace settings pages
            if (req.url && /^\/w\/[^/]+\/settings\/?$/.test(req.url)) return req.url
          },
        },
        ...(companionTarget
          ? {
              '/ws/agent/companion': {
                target: companionWsTarget,
                changeOrigin: true,
                ws: true,
                rewrite: (path: string) => path.replace(/^\/ws\/agent\/companion/, '/ws'),
              },
            }
          : {}),
        '/ws': {
          target: proxyWsTarget,
          changeOrigin: false,
          ws: true,
        },
        ...(companionTarget
          ? {
              '/companion/ws': {
                target: companionWsTarget,
                changeOrigin: true,
                ws: true,
                rewrite: (path: string) => path
                  .replace(/^\/companion\/ws\/agent\/companion/, '/ws')
                  .replace(/^\/companion\/ws/, '/ws'),
              },
              '/companion': {
                target: companionTarget,
                changeOrigin: true,
                rewrite: (path: string) => path
                  .replace(/^\/companion\/api\/v1\/agent\/companion/, '/api')
                  .replace(/^\/companion/, ''),
              },
            }
          : {}),
      },
    },
  }
})
