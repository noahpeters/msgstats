import path from 'node:path';
import { defineConfig, type PluginOption } from 'vite';
import { reactRouter } from '@react-router/dev/vite';
import stylex from '@stylexjs/unplugin';

const isTest = process.env.VITEST === 'true';

export default defineConfig({
  plugins: [
    ...(!isTest
      ? [
          stylex.vite({
            importSources: ['@stylexjs/stylex', 'stylex', './lib/stylex'],
            unstable_moduleResolution: {
              type: 'commonJS',
              rootDir: __dirname,
            },
            devMode: 'full',
            devPersistToDisk: true,
          }) as unknown as PluginOption,
          reactRouter() as unknown as PluginOption,
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '~': path.resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  ssr: {
    noExternal: ['@stylexjs/stylex'],
  },
  optimizeDeps: {
    exclude: ['@stylexjs/stylex'],
  },
  build: {
    emptyOutDir: false,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/auth/facebook/deletion': 'http://localhost:8787',
      // If you also proxy /api, keep that too (with ws if needed)
      // '/api': {
      //   target: 'http://localhost:8787',
      //   changeOrigin: true,
      // },
    },
  },
});
