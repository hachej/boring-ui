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
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            // Split heavy vendor libraries into separate cacheable chunks
            if (id.includes('node_modules/@tiptap/') || id.includes('node_modules/lowlight/') || id.includes('node_modules/highlight.js/')) {
              return 'vendor-editor'
            }
            if (id.includes('node_modules/xterm')) {
              return 'vendor-terminal'
            }
            if (id.includes('node_modules/@mariozechner/')) {
              return 'vendor-pi'
            }
            if (id.includes('node_modules/@assistant-ui/') || id.includes('node_modules/markdown-it') || id.includes('node_modules/remark') || id.includes('node_modules/unified') || id.includes('node_modules/mdast') || id.includes('node_modules/micromark')) {
              return 'vendor-chat'
            }
            if (id.includes('node_modules/isomorphic-git')) {
              return 'vendor-git'
            }
            if (id.includes('node_modules/dockview')) {
              return 'vendor-dockview'
            }
            if (id.includes('node_modules/react-pdf') || id.includes('node_modules/pdfjs-dist')) {
              return 'vendor-pdf'
            }
          },
        },
      },
    },
    server: {
      port: 5173,
      watch: {
        // This repo is large; fs.watch can exceed inotify limits in local/dev containers.
        usePolling: true,
        interval: 1000,
        // Keep Vite focused on source files; large workspace folders can exceed inotify limits.
        ignored: [
          '**/.claude/**',
          '**/.beads/**',
          '**/.beads.old/**',
          '**/.agent-evidence/**',
          '**/.boring/**',
          '**/.evidence/**',
          '**/.bsw/**',
          '**/.venv/**',
          '**/artifacts/**',
          '**/flows/**',
          '**/playwright-report/**',
          '**/test-results/**',
          '**/dist/**',
          '**/vendor/**',
          '**/src/back/**',
          '**/tests/**',
          '**/examples/**',
          '**/docs/**',
          '**/deploy/**',
          '**/__pycache__/**',
          '**/*.pyc',
        ],
      },
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
            // Let SPA handle these auth pages; proxy all other auth routes to backend
            if (req.url === '/auth/settings') return req.url
            if (req.url?.startsWith('/auth/login')) return req.url
            if (req.url?.startsWith('/auth/signup')) return req.url
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
