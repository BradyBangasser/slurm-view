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
    proxy: {
      // Only the API itself; client modules also live under /api (src/client/api).
      '/api/v1': 'http://localhost:3000',
    },
  },

  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
})
