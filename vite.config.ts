import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiTarget = env.VITE_API_URL || 'http://localhost:8000'
  const proxyApiTarget = env.VITE_PROXY_API_TARGET || apiTarget
  const toWsTarget = (value: string) => value.replace(/^http(s?):\/\//i, 'ws$1://')
  const proxyWsTarget = toWsTarget(proxyApiTarget)
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
    base: '/',
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
        '/api': {
          target: proxyApiTarget,
          changeOrigin: false,
        },
        '/auth': {
          target: proxyApiTarget,
          changeOrigin: false,
          bypass(req) {
            const requestPath = req.url?.split('?')[0]
            // Let SPA handle these auth pages; proxy all other auth routes to backend
            if (requestPath === '/auth/settings') return req.url
            if (requestPath?.startsWith('/auth/login')) return req.url
            if (requestPath?.startsWith('/auth/signup')) return req.url
          },
        },
        '/w': {
          target: proxyApiTarget,
          changeOrigin: false,
          bypass(req) {
            const requestPath = req.url?.split('?')[0] || ''
            // Let SPA handle workspace root, setup, and settings pages;
            // only proxy workspace-scoped backend routes (e.g. /w/{id}/api/...).
            if (/^\/w\/[^/]+\/?$/.test(requestPath)) return req.url
            if (/^\/w\/[^/]+\/setup\/?$/.test(requestPath)) return req.url
            if (/^\/w\/[^/]+\/settings\/?$/.test(requestPath)) return req.url
          },
        },
        '/ws': {
          target: proxyWsTarget,
          changeOrigin: false,
          ws: true,
        },
      },
    },
  }
})
