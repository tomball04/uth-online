import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/client',
  build: { outDir: '../../dist/client', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
