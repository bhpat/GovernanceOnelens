import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
    },
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const modulePath = id.replaceAll('\\', '/');
          if (!modulePath.includes('/node_modules/')) return undefined;
          if (modulePath.includes('/node_modules/@fluentui/react-icons/')) return 'fluent-icons';
          if (
            modulePath.includes('/node_modules/@griffel/')
            || modulePath.includes('/node_modules/@floating-ui/')
            || modulePath.includes('/node_modules/tabster/')
          ) return 'fluent-foundation';
          if (modulePath.includes('/node_modules/@fluentui/')) return 'fluent-ui';
          if (
            modulePath.includes('/node_modules/react/')
            || modulePath.includes('/node_modules/react-dom/')
            || modulePath.includes('/node_modules/react-router/')
            || modulePath.includes('/node_modules/react-router-dom/')
            || modulePath.includes('/node_modules/scheduler/')
          ) return 'react-runtime';
          if (
            modulePath.includes('/node_modules/@microsoft/rayfin-')
            || modulePath.includes('/node_modules/@azure/msal-')
          ) return 'rayfin-runtime';
          return undefined;
        },
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2022',
    },
  },
});
