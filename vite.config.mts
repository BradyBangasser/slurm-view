import { defineConfig } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routesDirectory: './routes',
      generatedRouteTree: './routeTree.gen.ts',
    }),
    react(),
    tailwindcss(),
  ],

  root: 'src/client',

  // Relative asset paths so the built client works from the application
  // root, locally and under an OOD base path.
  base: './',

  server: {
    // Proxy only the real REST mount (/api/v1, see server/app.ts). A bare
    // '/api' prefix also matches Vite's own dev-server module requests for
    // src/client/api/*.ts (root is 'src/client', so that directory serves
    // at /api/*.ts) and would hijack them to the Express backend, 404ing
    // every import from the client's api/ folder.
    proxy: {
      '/api/v1': 'http://localhost:3000',
    },
  },

  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
})
